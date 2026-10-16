// Loads the Claude Agent SDK and builds the options shared by every session.
import { app, safeStorage } from 'electron'
import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type * as SDK from '@anthropic-ai/claude-agent-sdk'
import type { AuthStatus, Capability, ChromeStatus, FriendlyError, ModelChoice } from '@shared/types'
import { settingsRepo } from '../db/repos'
import { log } from '../logging'

let sdkPromise: Promise<typeof SDK> | null = null

/** The SDK is ESM-only; the main bundle is CommonJS, so load it with a real dynamic import. */
export function loadSdk(): Promise<typeof SDK> {
  if (!sdkPromise) sdkPromise = import('@anthropic-ai/claude-agent-sdk')
  return sdkPromise
}

/** Path to the bundled Claude Code binary (unpacked from the asar archive when packaged). */
export function claudeExecutable(): string | undefined {
  const pkg = `claude-agent-sdk-${process.platform}-${process.arch}`
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const candidates = [
    path.join(app.getAppPath(), 'node_modules', '@anthropic-ai', pkg, exe),
    path.join(process.cwd(), 'node_modules', '@anthropic-ai', pkg, exe)
  ].map((p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`))
  return candidates.find((p) => fs.existsSync(p))
}

// ---------------------------------------------------------------- API key (encrypted with safeStorage)

const KEY_SETTING = 'apiKeyEnc'

export function getStoredApiKey(): string | null {
  const enc = settingsRepo.getRaw<string | null>(KEY_SETTING, null)
  if (!enc || !safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return null
  }
}

export function storeApiKey(key: string) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this computer.')
  settingsRepo.setRaw(KEY_SETTING, safeStorage.encryptString(key).toString('base64'))
}

export function clearApiKey() {
  settingsRepo.deleteRaw(KEY_SETTING)
}

export function sessionEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'agentcloud/0.1.0' }
  const key = getStoredApiKey()
  if (key) env.ANTHROPIC_API_KEY = key
  return env
}

// ---------------------------------------------------------------- auth check

function runCli(args: string[], opts: { timeout?: number; env?: Record<string, string | undefined>; cwd?: string } = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const exe = claudeExecutable()
    if (!exe) return resolve({ code: -1, stdout: '', stderr: 'Claude Code is missing from this installation.' })
    execFile(
      exe,
      args,
      { timeout: opts.timeout ?? 60000, env: (opts.env ?? sessionEnv()) as NodeJS.ProcessEnv, cwd: opts.cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code: unknown = err ? (err as { code?: unknown }).code ?? 1 : 0
        resolve({ code: typeof code === 'number' ? code : 1, stdout: String(stdout), stderr: String(stderr || (err ? err.message : '')) })
      }
    )
  })
}
export { runCli }

export async function checkAuth(): Promise<AuthStatus> {
  const hasStoredKey = !!getStoredApiKey()
  if (hasStoredKey) {
    // Validate the key with a tiny request through the SDK.
    const ok = await validateWithSdk()
    return ok.ok
      ? { ok: true, method: 'api_key', hasStoredKey, email: ok.email }
      : { ok: false, method: 'none', hasStoredKey, message: ok.message }
  }
  const r = await runCli(['auth', 'status'], { timeout: 30000 })
  try {
    const j = JSON.parse(r.stdout)
    if (j.loggedIn) return { ok: true, method: j.authMethod === 'api_key' ? 'api_key' : 'claude', email: j.email, plan: planName(j.subscriptionType), hasStoredKey }
  } catch {
    log.warn('auth status output not JSON', r.stdout.slice(0, 300), r.stderr.slice(0, 300))
  }
  if (process.env.ANTHROPIC_API_KEY) return { ok: true, method: 'api_key', hasStoredKey }
  return { ok: false, method: 'none', hasStoredKey, message: 'Not signed in yet.' }
}

function planName(p: unknown): string | undefined {
  if (typeof p !== 'string' || !p) return undefined
  return /^claude/i.test(p) ? p : `Claude ${p.charAt(0).toUpperCase()}${p.slice(1)}`
}

async function validateWithSdk(): Promise<{ ok: boolean; email?: string; message?: string }> {
  try {
    const { query } = await loadSdk()
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 60000)
    const q = query({
      prompt: 'Reply with OK.',
      options: { abortController: ac, cwd: app.getPath('userData'), settingSources: [], persistSession: false, model: 'haiku', maxTurns: 1, tools: [], env: sessionEnv(), pathToClaudeCodeExecutable: claudeExecutable() }
    })
    for await (const m of q) {
      if (m.type === 'assistant' && m.error) {
        clearTimeout(timer)
        ac.abort()
        return { ok: false, message: friendlyFromCode(m.error).reason }
      }
      if (m.type === 'result') {
        clearTimeout(timer)
        if (m.is_error) return { ok: false, message: m.subtype === 'success' ? m.result : m.errors.join(' ') }
        return { ok: true }
      }
    }
    clearTimeout(timer)
    return { ok: false, message: 'No reply from Claude.' }
  } catch (e) {
    return { ok: false, message: classifyError(e).reason }
  }
}

// ---------------------------------------------------------------- mapping helpers

export const CAPABILITY_TOOLS: Record<Capability, string[]> = {
  read: ['Read', 'Glob', 'Grep'],
  write: ['Write', 'Edit', 'NotebookEdit'],
  commands: ['Bash', 'PowerShell'],
  web_search: ['WebSearch'],
  web_fetch: ['WebFetch'],
  browser: [], // Claude in Chrome tools come from an MCP server, see browserOptions()
  skills: ['Skill'],
  helpers: ['Task']
}

export function toolsFor(caps: Capability[]): string[] {
  const set = new Set<string>(['ToolSearch'])
  for (const c of caps) for (const t of CAPABILITY_TOOLS[c] ?? []) set.add(t)
  return [...set]
}

export const MODEL_IDS: Record<ModelChoice, string> = { smartest: 'opus', balanced: 'sonnet', fastest: 'haiku' }

/** Permission-related options shared by manager, chats and task runners. */
export function permissionOptions(): Partial<SDK.Options> {
  const s = settingsRepo.getAll()
  const deny = s.blockedCommands.filter(Boolean).flatMap((c) => [`Bash(${c}:*)`, `PowerShell(${c}:*)`])
  const allow = s.allowedCommands.filter(Boolean).flatMap((c) => [`Bash(${c}:*)`, `PowerShell(${c}:*)`])
  const settings: SDK.Settings = { permissions: { allow, deny } } as SDK.Settings
  if (s.permissionMode === 'full') {
    return { permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true, settings }
  }
  return { permissionMode: 'default', settings }
}

// ---------------------------------------------------------------- Chrome

export const CHROME_SERVER = 'claude-in-chrome'

/** What we know about the Claude in Chrome extension on this computer. */
export function chromeStatus(): ChromeStatus {
  let cfg: Record<string, unknown> = {}
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'))
  } catch {
    /* no Claude Code config yet */
  }
  return {
    enabled: settingsRepo.getAll().chromeEnabled,
    extensionInstalled: cfg.cachedChromeExtensionInstalled === true,
    paired: !!(cfg.chromeExtension as { pairedDeviceId?: string } | undefined)?.pairedDeviceId
  }
}

/**
 * Lets a session drive the user's own Chrome (with their logins) through the Claude in Chrome
 * extension, and hides Playwright, which opens a separate empty browser instead.
 */
export function browserOptions(wantsBrowser: boolean): Partial<SDK.Options> {
  if (!wantsBrowser || !settingsRepo.getAll().chromeEnabled) return {}
  return { extraArgs: { chrome: null }, disallowedTools: ['mcp__playwright'] }
}

export const BROWSER_GUIDE = `
## Using the user's Chrome browser
When the user asks you to do something "in my Chrome", "in my browser" or on a website, use the Claude in Chrome tools (named mcp__claude-in-chrome__…; load them with ToolSearch if needed).
They control the user's real Chrome, where the user is already logged in. Start with tabs_context_mcp (createIfEmpty: true), then navigate, read_page / find, and computer (click, type, scroll, screenshot) to act on the page.
Never use Playwright for this — it opens a separate, empty browser.
If the Chrome tools fail to connect, tell the user simply: "Please open Chrome and make sure the Claude extension is turned on", then try again.`

// ---------------------------------------------------------------- errors

export function friendlyFromCode(code: string, detail?: string): FriendlyError {
  switch (code) {
    case 'authentication_failed':
    case 'oauth_org_not_allowed':
    case 'verification_required':
    case 'cloud_credential_error':
      return { kind: 'auth', title: "agentCloud can't reach Claude right now. Let's reconnect.", reason: 'Your sign-in has expired or the API key was not accepted.', action: 'reconnect', details: detail }
    case 'billing_error':
    case 'account_on_hold':
      return { kind: 'billing', title: 'There is a problem with your Claude account.', reason: 'Claude says the account needs attention (billing or plan). Check your account on claude.ai.', action: 'reconnect', details: detail }
    case 'rate_limit':
    case 'overloaded':
    case 'server_error':
      return { kind: 'rate_limit', title: 'Claude is busy right now.', reason: 'Too many requests at once. This usually clears up within a minute.', action: 'retry', details: detail }
    default:
      return { kind: 'unknown', title: 'Something went wrong.', reason: detail ? shorten(detail) : 'Claude stopped unexpectedly.', action: 'retry', details: detail }
  }
}

function shorten(s: string) {
  const first = s.split('\n')[0]
  return first.length > 180 ? first.slice(0, 177) + '…' : first
}

export function classifyError(e: unknown): FriendlyError {
  const msg = e instanceof Error ? e.message : String(e)
  const m = msg.toLowerCase()
  if (e instanceof Error && (e.name === 'AbortError' || m.includes('aborted'))) {
    return { kind: 'aborted', title: 'Stopped.', reason: 'The work was stopped.', action: 'none' }
  }
  if (/enotfound|econnrefused|etimedout|econnreset|getaddrinfo|fetch failed|network|socket hang up|offline/.test(m)) {
    return { kind: 'network', title: "You're offline.", reason: "agentCloud can't reach the internet. Your message will be sent when you're back online.", action: 'retry', details: msg }
  }
  if (/invalid api key|not logged in|please run \/login|authentication|401|oauth token|credentials/.test(m)) {
    return friendlyFromCode('authentication_failed', msg)
  }
  if (/rate.?limit|overloaded|429|529|too many requests/.test(m)) return friendlyFromCode('rate_limit', msg)
  if (/you've hit your|usage limit|out of usage|reached your/.test(m)) {
    return { kind: 'billing', title: "You've reached your Claude usage limit.", reason: shorten(msg), action: 'none', details: msg }
  }
  if (/enoent|cwd|no such file or directory/.test(m) && /workspace|cwd|directory/.test(m)) {
    return { kind: 'workspace', title: "Your workspace folder can't be found.", reason: 'It may have been moved or deleted. Choose a new one.', action: 'choose_workspace', details: msg }
  }
  return { kind: 'unknown', title: 'Something went wrong.', reason: shorten(msg), action: 'retry', details: msg }
}

export function workspaceOk(): boolean {
  const ws = settingsRepo.getAll().workspace
  return !!ws && fs.existsSync(ws)
}
