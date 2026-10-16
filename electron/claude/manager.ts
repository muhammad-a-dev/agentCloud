// Long-lived chat sessions: the Manager, and direct chats with any agent.
import { randomUUID } from 'crypto'
import fs from 'fs'
import type * as SDK from '@anthropic-ai/claude-agent-sdk'
import type { Agent, ChatItem, FriendlyError } from '@shared/types'
import { agentsRepo, convRepo, msgRepo, settingsRepo, usageRepo } from '../db/repos'
import { emit } from '../events'
import { log } from '../logging'
import { APP_SERVER, activityFor, agentServer, managerServer } from './appTools'
import { enabledSkillsFor, listMcpServers, localPluginConfigs, mcpConfigsFor } from './config'
import { SAFE_TOOLS, pushItem, requestPermission } from './interactions'
import {
  BROWSER_GUIDE, MODEL_IDS, browserOptions, classifyError, claudeExecutable, friendlyFromCode, loadSdk, permissionOptions, sessionEnv, toolsFor
} from './sdk'
import { telegramChatFor } from '../telegram'
import { mediaFromToolResult } from '../media'
import { FIND_SKILLS, hasFindSkills } from './skillHub'
import type { Capability } from '@shared/types'

const MANAGER_CAPS: Capability[] = ['read', 'write', 'commands', 'web_search', 'web_fetch']

/** The Manager carries only the find-skills skill, which keeps every chat turn small and cheap. */
function managerSkills(): { caps: Capability[]; skills: string[] } {
  return hasFindSkills() ? { caps: [...MANAGER_CAPS, 'skills'], skills: [FIND_SKILLS] } : { caps: MANAGER_CAPS, skills: [] }
}

/** Simple async queue used as the streaming-input prompt of a query. */
class InputQueue implements AsyncIterable<SDK.SDKUserMessage> {
  private items: SDK.SDKUserMessage[] = []
  private waiters: ((r: IteratorResult<SDK.SDKUserMessage>) => void)[] = []
  private closed = false
  push(m: SDK.SDKUserMessage) {
    const w = this.waiters.shift()
    if (w) w({ value: m, done: false })
    else this.items.push(m)
  }
  close() {
    this.closed = true
    for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true })
  }
  [Symbol.asyncIterator](): AsyncIterator<SDK.SDKUserMessage> {
    return {
      next: () => {
        const m = this.items.shift()
        if (m) return Promise.resolve({ value: m, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((r) => this.waiters.push(r))
      }
    }
  }
}

const RETRY_DELAYS = [20, 40, 80]
const MAX_RESULT_CHARS = 20000

const PLAIN_ENGLISH = `
## How you talk (very important)
The user is NOT technical. Write the way you would text a friend who has never used a computer terminal.
- Use short sentences and everyday words. Aim for words a 12-year-old knows.
- No tech words: never say things like MCP, API, tool call, repository, terminal, script, JSON, markdown, agent SDK, session, prompt, token, deploy.
  If you must mention something technical, explain it in a few plain words instead (e.g. "a small program", "your files", "a connection to Gmail").
- Keep replies short: 1–4 sentences, or a few simple bullet points.
- Say what you did, what happens next, and what you need from the user (if anything).
- Be warm and positive. No long explanations unless they ask.`

const MEDIA_GUIDE = `
## Showing pictures, videos and files in the chat
The chat shows media. Screenshots you take appear in the chat by themselves — don't copy or link them again unless the user wants to keep the file.
To show any other picture, video, sound or document, save it as a file and link it: [name](file://path/inside/workspace) — the chat shows a preview.
So when the user says "show me", "send me" or "take a screenshot and show it", make sure the file is saved and linked.`

export function managerSystemPrompt(manager: Agent, opts: { telegram?: boolean } = {}): string {
  const s = settingsRepo.getAll()
  const connections = listMcpServers().map((m) => m.name)
  const chrome = s.chromeEnabled
  return `
# You are ${manager.name}, the user's ${manager.role} inside agentCloud
Personality: ${s.managerPersona}
${manager.instructions ? `
Extra instructions from the user:
${manager.instructions}
` : ''}
${PLAIN_ENGLISH}

## Small jobs: do them yourself
If a request is tiny — a few quick steps, done in about a minute — just do it yourself. Do NOT hire anyone and do NOT ask questions first.
Small jobs are ONLY things like: a quick web search or fact check, answering a question, looking up a price or the weather, reading or summarising a file,
renaming, moving or copying a few files, copying and pasting some text, opening a website${chrome ? ' or doing a few clicks in the user’s Chrome' : ''}.
You have your own tools for this: web search, reading web pages, reading and writing files in the workspace, running simple commands${chrome ? ', and the user’s Chrome browser' : ''}.

## Bigger jobs: ask first, then hire
Anything that creates real content or takes real effort is a bigger job — even if it sounds short. For example: writing a blog post, article, report,
letter, email campaign or document; research or comparisons; making a spreadsheet, design or website; building or fixing software; anything with many steps.
Never guess important details (names, audience, length, tone, where to save, what to include) — ask instead.
For bigger jobs:
1. FIRST ask the user 1–3 short questions to understand exactly what they want — goal, who it's for, how long or detailed, where to save it, style.
   Ask them one at a time with ask_user (2–4 simple answer options each). Skip a question if the user already told you the answer.
   Never ask more than 3 questions.
2. Call list_agents. If someone on the team already fits, use them.
3. Otherwise hire the right specialist:
   - ALWAYS call find_skills first with a few keywords about the job. It shows the skills (special know-how packs) already installed
     AND the best matching skills from the online skills catalog.
   - Choose the best skills for the job: the most fitting installed ones plus the best online one(s) — prefer 1,000+ installs and
     well-known makers. Every new agent must get at least one fitting online skill; it is downloaded and added for you when you hire.
   - call hire_agent with a clear name, a role, detailed instructions shaped by the user's answers, the abilities it needs,
     and those 1–6 skills (installed names as-is, online ones by their id like owner/repo@skill — only ones find_skills returned).
   - In your reply, mention in plain words which new skill you got for the agent (e.g. "I gave them a spreadsheet skill").
4. create_task with a complete brief: the goal, the user's answers, exact deliverables (file names in the workspace), and what "done" looks like.
5. start_task, then tell the user in one or two sentences who is working on it.
Several tasks can run at the same time — split big jobs into parallel tasks when that helps.
Tasks run in the background. When one finishes you get a message starting with "[agentCloud update]". Then tell the user what was done in plain words,
link the task as [Task title](task://TASK_ID) and every file as [file name](file://relative/path/inside/workspace).
Whenever the user must choose between options, use ask_user instead of listing options in text.
${MEDIA_GUIDE}
${chrome ? BROWSER_GUIDE : ''}
${opts.telegram ? `
## The user is on Telegram
This chat comes from the user's phone through Telegram. Keep replies extra short. Questions you ask with ask_user show up as buttons.
Files you link with file:// are sent to them automatically, so link every file you want them to get.` : ''}

## Environment
Workspace folder (all work happens here): ${s.workspace ?? 'not chosen yet'}
Connected apps: ${connections.length ? connections.join(', ') : 'none yet (the user can add them under Connect apps)'}
Permission mode: ${s.permissionMode === 'full' ? 'Full access — you and the agents act without asking.' : 'Ask before risky actions.'}
`.trim()
}

export function agentSystemPrompt(agent: Agent, mode: 'chat' | 'task'): string {
  const s = settingsRepo.getAll()
  return `
# You are ${agent.name} — ${agent.role}
You are a member of the user's agentCloud team, managed by ${s.managerName}.
${agent.instructions}

The user is not technical: anything you write to them must use short sentences and everyday words, with no tech jargon.
${MEDIA_GUIDE}${agent.tools.includes('browser') && s.chromeEnabled ? `
${BROWSER_GUIDE}` : ''}
Workspace folder (save every file you create here unless told otherwise): ${s.workspace ?? 'not set'}
Use the ask_user tool only if you are truly blocked on a decision only the user can make.
${mode === 'task'
    ? `\nYou are working on a task in the background. Do the whole job, then finish with a short report in exactly this shape:\n\n## Report\n**What I did:** one to three sentences\n**Files:** bullet list of files created or changed (paths relative to the workspace), or "none"\n**Needs your attention:** anything the user must check or decide, or "nothing"`
    : ''}
`.trim()
}

export class ChatSession {
  readonly conversationId: string
  private q: SDK.Query | null = null
  private input: InputQueue | null = null
  private ac: AbortController | null = null
  private pending = new Set<string>()
  private tools = new Map<string, ChatItem & { kind: 'tool' }>()
  private turnError: FriendlyError | null = null
  private lastUserText: { text: string; attachments?: string[] } | null = null
  private retryCount = 0
  private retryTimer: NodeJS.Timeout | null = null
  activity: string | null = null

  constructor(conversationId: string) {
    this.conversationId = conversationId
  }

  get busy() {
    return this.pending.size > 0 || !!this.retryTimer
  }

  private agent(): Agent {
    const conv = convRepo.get(this.conversationId)
    const a = conv ? agentsRepo.get(conv.agentId) : null
    return a ?? agentsRepo.manager()!
  }

  private setStatus(activity?: string | null) {
    if (activity !== undefined) this.activity = activity
    emit({ type: 'chat:status', conversationId: this.conversationId, busy: this.busy, activity: this.busy ? this.activity : null })
  }

  private async ensureStarted() {
    if (this.q) return
    const s = settingsRepo.getAll()
    if (!s.workspace || !fs.existsSync(s.workspace)) {
      throw Object.assign(new Error('workspace missing'), { friendly: { kind: 'workspace', title: "Your workspace folder can't be found.", reason: 'It may have been moved or deleted. Choose a new one to keep working.', action: 'choose_workspace' } satisfies FriendlyError })
    }
    const { query } = await loadSdk()
    const agent = this.agent()
    const conv = convRepo.get(this.conversationId)
    const isManager = agent.isManager
    const ctx = { conversationId: this.conversationId, from: agent.name }
    const appServer = isManager ? await managerServer(ctx) : await agentServer(ctx)
    const restrictMcp = !isManager && agent.mcp.length > 0
    this.input = new InputQueue()
    this.ac = new AbortController()
    const perm = permissionOptions()
    const options: SDK.Options = {
      abortController: this.ac,
      cwd: s.workspace,
      model: MODEL_IDS[agent.model] ?? 'sonnet',
      systemPrompt: { type: 'preset', preset: 'claude_code', append: isManager ? managerSystemPrompt(agent, { telegram: telegramChatFor(this.conversationId) !== null }) : agentSystemPrompt(agent, 'chat') },
      tools: isManager ? toolsFor(managerSkills().caps) : toolsFor(agent.tools),
      mcpServers: { ...(restrictMcp ? mcpConfigsFor(agent.mcp) : {}), [APP_SERVER]: appServer },
      strictMcpConfig: restrictMcp,
      settingSources: ['user', 'project', 'local'],
      skills: isManager ? managerSkills().skills : enabledSkillsFor(agent),
      plugins: localPluginConfigs(),
      includePartialMessages: true,
      env: sessionEnv(),
      pathToClaudeCodeExecutable: claudeExecutable(),
      stderr: (d) => log.warn(`[claude:${agent.name}]`, d.slice(0, 2000)),
      ...perm,
      ...browserOptions(isManager || agent.tools.includes('browser')),
      ...(conv?.sdkSessionId ? { resume: conv.sdkSessionId } : {})
    }
    if (perm.permissionMode !== 'bypassPermissions') {
      options.canUseTool = async (toolName, input, { signal }) => {
        if (SAFE_TOOLS.has(toolName) || toolName.startsWith(`mcp__${APP_SERVER}__`)) return { behavior: 'allow', updatedInput: input }
        const ok = await requestPermission({ conversationId: this.conversationId, toolName, input, from: agent.name, signal })
        return ok ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'The user said no to this action.' }
      }
    }
    this.q = query({ prompt: this.input, options })
    void this.consume(this.q)
  }

  private async consume(q: SDK.Query) {
    try {
      for await (const m of q) this.handle(m)
    } catch (e) {
      const fe = classifyError(e)
      if (fe.kind !== 'aborted') {
        log.error('chat session crashed', e)
        this.pushError(fe)
      }
    } finally {
      if (this.q === q) {
        this.q = null
        this.input = null
        this.ac = null
        this.pending.clear()
        for (const t of this.tools.values()) if (t.status === 'running') this.finishTool(t, 'Stopped', true)
        this.setStatus(null)
      }
    }
  }

  private handle(m: SDK.SDKMessage) {
    const agent = this.agent()
    switch (m.type) {
      case 'system':
        if (m.subtype === 'init') {
          convRepo.setSession(this.conversationId, m.session_id)
        } else if (m.subtype === 'api_retry') {
          emit({ type: 'chat:retry', conversationId: this.conversationId, seconds: Math.ceil(m.retry_delay_ms / 1000), attempt: m.attempt, maxAttempts: m.max_retries })
        }
        return
      case 'stream_event': {
        if (m.parent_tool_use_id) return
        const ev = m.event as { type: string; delta?: { type: string; text?: string } }
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
          emit({ type: 'chat:delta', conversationId: this.conversationId, text: ev.delta.text })
        }
        return
      }
      case 'assistant': {
        if (m.parent_tool_use_id) return
        if (m.error) this.turnError = friendlyFromCode(m.error)
        for (const block of m.message.content as { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[]) {
          if (block.type === 'text' && block.text?.trim()) {
            if (m.error) continue // the error card explains it better than the raw API text
            pushItem(this.conversationId, { kind: 'text', id: randomUUID(), role: 'assistant', text: block.text, createdAt: Date.now() })
          } else if (block.type === 'tool_use' && block.id && block.name) {
            const input = block.input ?? {}
            this.setStatus(activityFor(block.name, input, agent.name))
            if (HIDDEN_TOOLS.has(block.name)) continue
            const item: ChatItem & { kind: 'tool' } = { kind: 'tool', id: randomUUID(), toolUseId: block.id, name: block.name, input, status: 'running', createdAt: Date.now() }
            this.tools.set(block.id, item)
            pushItem(this.conversationId, item)
          }
        }
        return
      }
      case 'user': {
        if (m.parent_tool_use_id) return
        const content = m.message.content
        if (!Array.isArray(content)) return
        for (const b of content as { type: string; tool_use_id?: string; content?: unknown; is_error?: boolean }[]) {
          if (b.type !== 'tool_result' || !b.tool_use_id) continue
          const item = this.tools.get(b.tool_use_id)
          if (!item) continue
          if (!b.is_error) {
            const media = mediaFromToolResult(item.name, item.input, b.content)
            if (media.length) item.media = media
          }
          this.finishTool(item, toolResultText(b.content), !!b.is_error)
        }
        return
      }
      case 'result': {
        const done = m.user_message_uuids ?? (m.user_message_uuid ? [m.user_message_uuid] : [])
        if (done.length) for (const id of done) this.pending.delete(id)
        else this.pending.delete(this.pending.values().next().value as string)
        if (m.queued_turn_count === 0) this.pending.clear()
        const tokens = m.usage ? (m.usage.input_tokens ?? 0) + (m.usage.output_tokens ?? 0) + (m.usage.cache_creation_input_tokens ?? 0) + (m.usage.cache_read_input_tokens ?? 0) : 0
        usageRepo.add({ agentId: agent.id, conversationId: this.conversationId, costUsd: m.total_cost_usd ?? 0, tokens })
        const err = this.turnError ?? (m.is_error ? (m.subtype === 'success' ? classifyError(new Error(m.result)) : m.subtype === 'error_during_execution' ? classifyError(new Error(m.errors.join('\n') || 'Claude stopped unexpectedly')) : friendlyFromCode('unknown', m.errors.join('\n'))) : null)
        this.turnError = null
        if (err && err.kind !== 'aborted') {
          if (err.kind === 'rate_limit' && this.retryCount < RETRY_DELAYS.length && this.lastUserText) {
            this.scheduleRetry()
          } else {
            this.retryCount = 0
            this.pushError(err)
          }
        } else {
          this.retryCount = 0
        }
        this.setStatus(this.busy ? this.activity : null)
        return
      }
      default:
        return
    }
  }

  private finishTool(item: ChatItem & { kind: 'tool' }, result: string, isError: boolean) {
    item.result = result.length > MAX_RESULT_CHARS ? result.slice(0, MAX_RESULT_CHARS) + '\n…' : result
    item.isError = isError
    item.status = isError ? 'error' : 'done'
    this.tools.delete(item.toolUseId)
    pushItem(this.conversationId, item)
  }

  private pushError(error: FriendlyError) {
    pushItem(this.conversationId, { kind: 'error', id: randomUUID(), error, createdAt: Date.now() })
  }

  private scheduleRetry() {
    const seconds = RETRY_DELAYS[this.retryCount]
    this.retryCount++
    emit({ type: 'chat:retry', conversationId: this.conversationId, seconds, attempt: this.retryCount, maxAttempts: RETRY_DELAYS.length })
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (this.lastUserText) void this.sendRaw(this.lastUserText.text, false).catch((e) => this.pushError(classifyError(e)))
    }, seconds * 1000)
    this.setStatus('Claude is busy — waiting to retry…')
  }

  /** User typed a message. */
  async send(text: string, attachments?: string[], source?: 'telegram') {
    this.retryCount = 0
    const item: ChatItem = { kind: 'text', id: randomUUID(), role: 'user', text, attachments, createdAt: Date.now(), ...(source ? { source } : {}) }
    pushItem(this.conversationId, item)
    this.maybeTitle(text)
    let prompt = text
    if (attachments?.length) prompt += `\n\n(The user attached these files, saved in the workspace: ${attachments.join(', ')})`
    this.lastUserText = { text: prompt, attachments }
    await this.sendRaw(prompt, true)
  }

  async retryLast() {
    if (!this.lastUserText) {
      const last = [...msgRepo.list(this.conversationId)].reverse().find((i) => i.kind === 'text' && i.role === 'user')
      if (last && last.kind === 'text') this.lastUserText = { text: last.text }
    }
    if (!this.lastUserText) return
    this.retryCount = 0
    await this.sendRaw(this.lastUserText.text, true)
  }

  /** Send a message that the user doesn't see as a bubble (task reports, follow-ups). */
  async sendHidden(text: string, notice?: Omit<ChatItem & { kind: 'notice' }, 'id' | 'createdAt' | 'kind'>) {
    if (notice) pushItem(this.conversationId, { kind: 'notice', id: randomUUID(), createdAt: Date.now(), ...notice })
    await this.sendRaw(text, true)
  }

  private async sendRaw(text: string, thinkingLine: boolean) {
    try {
      await this.ensureStarted()
    } catch (e) {
      const fe = (e as { friendly?: FriendlyError }).friendly ?? classifyError(e)
      this.pushError(fe)
      return
    }
    const uuid = randomUUID()
    this.pending.add(uuid)
    this.setStatus(thinkingLine ? `${this.agent().name} is thinking…` : this.activity)
    this.input!.push({ type: 'user', uuid, message: { role: 'user', content: text }, parent_tool_use_id: null })
  }

  private maybeTitle(text: string) {
    const conv = convRepo.get(this.conversationId)
    if (!conv) return
    const agent = agentsRepo.get(conv.agentId)
    const isDefault = conv.title === 'New chat' || (agent && conv.title === agent.name && agent.isManager)
    if (isDefault && msgRepo.list(this.conversationId).filter((i) => i.kind === 'text' && i.role === 'user').length <= 1) {
      const t = text.replace(/\s+/g, ' ').trim()
      convRepo.rename(this.conversationId, t.length > 40 ? t.slice(0, 38) + '…' : t)
      emit({ type: 'conversations:changed' })
    }
  }

  async interrupt() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    if (!this.q) return this.setStatus(null)
    try {
      await Promise.race([this.q.interrupt(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))])
    } catch {
      this.abort()
    }
  }

  abort() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.ac?.abort()
    this.input?.close()
  }

  /** Restart on next message (e.g. after settings or agent changes). */
  reset() {
    if (!this.busy) this.abort()
  }
}

const HIDDEN_TOOLS = new Set([`mcp__${APP_SERVER}__ask_user`, `mcp__${APP_SERVER}__notify_user`, 'ToolSearch'])

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c: { type?: string; text?: string }) => (c.type === 'text' ? c.text ?? '' : c.type === 'image' ? '[image]' : ''))
      .join('\n')
  }
  return ''
}

// ---------------------------------------------------------------- registry

const sessions = new Map<string, ChatSession>()

export function sessionFor(conversationId: string): ChatSession {
  let s = sessions.get(conversationId)
  if (!s) {
    s = new ChatSession(conversationId)
    sessions.set(conversationId, s)
  }
  return s
}

export function busyMap(): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const [id, s] of sessions) if (s.busy) out[id] = s.activity
  return out
}

export function dropSession(conversationId: string) {
  sessions.get(conversationId)?.abort()
  sessions.delete(conversationId)
}

export function abortAllChats(): number {
  let n = 0
  for (const s of sessions.values()) {
    if (s.busy) n++
    s.abort()
  }
  return n
}

/** Settings changed: restart idle sessions so they pick up new options. */
export function resetIdleSessions() {
  for (const s of sessions.values()) s.reset()
}

/** The Manager conversation a task belongs to (falls back to the most recent Manager chat). */
export function managerConversationFor(conversationId: string | null): string | null {
  const conv = conversationId ? convRepo.get(conversationId) : null
  const manager = agentsRepo.manager()
  if (conv && manager && conv.agentId === manager.id) return conv.id
  return manager ? convRepo.latestForAgent(manager.id)?.id ?? null : null
}

/** Deliver a hidden message to the Manager conversation a task came from. */
export async function deliverToManager(conversationId: string | null, text: string, notice?: Parameters<ChatSession['sendHidden']>[1]) {
  const convId = managerConversationFor(conversationId)
  if (!convId) return
  await sessionFor(convId).sendHidden(text, notice)
}
