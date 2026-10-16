import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { AgentCloudApi } from '@shared/api'
import type { Settings } from '@shared/types'
import { closeDb, getDb } from './db'
import { agentsRepo, convRepo, msgRepo, searchAll, settingsRepo, tasksRepo, usageRepo } from './db/repos'
import { emit, toast } from './events'
import { log, logsPath, readRecentLog } from './logging'
import { TEMPLATES } from './templates'
import { cancelAllTasks, cancelTask, isTaskRunning, startTask } from './claude/agentRunner'
import {
  addLocalPlugin, addSkill, agentFromMarkdown, agentToMarkdown, installMarketplace, listMcpServers, listPlugins, listSkills,
  removeMcpServer, removePlugin, removeSkill, saveMcpServer, testMcpServer, togglePlugin
} from './claude/config'
import { answer } from './claude/interactions'
import { abortAllChats, busyMap, deliverToManager, dropSession, resetIdleSessions, sessionFor } from './claude/manager'
import { checkAuth, chromeStatus, claudeExecutable, clearApiKey, storeApiKey, workspaceOk } from './claude/sdk'
import { connectTelegram, disconnectTelegram, newPairingCode, startTelegram, stopTelegram, telegramStatus, unlinkTelegramChat } from './telegram'

// ---------------------------------------------------------------- crash safety

process.on('uncaughtException', (e) => log.error('uncaughtException', e))
process.on('unhandledRejection', (e) => log.error('unhandledRejection', e))

// Allows a separate profile (used for testing): AGENTCLOUD_USER_DATA=<folder>
if (process.env.AGENTCLOUD_USER_DATA) app.setPath('userData', process.env.AGENTCLOUD_USER_DATA)

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let win: BrowserWindow | null = null

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 940,
    minHeight: 600,
    frame: false,
    backgroundColor: '#000000',
    show: false,
    title: 'agentCloud',
    icon: path.join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.on('maximize', () => emit({ type: 'window:maximized', value: true }))
  win.on('unmaximize', () => emit({ type: 'window:maximized', value: false }))
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file:')) {
      e.preventDefault()
      if (/^https?:/.test(url)) void shell.openExternal(url)
    }
  })
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'x') {
      e.preventDefault()
      const n = stopAll()
      toast('warning', n ? `Stopped ${n} running job${n === 1 ? '' : 's'}.` : 'Nothing was running.')
    }
  })
  win.webContents.on('render-process-gone', (_e, d) => log.error('renderer gone', d))
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function stopAll(): number {
  return cancelAllTasks() + abortAllChats()
}

// ---------------------------------------------------------------- startup data

function ensureManager() {
  const s = settingsRepo.getAll()
  const m = agentsRepo.manager()
  if (!m) {
    agentsRepo.save({ name: s.managerName, role: s.managerRole, avatar: s.managerAvatar, color: '#F7A51C', isManager: true, instructions: '', model: 'balanced', tools: ['read', 'web_search', 'web_fetch', 'skills'] })
  }
}

function syncManager(s: Settings) {
  const m = agentsRepo.manager()
  if (m && (m.name !== s.managerName || m.role !== s.managerRole || m.avatar !== s.managerAvatar)) {
    agentsRepo.save({ ...m, name: s.managerName, role: s.managerRole, avatar: s.managerAvatar })
    emit({ type: 'agents:changed' })
  }
}

function workspacePath(p: string): string {
  const ws = settingsRepo.getAll().workspace ?? ''
  const clean = p.replace(/^file:\/\//, '').replace(/^\/+(?=[A-Za-z]:)/, '')
  return path.isAbsolute(clean) ? clean : path.join(ws, decodeURIComponent(clean))
}

// ---------------------------------------------------------------- IPC

type Handlers = { [K in keyof AgentCloudApi]: (...args: Parameters<AgentCloudApi[K]>) => ReturnType<AgentCloudApi[K]> | Awaited<ReturnType<AgentCloudApi[K]>> }

const err = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) })

const handlers: Handlers = {
  windowMinimize: async () => { win?.minimize() },
  windowToggleMaximize: async () => {
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  },
  windowClose: async () => { win?.close() },
  windowIsMaximized: async () => !!win?.isMaximized(),
  appInfo: async () => ({ version: app.getVersion(), platform: process.platform, dataPath: app.getPath('userData'), logsPath: logsPath() }),
  openPath: async (p) => {
    const full = workspacePath(p)
    if (!fs.existsSync(full)) {
      toast('warning', "That file isn't there anymore.")
      return
    }
    const r = await shell.openPath(full)
    if (r) toast('error', "Couldn't open that file.")
  },
  showInFolder: async (p) => shell.showItemInFolder(workspacePath(p)),
  openExternal: async (url) => {
    if (/^(https?|mailto):/.test(url)) await shell.openExternal(url)
  },
  pickFolder: async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0] ?? null
  },
  pickFiles: async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile', 'multiSelections'] })
    return r.canceled ? [] : r.filePaths
  },
  pickFile: async (filters) => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters })
    return r.canceled ? null : r.filePaths[0] ?? null
  },
  copyDiagnostics: async () => {
    const s = settingsRepo.getAll()
    const info = [
      `agentCloud ${app.getVersion()} on ${process.platform} ${process.arch}`,
      `Electron ${process.versions.electron}, Node ${process.versions.node}`,
      `Claude binary: ${claudeExecutable() ?? 'missing'}`,
      `Workspace: ${s.workspace} (exists: ${workspaceOk()})`,
      `Permission mode: ${s.permissionMode}`,
      `Agents: ${agentsRepo.list().length}, Tasks: ${tasksRepo.list().length}`,
      '', '--- recent log ---', readRecentLog(12000)
    ].join('\n')
    clipboard.writeText(info)
  },
  resetApp: async () => {
    stopAll()
    closeDb()
    const dir = app.getPath('userData')
    for (const f of ['agentcloud.db', 'agentcloud.db-wal', 'agentcloud.db-shm']) fs.rmSync(path.join(dir, f), { force: true })
    app.relaunch()
    app.exit(0)
  },
  openLogsFolder: async () => { await shell.openPath(logsPath()) },
  workspaceExists: async () => workspaceOk(),
  createDefaultWorkspace: async () => {
    const dir = process.env.AGENTCLOUD_DEFAULT_WORKSPACE || path.join(app.getPath('documents'), 'agentCloud')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  },

  authCheck: () => checkAuth(),
  authSaveApiKey: async (key) => {
    try {
      const k = key.trim()
      if (!/^sk-ant-/.test(k)) return { ok: false, error: 'That doesn’t look like a Claude API key. It should start with “sk-ant-”.' }
      storeApiKey(k)
      const st = await checkAuth()
      if (!st.ok) {
        clearApiKey()
        return { ok: false, error: st.message ?? 'Claude did not accept that key.' }
      }
      resetIdleSessions()
      return { ok: true, data: st }
    } catch (e) {
      return err(e)
    }
  },
  authClearApiKey: async () => {
    clearApiKey()
    resetIdleSessions()
  },
  authOpenSignIn: async () => {
    const exe = claudeExecutable()
    if (!exe) return void toast('error', 'Claude Code is missing from this installation. Please reinstall agentCloud.')
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '"Sign in to Claude"', `"${exe}"`, 'auth', 'login'], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref()
    } else if (process.platform === 'darwin') {
      spawn('osascript', ['-e', `tell application "Terminal" to do script "\\"${exe}\\" auth login"`, '-e', 'tell application "Terminal" to activate'], { detached: true, stdio: 'ignore' }).unref()
    } else {
      spawn('x-terminal-emulator', ['-e', exe, 'auth', 'login'], { detached: true, stdio: 'ignore' }).unref()
    }
  },

  settingsGet: async () => settingsRepo.getAll(),
  settingsSet: async (patch) => {
    const before = settingsRepo.getAll()
    const s = settingsRepo.set(patch)
    if ('launchOnStartup' in patch && app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!patch.launchOnStartup })
    syncManager(s)
    const restartKeys: (keyof Settings)[] = ['workspace', 'permissionMode', 'chromeEnabled', 'allowedCommands', 'blockedCommands', 'disabledSkills', 'localPlugins', 'managerName', 'managerRole', 'managerPersona', 'userName']
    if (restartKeys.some((k) => k in patch && JSON.stringify(before[k]) !== JSON.stringify(s[k]))) resetIdleSessions()
    return s
  },

  agentsList: async () => {
    const tasks = tasksRepo.list()
    return agentsRepo.list().map((a) => {
      const mine = tasks.filter((t) => t.agentId === a.id)
      const working = mine.some((t) => t.status === 'in_progress' || t.status === 'needs_input')
      const latest = mine[0]
      return { ...a, status: working ? 'working' : latest?.status === 'failed' ? 'error' : 'idle' }
    })
  },
  agentsSave: async (a) => {
    const isNew = !a.id || !agentsRepo.get(a.id)
    const saved = agentsRepo.save(a)
    if (isNew && !saved.isManager) convRepo.create(saved.id, saved.name)
    else {
      const conv = convRepo.latestForAgent(saved.id)
      if (conv && !saved.isManager) convRepo.rename(conv.id, saved.name)
    }
    resetIdleSessions()
    emit({ type: 'agents:changed', hiredId: isNew ? saved.id : undefined })
    emit({ type: 'conversations:changed' })
    return saved
  },
  agentsDelete: async (id) => {
    for (const t of tasksRepo.list()) if (t.agentId === id && isTaskRunning(t.id)) cancelTask(t.id)
    for (const c of convRepo.list()) if (c.agentId === id) dropSession(c.id)
    agentsRepo.delete(id)
    convRepo.deleteForAgent(id)
    emit({ type: 'agents:changed' })
    emit({ type: 'conversations:changed' })
  },
  agentsDuplicate: async (id) => {
    const a = agentsRepo.get(id)
    if (!a) throw new Error('Agent not found')
    return handlers.agentsSave({ ...a, id: undefined, name: `${a.name} (copy)`, isManager: false }) as Promise<ReturnType<typeof agentsRepo.save>>
  },
  agentsTemplates: async () => TEMPLATES,
  agentsExport: async (id) => {
    const a = agentsRepo.get(id)
    if (!a) return null
    const slug = a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent'
    const r = await dialog.showSaveDialog(win!, {
      defaultPath: path.join(app.getPath('home'), '.claude', 'agents', `${slug}.md`),
      filters: [{ name: 'Claude Code agent', extensions: ['md'] }]
    })
    if (r.canceled || !r.filePath) return null
    fs.mkdirSync(path.dirname(r.filePath), { recursive: true })
    fs.writeFileSync(r.filePath, agentToMarkdown(a))
    return r.filePath
  },
  agentsImport: async () => {
    const r = await dialog.showOpenDialog(win!, {
      defaultPath: path.join(app.getPath('home'), '.claude', 'agents'),
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Claude Code agent', extensions: ['md'] }]
    })
    if (r.canceled) return { ok: true, data: [] }
    try {
      const out = []
      for (const f of r.filePaths) {
        const parsed = agentFromMarkdown(fs.readFileSync(f, 'utf8'))
        const saved = agentsRepo.save(parsed)
        convRepo.create(saved.id, saved.name)
        out.push(saved)
      }
      emit({ type: 'agents:changed' })
      emit({ type: 'conversations:changed' })
      return { ok: true, data: out }
    } catch (e) {
      return err(e)
    }
  },

  conversationsList: async () => convRepo.list(),
  conversationsCreate: async (agentId) => {
    const agent = agentId ? agentsRepo.get(agentId) : agentsRepo.manager()
    if (!agent) throw new Error('No agent')
    // Reuse an untouched chat instead of piling up empty "New chat"s.
    const empty = convRepo.list().find((c) => c.agentId === agent.id && msgRepo.list(c.id).length === 0)
    if (empty) return empty
    const c = convRepo.create(agent.id, agent.isManager ? 'New chat' : agent.name)
    emit({ type: 'conversations:changed' })
    return c
  },
  conversationsOpenForAgent: async (agentId) => {
    const existing = convRepo.latestForAgent(agentId)
    if (existing) return existing
    return handlers.conversationsCreate(agentId) as ReturnType<AgentCloudApi['conversationsCreate']>
  },
  conversationsRename: async (id, title) => {
    convRepo.rename(id, title.trim() || 'Untitled chat')
    emit({ type: 'conversations:changed' })
  },
  conversationsDelete: async (id) => {
    dropSession(id)
    convRepo.delete(id)
    emit({ type: 'conversations:changed' })
  },
  chatItems: async (id) => msgRepo.list(id),
  chatSend: async (id, text, attachments) => {
    try {
      await sessionFor(id).send(text, attachments)
      return { ok: true, data: undefined }
    } catch (e) {
      return err(e)
    }
  },
  chatRetry: async (id) => {
    await sessionFor(id).retryLast()
  },
  chatStop: async (id) => {
    await sessionFor(id).interrupt()
  },
  chatBusy: async () => busyMap(),
  answerQuestion: async (itemId, value) => answer(itemId, value),
  answerPermission: async (itemId, allow) => answer(itemId, allow ? 'allow' : 'deny'),
  importAttachments: async (paths) => {
    try {
      const ws = settingsRepo.getAll().workspace
      if (!ws || !fs.existsSync(ws)) return { ok: false, error: 'Choose a workspace folder first.' }
      const dir = path.join(ws, 'attachments')
      fs.mkdirSync(dir, { recursive: true })
      const out: string[] = []
      for (const p of paths) {
        if (!fs.statSync(p).isFile()) continue
        const ext = path.extname(p)
        const base = path.basename(p, ext)
        let dest = path.join(dir, base + ext)
        for (let i = 2; fs.existsSync(dest); i++) dest = path.join(dir, `${base} (${i})${ext}`)
        fs.copyFileSync(p, dest)
        out.push(path.relative(ws, dest).replace(/\\/g, '/'))
      }
      return { ok: true, data: out }
    } catch (e) {
      return err(e)
    }
  },

  tasksList: async () => tasksRepo.list(),
  tasksEvents: async (id) => tasksRepo.events(id),
  tasksCreate: async (input) => {
    const manager = agentsRepo.manager()
    const managerConv = manager ? convRepo.latestForAgent(manager.id) : null
    if (!input.agentId) {
      // "Let the Manager decide": hand it to the Manager as a request instead of creating the task directly.
      const convId = managerConv?.id ?? (manager ? convRepo.create(manager.id, 'New chat').id : null)
      if (!convId || !manager) throw new Error('The Manager is not set up yet.')
      await deliverToManager(convId, `[agentCloud update] The user wrote a new task on the Tasks board and asked you to decide who should do it.
Title: ${input.title}
Description: ${input.description || '(none)'}
Priority: ${input.priority ?? 'normal'}

Pick or hire the right agent, then create_task with a complete brief and start_task. Afterwards briefly tell the user who is on it.`, { level: 'info', text: `You asked ${manager.name} to handle “${input.title}”` })
      emit({ type: 'navigate', to: 'conversation', id: convId })
      return null
    }
    const t = tasksRepo.create({ title: input.title, description: input.description, agentId: input.agentId, conversationId: managerConv?.id ?? null, priority: input.priority })
    tasksRepo.addEvent(t.id, 'status', { status: 'todo', text: 'Created by you' })
    emit({ type: 'task:update', task: t })
    if (input.start) await startTask(t.id)
    return tasksRepo.get(t.id)!
  },
  tasksStart: async (id) => {
    const r = await startTask(id)
    return r.ok ? { ok: true, data: undefined } : r
  },
  tasksCancel: async (id) => cancelTask(id),
  tasksRetry: async (id) => {
    const r = await startTask(id)
    return r.ok ? { ok: true, data: undefined } : r
  },
  tasksResume: async (id) => {
    const r = await startTask(id, { resume: true })
    return r.ok ? { ok: true, data: undefined } : r
  },
  tasksReassign: async (id, agentId) => {
    if (isTaskRunning(id)) cancelTask(id)
    const t = tasksRepo.update(id, { agentId, status: 'todo', error: null, lastActivity: `Reassigned to ${agentsRepo.get(agentId)?.name ?? 'another agent'}`, sdkSessionId: null })!
    emit({ type: 'task:update', task: t })
    return t
  },
  tasksMoveToTodo: async (id) => {
    if (isTaskRunning(id)) cancelTask(id)
    await new Promise((r) => setTimeout(r, 50))
    const t = tasksRepo.update(id, { status: 'todo', lastActivity: 'Moved back to To do', finishedAt: null })
    if (t) emit({ type: 'task:update', task: t })
  },
  tasksAskManagerToFix: async (id) => {
    const t = tasksRepo.get(id)
    if (!t) return { ok: false, error: 'Task not found' }
    const agent = t.agentId ? agentsRepo.get(t.agentId) : null
    const manager = agentsRepo.manager()
    const convId = (t.conversationId && convRepo.get(t.conversationId)?.agentId === manager?.id ? t.conversationId : null) ?? (manager ? convRepo.latestForAgent(manager.id)?.id : null)
    if (!convId) return { ok: false, error: 'No chat with the Manager yet.' }
    await deliverToManager(convId, `[agentCloud update] The task "${t.title}" (id: ${t.id}, agent: ${agent?.name ?? 'none'}) FAILED with: ${t.error ?? 'unknown error'}.\nThe user asked you to fix it. Figure out what went wrong, adjust the brief or agent (or hire a better one), create a new task and start it. Tell the user briefly what you are changing.`, { level: 'info', text: `You asked ${manager!.name} to fix “${t.title}”` })
    return { ok: true, data: convId }
  },
  tasksDelete: async (id) => {
    if (isTaskRunning(id)) cancelTask(id)
    tasksRepo.delete(id)
  },
  stopAll: async () => stopAll(),

  mcpList: async () => listMcpServers(),
  mcpSave: async (name, config, scope) => {
    try {
      await saveMcpServer(name, config, scope)
      resetIdleSessions()
      return { ok: true, data: undefined }
    } catch (e) {
      return err(e)
    }
  },
  mcpRemove: async (name, scope) => {
    try {
      await removeMcpServer(name, scope)
      resetIdleSessions()
      return { ok: true, data: undefined }
    } catch (e) {
      return err(e)
    }
  },
  mcpTest: (name, config) => testMcpServer(name, config),

  skillsList: async () => listSkills(),
  skillsAdd: async (source, scope) => {
    try {
      await addSkill(source, scope)
      resetIdleSessions()
      return { ok: true, data: undefined }
    } catch (e) {
      return err(e)
    }
  },
  skillsToggle: async (name, enabled) => {
    const s = settingsRepo.getAll()
    const set = new Set(s.disabledSkills)
    if (enabled) set.delete(name)
    else set.add(name)
    settingsRepo.set({ disabledSkills: [...set] })
    resetIdleSessions()
  },
  skillsRemove: async (p) => {
    try {
      removeSkill(p)
      return { ok: true, data: undefined }
    } catch (e) {
      return err(e)
    }
  },

  pluginsList: () => listPlugins(),
  pluginsToggle: async (id, enabled) => {
    try {
      await togglePlugin(id, enabled)
      resetIdleSessions()
      return { ok: true, data: undefined }
    } catch (e) {
      return err(e)
    }
  },
  pluginsInstallLocal: async (p) => {
    try {
      addLocalPlugin(p)
      resetIdleSessions()
      return { ok: true, data: undefined }
    } catch (e) {
      return err(e)
    }
  },
  pluginsInstallMarketplace: async (source, plugin) => {
    try {
      return { ok: true, data: await installMarketplace(source, plugin) }
    } catch (e) {
      return err(e)
    }
  },
  pluginsRemove: async (id) => {
    try {
      await removePlugin(id)
      return { ok: true, data: undefined }
    } catch (e) {
      return err(e)
    }
  },

  chromeStatus: async () => chromeStatus(),
  telegramStatus: async () => telegramStatus(),
  telegramConnect: async (token) => {
    try {
      return { ok: true, data: await connectTelegram(token) }
    } catch (e) {
      return err(e)
    }
  },
  telegramDisconnect: async () => disconnectTelegram(),
  telegramUnlink: async (chatId) => unlinkTelegramChat(chatId),
  telegramNewCode: async () => newPairingCode(),

  usageSummary: async () => usageRepo.summary(),
  search: async (q) => (q.trim() ? searchAll(q.trim()) : [])
}

function registerIpc() {
  for (const [name, fn] of Object.entries(handlers)) {
    ipcMain.handle(`api:${name}`, async (_e, ...args: unknown[]) => {
      try {
        return await (fn as (...a: unknown[]) => unknown)(...args)
      } catch (e) {
        log.error(`IPC ${name} failed`, e)
        throw new Error(e instanceof Error ? e.message : String(e))
      }
    })
  }
}

// ---------------------------------------------------------------- lifecycle

app.whenReady().then(() => {
  app.setAppUserModelId('com.agentcloud.app')
  try {
    getDb()
    ensureManager()
    const interrupted = tasksRepo.markInterrupted()
    if (interrupted) log.info(`Marked ${interrupted} task(s) as interrupted after restart`)
    msgRepo.expirePending()
  } catch (e) {
    log.error('startup failed', e)
    dialog.showErrorBox('agentCloud could not start', 'Its data file could not be opened. Try restarting your computer. If that does not help, reinstall agentCloud.')
  }
  registerIpc()
  createWindow()
  try {
    startTelegram()
  } catch (e) {
    log.error('telegram start failed', e)
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('window-all-closed', () => {
  stopAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopTelegram()
  stopAll()
})
