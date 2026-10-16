// Reads and writes the same configuration Claude Code uses: MCP servers, skills, plugins and agent files.
import { app } from 'electron'
import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type * as SDK from '@anthropic-ai/claude-agent-sdk'
import type { Agent, Capability, McpServerEntry, PluginEntry, SkillEntry } from '@shared/types'
import { settingsRepo } from '../db/repos'
import { log } from '../logging'
import { CAPABILITY_TOOLS, MODEL_IDS, claudeExecutable, loadSdk, runCli, sessionEnv } from './sdk'

const home = os.homedir()
const claudeDir = path.join(home, '.claude')
const userConfigFile = path.join(home, '.claude.json')
const workspace = () => settingsRepo.getAll().workspace

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.agentcloud.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
}

// ---------------------------------------------------------------- MCP servers

export function listMcpServers(): McpServerEntry[] {
  const out: McpServerEntry[] = []
  const user = readJson<{ mcpServers?: Record<string, Record<string, unknown>> }>(userConfigFile, {})
  for (const [name, config] of Object.entries(user.mcpServers ?? {})) out.push({ name, scope: 'user', config })
  const ws = workspace()
  if (ws) {
    const proj = readJson<{ mcpServers?: Record<string, Record<string, unknown>> }>(path.join(ws, '.mcp.json'), {})
    for (const [name, config] of Object.entries(proj.mcpServers ?? {})) out.push({ name, scope: 'project', config })
  }
  return out
}

export async function saveMcpServer(name: string, config: Record<string, unknown>, scope: 'user' | 'project') {
  if (!/^[\w.-]+$/.test(name)) throw new Error('Use only letters, numbers, dashes and dots in the name.')
  if (scope === 'project') {
    const ws = workspace()
    if (!ws) throw new Error('Choose a workspace folder first.')
    const file = path.join(ws, '.mcp.json')
    const data = readJson<{ mcpServers?: Record<string, unknown> }>(file, {})
    data.mcpServers = { ...(data.mcpServers ?? {}), [name]: config }
    writeJson(file, data)
    return
  }
  // Let the Claude Code CLI write its own (large, shared) config file.
  await runCli(['mcp', 'remove', '-s', 'user', name], { timeout: 30000 })
  const r = await runCli(['mcp', 'add-json', '-s', 'user', name, JSON.stringify(config)], { timeout: 30000 })
  if (r.code !== 0) {
    log.warn('mcp add-json failed, writing directly', r.stderr)
    const data = readJson<Record<string, unknown> & { mcpServers?: Record<string, unknown> }>(userConfigFile, {})
    data.mcpServers = { ...(data.mcpServers ?? {}), [name]: config }
    writeJson(userConfigFile, data)
  }
}

export async function removeMcpServer(name: string, scope: 'user' | 'project') {
  if (scope === 'project') {
    const ws = workspace()
    if (!ws) return
    const file = path.join(ws, '.mcp.json')
    const data = readJson<{ mcpServers?: Record<string, unknown> }>(file, {})
    if (data.mcpServers) delete data.mcpServers[name]
    writeJson(file, data)
    return
  }
  const r = await runCli(['mcp', 'remove', '-s', 'user', name], { timeout: 30000 })
  if (r.code !== 0) {
    const data = readJson<Record<string, unknown> & { mcpServers?: Record<string, unknown> }>(userConfigFile, {})
    if (data.mcpServers) delete data.mcpServers[name]
    writeJson(userConfigFile, data)
  }
}

/** Starts a throwaway session with only this server and reports whether it connected. */
export async function testMcpServer(name: string, config: Record<string, unknown>): Promise<{ ok: boolean; message: string; details?: string }> {
  const { query } = await loadSdk()
  const ac = new AbortController()
  let release: () => void = () => {}
  const hold = new Promise<void>((r) => (release = r))
  async function* idle(): AsyncGenerator<SDK.SDKUserMessage> {
    await hold
  }
  const q = query({
    prompt: idle(),
    options: {
      abortController: ac,
      cwd: workspace() && fs.existsSync(workspace()!) ? workspace()! : app.getPath('userData'),
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
      mcpServers: { [name]: config as unknown as SDK.McpServerConfig },
      env: sessionEnv(),
      pathToClaudeCodeExecutable: claudeExecutable()
    }
  })
  try {
    await q.initializationResult()
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      const st = (await q.mcpServerStatus()).find((s) => s.name === name)
      if (st && st.status !== 'pending') {
        if (st.status === 'connected') {
          const n = st.tools?.length ?? 0
          return { ok: true, message: `Connected! ${n} action${n === 1 ? '' : 's'} available.` }
        }
        if (st.status === 'needs-auth') return { ok: false, message: 'This connection needs you to sign in first.', details: st.error }
        return { ok: false, message: "Couldn't connect. Check the settings and try again.", details: st.error ?? st.status }
      }
      await new Promise((r) => setTimeout(r, 700))
    }
    return { ok: false, message: 'The connection took too long to respond.', details: 'Timed out after 30 seconds.' }
  } catch (e) {
    return { ok: false, message: "Couldn't start the connection.", details: e instanceof Error ? e.message : String(e) }
  } finally {
    release()
    ac.abort()
  }
}

/** MCP configs for an agent that is restricted to specific connections. */
export function mcpConfigsFor(names: string[]): Record<string, SDK.McpServerConfig> {
  const all = listMcpServers()
  const out: Record<string, SDK.McpServerConfig> = {}
  for (const n of names) {
    const s = all.find((x) => x.name === n)
    if (s) out[n] = s.config as unknown as SDK.McpServerConfig
  }
  return out
}

// ---------------------------------------------------------------- skills

function parseFrontmatter(text: string): { data: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) return { data: {}, body: text }
  const data: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line)
    if (kv) data[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim()
  }
  return { data, body: m[2] }
}

function skillDirs(): { dir: string; scope: 'user' | 'project' }[] {
  const dirs: { dir: string; scope: 'user' | 'project' }[] = [{ dir: path.join(claudeDir, 'skills'), scope: 'user' }]
  const ws = workspace()
  if (ws) dirs.push({ dir: path.join(ws, '.claude', 'skills'), scope: 'project' })
  return dirs
}

export function listSkills(): SkillEntry[] {
  const disabled = new Set(settingsRepo.getAll().disabledSkills)
  const out: SkillEntry[] = []
  for (const { dir, scope } of skillDirs()) {
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue
      const p = path.join(dir, e.name)
      const md = path.join(p, 'SKILL.md')
      if (!fs.existsSync(md)) continue
      const { data } = parseFrontmatter(fs.readFileSync(md, 'utf8'))
      const name = data.name || e.name
      out.push({ name, description: data.description || '', path: p, scope, enabled: !disabled.has(name) })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Value for the SDK `skills` option. */
export function enabledSkillsFor(agent: Agent | null): string[] | 'all' {
  const disabled = settingsRepo.getAll().disabledSkills
  if (agent && agent.skills.length) return agent.skills.filter((s) => !disabled.includes(s))
  if (!disabled.length) return 'all'
  return listSkills().filter((s) => s.enabled).map((s) => s.name)
}

export async function addSkill(source: string, scope: 'user' | 'project') {
  const base = scope === 'user' ? path.join(claudeDir, 'skills') : path.join(workspace() ?? '', '.claude', 'skills')
  if (scope === 'project' && !workspace()) throw new Error('Choose a workspace folder first.')
  fs.mkdirSync(base, { recursive: true })
  let srcDir = source
  let tmp: string | null = null
  if (source.toLowerCase().endsWith('.zip')) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcloud-skill-'))
    await new Promise<void>((resolve, reject) => {
      const [cmd, args] = process.platform === 'linux' ? ['unzip', ['-q', source, '-d', tmp!]] : ['tar', ['-xf', source, '-C', tmp!]]
      execFile(cmd, args as string[], { windowsHide: true }, (err) => (err ? reject(new Error("Couldn't unpack the zip file.")) : resolve()))
    })
    srcDir = findSkillRoot(tmp) ?? tmp
  }
  if (!fs.existsSync(path.join(srcDir, 'SKILL.md'))) {
    const nested = findSkillRoot(srcDir)
    if (!nested) throw new Error("That folder doesn't contain a SKILL.md file, so it isn't a skill.")
    srcDir = nested
  }
  const { data } = parseFrontmatter(fs.readFileSync(path.join(srcDir, 'SKILL.md'), 'utf8'))
  const name = (data.name || path.basename(srcDir)).replace(/[^\w.-]/g, '-')
  const dest = path.join(base, name)
  if (fs.existsSync(dest)) throw new Error(`A skill called “${name}” is already installed.`)
  fs.cpSync(srcDir, dest, { recursive: true })
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
}

function findSkillRoot(dir: string, depth = 0): string | null {
  if (fs.existsSync(path.join(dir, 'SKILL.md'))) return dir
  if (depth > 3) return null
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      const r = findSkillRoot(path.join(dir, e.name), depth + 1)
      if (r) return r
    }
  }
  return null
}

export function removeSkill(p: string) {
  const allowed = skillDirs().some(({ dir }) => path.resolve(p).startsWith(path.resolve(dir) + path.sep))
  if (!allowed) throw new Error('That folder is not a skill folder.')
  fs.rmSync(p, { recursive: true, force: true })
}

// ---------------------------------------------------------------- plugins

export async function listPlugins(): Promise<PluginEntry[]> {
  const out: PluginEntry[] = []
  const r = await runCli(['plugin', 'list', '--json'], { timeout: 45000 })
  try {
    const arr = JSON.parse(r.stdout) as { id: string; version?: string; scope: string; enabled: boolean; installPath?: string }[]
    for (const p of arr) out.push({ id: p.id, version: p.version, scope: p.scope, enabled: p.enabled, installPath: p.installPath })
  } catch {
    log.warn('plugin list failed', r.stderr.slice(0, 300))
  }
  for (const p of settingsRepo.getAll().localPlugins) {
    out.push({ id: path.basename(p), scope: 'local folder', enabled: true, installPath: p, local: true })
  }
  return out
}

export async function togglePlugin(id: string, enabled: boolean) {
  const r = await runCli(['plugin', enabled ? 'enable' : 'disable', id], { timeout: 45000 })
  if (r.code !== 0) throw new Error(cleanCliError(r.stderr || r.stdout))
}

export async function installMarketplace(source: string, plugin?: string): Promise<string> {
  const r = await runCli(['plugin', 'marketplace', 'add', source], { timeout: 120000 })
  if (r.code !== 0 && !/already/i.test(r.stderr + r.stdout)) throw new Error(cleanCliError(r.stderr || r.stdout))
  if (plugin) {
    const i = await runCli(['plugin', 'install', plugin, '-s', 'user', '-y'], { timeout: 180000 })
    if (i.code !== 0) throw new Error(cleanCliError(i.stderr || i.stdout))
    return `Installed ${plugin}.`
  }
  return 'Marketplace added. You can now install plugins from it.'
}

export async function removePlugin(id: string) {
  const s = settingsRepo.getAll()
  const local = s.localPlugins.find((p) => path.basename(p) === id)
  if (local) {
    settingsRepo.set({ localPlugins: s.localPlugins.filter((p) => p !== local) })
    return
  }
  const r = await runCli(['plugin', 'uninstall', id], { timeout: 60000 })
  if (r.code !== 0) throw new Error(cleanCliError(r.stderr || r.stdout))
}

export function addLocalPlugin(p: string) {
  const manifest = [path.join(p, '.claude-plugin', 'plugin.json'), path.join(p, 'plugin.json')]
  if (!manifest.some((m) => fs.existsSync(m))) throw new Error("That folder doesn't look like a plugin (no .claude-plugin/plugin.json).")
  const s = settingsRepo.getAll()
  if (!s.localPlugins.includes(p)) settingsRepo.set({ localPlugins: [...s.localPlugins, p] })
}

export function localPluginConfigs(): SDK.SdkPluginConfig[] {
  return settingsRepo.getAll().localPlugins.filter((p) => fs.existsSync(p)).map((p) => ({ type: 'local' as const, path: p }))
}

function cleanCliError(s: string) {
  const line = s.split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? 'The command failed.'
  return line.replace(/^error:\s*/i, '')
}

// ---------------------------------------------------------------- agent .md files (Claude Code format)

const MODEL_FROM_ID: Record<string, Agent['model']> = { opus: 'smartest', sonnet: 'balanced', haiku: 'fastest' }

export function agentToMarkdown(a: Agent): string {
  const tools = a.tools.flatMap((c) => CAPABILITY_TOOLS[c] ?? [])
  const slug = a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const lines = [
    '---',
    `name: ${slug || 'agent'}`,
    `description: ${(a.role || a.name).replace(/\n/g, ' ')}`,
    tools.length ? `tools: ${tools.join(', ')}` : null,
    `model: ${MODEL_IDS[a.model]}`,
    `color: ${a.color}`,
    `agentcloud-name: ${a.name}`,
    `agentcloud-avatar: ${a.avatar}`,
    a.mcp.length ? `agentcloud-connections: ${a.mcp.join(', ')}` : null,
    '---',
    '',
    a.instructions.trim(),
    ''
  ]
  return lines.filter((l) => l !== null).join('\n')
}

export function agentFromMarkdown(text: string): Partial<Agent> & { name: string } {
  const { data, body } = parseFrontmatter(text)
  if (!data.name && !data['agentcloud-name']) throw new Error('This file is missing a name in its header.')
  const toolNames = (data.tools ?? '').split(',').map((t) => t.trim()).filter(Boolean)
  const caps = (Object.keys(CAPABILITY_TOOLS) as Capability[]).filter((c) =>
    toolNames.length ? CAPABILITY_TOOLS[c].some((t) => toolNames.includes(t)) : c !== 'helpers'
  )
  const prettify = (s: string) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  return {
    name: data['agentcloud-name'] || prettify(data.name),
    role: data.description ?? '',
    instructions: body.trim(),
    tools: caps,
    model: MODEL_FROM_ID[data.model] ?? 'balanced',
    color: /^#[0-9a-f]{6}$/i.test(data.color ?? '') ? data.color : '#F7A51C',
    avatar: data['agentcloud-avatar'] || '🤖',
    mcp: (data['agentcloud-connections'] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  }
}
