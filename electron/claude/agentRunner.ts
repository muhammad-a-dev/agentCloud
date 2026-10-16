// Runs each task as its own Agent SDK session, in parallel, in the background.
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import type * as SDK from '@anthropic-ai/claude-agent-sdk'
import type { Task } from '@shared/types'
import { agentsRepo, convRepo, settingsRepo, tasksRepo, usageRepo } from '../db/repos'
import { emit } from '../events'
import { log } from '../logging'
import { agentServer } from './appTools'
import { enabledSkillsFor, localPluginConfigs, mcpConfigsFor } from './config'
import { SAFE_TOOLS, cancelWaitersForTask, notifyDesktop, pushItem, requestPermission } from './interactions'
import { agentSystemPrompt, deliverToManager, managerConversationFor } from './manager'
import { isWorkflowConversation } from '../workflows'
import { APP_SERVER, MODEL_IDS, browserOptions, classifyError, claudeExecutable, friendlyFromCode, loadSdk, permissionOptions, sessionEnv, toolsFor } from './sdk'

interface Running { ac: AbortController; cancelled: boolean }
const running = new Map<string, Running>()

export const isTaskRunning = (id: string) => running.has(id)
export const runningCount = () => running.size

function update(id: string, patch: Partial<Task>): Task | null {
  const t = tasksRepo.update(id, patch)
  if (t) emit({ type: 'task:update', task: t })
  return t
}

function event(taskId: string, type: Parameters<typeof tasksRepo.addEvent>[1], payload: Record<string, unknown>) {
  emit({ type: 'task:event', event: tasksRepo.addEvent(taskId, type, payload) })
}

function relPath(p: string): string {
  const ws = settingsRepo.getAll().workspace
  if (!ws || !p) return p
  const rel = path.relative(ws, path.resolve(ws, p))
  return rel.startsWith('..') ? p : rel.replace(/\\/g, '/')
}

function friendlyActivity(name: string, input: Record<string, unknown>): string {
  const file = typeof input.file_path === 'string' ? path.basename(input.file_path) : ''
  switch (name) {
    case 'Write': return `Writing ${file}`
    case 'Edit': case 'NotebookEdit': return `Editing ${file}`
    case 'Read': return `Reading ${file}`
    case 'Glob': case 'Grep': return 'Looking through files'
    case 'WebSearch': return `Searching the web for “${String(input.query ?? '').slice(0, 60)}”`
    case 'WebFetch': {
      try { return `Reading ${new URL(String(input.url)).hostname}` } catch { return 'Reading a web page' }
    }
    case 'Bash': case 'PowerShell': return String(input.description ?? 'Running a command')
    case 'Skill': return `Using the ${String(input.skill ?? input.command ?? '')} skill`
    case 'Task': return 'Asking a helper'
    default:
      if (name === `mcp__${APP_SERVER}__ask_user`) return 'Asking you a question'
      if (name.startsWith('mcp__claude-in-chrome__')) return 'Working in your Chrome browser'
      if (name.startsWith('mcp__')) return `Using ${name.split('__')[1]}`
      return `Using ${name}`
  }
}

export async function startTask(taskId: string, opts: { resume?: boolean } = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const task = tasksRepo.get(taskId)
  if (!task) return { ok: false, error: "That task doesn't exist anymore." }
  if (running.has(taskId)) return { ok: false, error: 'This task is already running.' }
  const agent = task.agentId ? agentsRepo.get(task.agentId) : null
  if (!agent) return { ok: false, error: 'This task has no agent assigned. Pick one first.' }
  const s = settingsRepo.getAll()
  if (!s.workspace || !fs.existsSync(s.workspace)) return { ok: false, error: "The workspace folder can't be found. Choose a new one in Settings." }

  const ac = new AbortController()
  const run: Running = { ac, cancelled: false }
  running.set(taskId, run)
  const resume = opts.resume && task.sdkSessionId ? task.sdkSessionId : undefined
  update(taskId, {
    status: 'in_progress', startedAt: resume ? task.startedAt ?? Date.now() : Date.now(), finishedAt: null, error: null,
    ...(resume ? {} : { report: null, filesChanged: [] }), lastActivity: resume ? 'Picking up where it left off…' : 'Getting started…'
  })
  event(taskId, 'status', { status: 'in_progress', text: resume ? `${agent.name} is resuming the task` : `${agent.name} started working` })
  void execute(task, agent, run, resume).catch((e) => log.error('task runner crashed', e))
  return { ok: true }
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', '.next', 'dist', 'build', '.claude'])

/** File → last-modified time for the workspace, so we can spot files made by scripts too. */
function snapshot(root: string, limit = 5000): Map<string, number> {
  const out = new Map<string, number>()
  const walk = (dir: string, depth: number) => {
    if (out.size >= limit || depth > 6) return
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (out.size >= limit) return
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full, depth + 1)
      } else if (e.isFile()) {
        try {
          out.set(full, fs.statSync(full).mtimeMs)
        } catch {
          /* vanished */
        }
      }
    }
  }
  walk(root, 0)
  return out
}

async function execute(task: Task, agent: NonNullable<ReturnType<typeof agentsRepo.get>>, run: Running, resume?: string) {
  const s = settingsRepo.getAll()
  const before = snapshot(s.workspace!)
  // Workflow steps ask their questions in the Manager chat.
  const fromWorkflow = isWorkflowConversation(task.conversationId)
  const conversationId = (fromWorkflow ? managerConversationFor(null) : task.conversationId) ?? (agentsRepo.manager() ? convRepo.latestForAgent(agentsRepo.manager()!.id)?.id : null) ?? ''
  const files = new Set(task.filesChanged)
  let finalText = ''
  let costUsd = task.costUsd
  let tokens = task.tokens
  let failure: string | null = null
  const pendingWrites = new Map<string, string>()

  try {
    const { query } = await loadSdk()
    const restrictMcp = agent.mcp.length > 0
    const perm = permissionOptions()
    const options: SDK.Options = {
      abortController: run.ac,
      cwd: s.workspace!,
      model: MODEL_IDS[agent.model] ?? 'sonnet',
      systemPrompt: { type: 'preset', preset: 'claude_code', append: agentSystemPrompt(agent, 'task') },
      tools: toolsFor(agent.tools),
      mcpServers: { ...(restrictMcp ? mcpConfigsFor(agent.mcp) : {}), [APP_SERVER]: await agentServer({ conversationId, from: agent.name, taskId: task.id }) },
      strictMcpConfig: restrictMcp,
      settingSources: ['user', 'project', 'local'],
      skills: enabledSkillsFor(agent),
      plugins: localPluginConfigs(),
      env: sessionEnv(),
      pathToClaudeCodeExecutable: claudeExecutable(),
      stderr: (d) => log.warn(`[task:${task.id.slice(0, 8)}]`, d.slice(0, 2000)),
      ...perm,
      ...browserOptions(agent.tools.includes('browser')),
      ...(resume ? { resume } : {})
    }
    if (perm.permissionMode !== 'bypassPermissions') {
      options.canUseTool = async (toolName, input, { signal }) => {
        if (SAFE_TOOLS.has(toolName) || toolName.startsWith(`mcp__${APP_SERVER}__`)) return { behavior: 'allow', updatedInput: input }
        event(task.id, 'status', { text: `${agent.name} is asking permission to use ${toolName}` })
        const ok = await requestPermission({ conversationId, toolName, input, from: agent.name, taskId: task.id, signal })
        return ok ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'The user said no to this action. Find another way or explain in your report.' }
      }
    }
    const prompt = resume
      ? 'You were interrupted before finishing. Continue the task from where you left off, then give your report.'
      : `# Task: ${task.title}\nPriority: ${task.priority}\n\n${task.description}`

    for await (const m of query({ prompt, options })) {
      if (run.cancelled) break
      if (m.type === 'system' && m.subtype === 'init') {
        update(task.id, { sdkSessionId: m.session_id })
      } else if (m.type === 'system' && m.subtype === 'api_retry') {
        update(task.id, { lastActivity: `Claude is busy — retrying in ${Math.ceil(m.retry_delay_ms / 1000)}s…` })
      } else if (m.type === 'assistant' && !m.parent_tool_use_id) {
        if (m.error) failure = friendlyFromCode(m.error).title
        for (const b of m.message.content as { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[]) {
          if (b.type === 'text' && b.text?.trim()) {
            finalText = b.text
            event(task.id, 'text', { text: b.text })
            const firstLine = b.text.trim().split('\n')[0].replace(/[#*_`]/g, '')
            update(task.id, { lastActivity: firstLine.slice(0, 140) })
          } else if (b.type === 'tool_use' && b.name) {
            const input = b.input ?? {}
            if (b.name === 'ToolSearch') continue
            event(task.id, 'tool', { name: b.name, input, toolUseId: b.id, label: friendlyActivity(b.name, input) })
            update(task.id, { lastActivity: friendlyActivity(b.name, input) })
            if (['Write', 'Edit', 'NotebookEdit'].includes(b.name) && typeof input.file_path === 'string' && b.id) {
              pendingWrites.set(b.id, relPath(input.file_path))
            }
          }
        }
      } else if (m.type === 'user' && !m.parent_tool_use_id && Array.isArray(m.message.content)) {
        for (const b of m.message.content as { type: string; tool_use_id?: string; content?: unknown; is_error?: boolean }[]) {
          if (b.type !== 'tool_result' || !b.tool_use_id) continue
          const text = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((c: { text?: string }) => c.text ?? '').join('\n') : ''
          event(task.id, 'tool_result', { toolUseId: b.tool_use_id, isError: !!b.is_error, text: text.slice(0, 4000) })
          const file = pendingWrites.get(b.tool_use_id)
          if (file && !b.is_error) {
            files.add(file)
            event(task.id, 'file', { path: file })
            update(task.id, { filesChanged: [...files] })
          }
          pendingWrites.delete(b.tool_use_id)
        }
      } else if (m.type === 'result') {
        costUsd += m.total_cost_usd ?? 0
        const u = m.usage
        const t = u ? (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) : 0
        tokens += t
        usageRepo.add({ agentId: agent.id, taskId: task.id, costUsd: m.total_cost_usd ?? 0, tokens: t })
        if (m.subtype === 'success') {
          if (m.is_error) failure = failure ?? classifyError(new Error(m.result)).reason
          else finalText = m.result || finalText
        } else {
          failure = failure ?? (m.subtype === 'error_max_turns' ? 'The agent ran out of steps before finishing.' : classifyError(new Error(m.errors.join('\n') || 'The agent stopped unexpectedly.')).reason)
        }
      }
    }
  } catch (e) {
    const fe = classifyError(e)
    if (!run.cancelled) failure = fe.kind === 'aborted' ? 'The work was stopped.' : `${fe.title} ${fe.reason}`
    if (fe.kind !== 'aborted') log.error(`task ${task.id} failed`, e)
  } finally {
    running.delete(task.id)
    cancelWaitersForTask(task.id)
  }

  if (run.cancelled) {
    // Status was already set the moment the user pressed Cancel; just record the final usage.
    tasksRepo.update(task.id, { costUsd, tokens })
    return
  }

  const fresh = tasksRepo.get(task.id)!
  if (failure) {
    update(task.id, { status: 'failed', error: failure, finishedAt: Date.now(), lastActivity: failure, costUsd, tokens })
    event(task.id, 'error', { text: failure })
    notifyDesktop(`“${task.title}” didn't finish`, failure)
    const convId = managerConversationFor(fresh.conversationId)
    if (convId) pushItem(convId, { kind: 'notice', id: randomUUID(), level: 'error', text: `“${task.title}” didn't finish: ${failure}`, taskId: task.id, createdAt: Date.now() })
    return
  }

  for (const [file, mtime] of snapshot(s.workspace!)) {
    const prev = before.get(file)
    if (prev === undefined || prev !== mtime) files.add(relPath(file))
  }
  if (files.size !== task.filesChanged.length) update(task.id, { filesChanged: [...files] })
  const report = extractReport(finalText)
  update(task.id, { status: 'done', report, finishedAt: Date.now(), lastActivity: 'Finished', costUsd, tokens })
  event(task.id, 'report', { text: report })
  emit({ type: 'task:celebrate', taskId: task.id })
  // The workflow reports once at the end instead of after every step.
  if (fromWorkflow) return
  notifyDesktop(`${agent.name} finished “${task.title}”`, 'Open agentCloud to see the results.')
  const fileList = [...files]
  await deliverToManager(
    fresh.conversationId,
    `[agentCloud update] Task "${task.title}" (id: ${task.id}) assigned to ${agent.name} is DONE.\n\nAgent report:\n${report}\n\nFiles changed (relative to the workspace): ${fileList.length ? fileList.join(', ') : 'none'}\n\nNow tell the user, in plain friendly language and briefly, what was done. Link the task as [${task.title}](task://${task.id}) and each file as [file name](file://relative/path).`,
    { level: 'success', text: `${agent.name} finished “${task.title}”`, taskId: task.id }
  ).catch((e) => log.error('report delivery failed', e))
}

function extractReport(text: string): string {
  const idx = text.search(/^#{1,3}\s*Report\s*$/im)
  return (idx >= 0 ? text.slice(idx) : text).trim() || 'The agent finished without writing a report.'
}

export function cancelTask(taskId: string) {
  const r = running.get(taskId)
  if (r) {
    r.cancelled = true
    r.ac.abort()
    cancelWaitersForTask(taskId)
    update(taskId, { status: 'cancelled', finishedAt: Date.now(), lastActivity: 'Cancelled' })
    event(taskId, 'status', { status: 'cancelled', text: 'The task was cancelled' })
    return
  }
  const t = tasksRepo.get(taskId)
  if (t && (t.status === 'todo' || t.status === 'interrupted' || t.status === 'needs_input')) {
    update(taskId, { status: 'cancelled', finishedAt: Date.now(), lastActivity: 'Cancelled' })
  }
}

export function cancelAllTasks(): number {
  const n = running.size
  for (const id of [...running.keys()]) cancelTask(id)
  return n
}
