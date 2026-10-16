import { randomUUID } from 'crypto'
import { getDb } from './index'
import type {
  Agent, ChatItem, Conversation, SearchResult, Settings, Task, TaskEvent, UsageSummary
} from '@shared/types'

const now = () => Date.now()
const parse = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

// ---------------------------------------------------------------- settings

export const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  tourDone: false,
  workspace: null,
  managerName: 'Drake',
  managerRole: 'Team Manager',
  managerAvatar: 'drake',
  managerPersona: 'Warm, upbeat and to the point. Explains things in plain language without jargon.',
  userName: '',
  theme: 'dark',
  launchOnStartup: false,
  notifications: true,
  permissionMode: 'full',
  allowedCommands: [],
  blockedCommands: ['rm -rf /', 'format', 'shutdown', 'del /s /q C:\\'],
  disabledSkills: [],
  localPlugins: [],
  chromeEnabled: true,
  telegramEnabled: true
}

export const settingsRepo = {
  getAll(): Settings {
    const rows = getDb().prepare('SELECT key, value_json FROM settings').all() as { key: string; value_json: string }[]
    const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
    for (const r of rows) if (r.key in DEFAULT_SETTINGS) out[r.key] = parse(r.value_json, null)
    return out as unknown as Settings
  },
  set(patch: Partial<Settings>): Settings {
    const stmt = getDb().prepare(
      'INSERT INTO settings(key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json'
    )
    getDb().transaction(() => {
      for (const [k, v] of Object.entries(patch)) if (k in DEFAULT_SETTINGS) stmt.run(k, JSON.stringify(v))
    })()
    return this.getAll()
  },
  getRaw<T>(key: string, fallback: T): T {
    const row = getDb().prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as { value_json: string } | undefined
    return row ? parse(row.value_json, fallback) : fallback
  },
  setRaw(key: string, value: unknown) {
    getDb()
      .prepare('INSERT INTO settings(key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json')
      .run(key, JSON.stringify(value))
  },
  deleteRaw(key: string) {
    getDb().prepare('DELETE FROM settings WHERE key = ?').run(key)
  }
}

// ---------------------------------------------------------------- agents

interface AgentRow {
  id: string; name: string; role: string; avatar: string; color: string; instructions: string
  tools_json: string; model: string; mcp_json: string; skills_json: string; is_manager: number
  created_at: number; updated_at: number
}

const toAgent = (r: AgentRow): Agent => ({
  id: r.id,
  name: r.name,
  role: r.role,
  avatar: r.avatar,
  color: r.color,
  instructions: r.instructions,
  tools: parse(r.tools_json, []),
  model: (r.model as Agent['model']) || 'balanced',
  mcp: parse(r.mcp_json, []),
  skills: parse(r.skills_json, []),
  isManager: !!r.is_manager,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

export const agentsRepo = {
  list(): Agent[] {
    const rows = getDb().prepare('SELECT * FROM agents ORDER BY is_manager DESC, created_at ASC').all() as AgentRow[]
    const done = getDb()
      .prepare("SELECT agent_id, COUNT(*) as n FROM tasks WHERE status = 'done' GROUP BY agent_id")
      .all() as { agent_id: string; n: number }[]
    const doneMap = new Map(done.map((d) => [d.agent_id, d.n]))
    return rows.map((r) => ({ ...toAgent(r), tasksDone: doneMap.get(r.id) ?? 0 }))
  },
  get(id: string): Agent | null {
    const r = getDb().prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined
    return r ? toAgent(r) : null
  },
  findByName(name: string): Agent | null {
    const r = getDb().prepare('SELECT * FROM agents WHERE lower(name) = lower(?) AND is_manager = 0').get(name) as AgentRow | undefined
    return r ? toAgent(r) : null
  },
  manager(): Agent | null {
    const r = getDb().prepare('SELECT * FROM agents WHERE is_manager = 1 LIMIT 1').get() as AgentRow | undefined
    return r ? toAgent(r) : null
  },
  save(a: Partial<Agent> & { name: string }): Agent {
    const existing = a.id ? this.get(a.id) : null
    const t = now()
    const merged: Agent = {
      id: existing?.id ?? a.id ?? randomUUID(),
      name: a.name,
      role: a.role ?? existing?.role ?? '',
      avatar: a.avatar ?? existing?.avatar ?? '🤖',
      color: a.color ?? existing?.color ?? '#F7A51C',
      instructions: a.instructions ?? existing?.instructions ?? '',
      tools: a.tools ?? existing?.tools ?? ['read', 'write', 'commands', 'web_search', 'web_fetch', 'skills'],
      model: a.model ?? existing?.model ?? 'balanced',
      mcp: a.mcp ?? existing?.mcp ?? [],
      skills: a.skills ?? existing?.skills ?? [],
      isManager: a.isManager ?? existing?.isManager ?? false,
      createdAt: existing?.createdAt ?? t,
      updatedAt: t
    }
    getDb()
      .prepare(
        `INSERT INTO agents (id, name, role, avatar, color, instructions, tools_json, model, mcp_json, skills_json, is_manager, created_at, updated_at)
         VALUES (@id, @name, @role, @avatar, @color, @instructions, @tools_json, @model, @mcp_json, @skills_json, @is_manager, @created_at, @updated_at)
         ON CONFLICT(id) DO UPDATE SET name=@name, role=@role, avatar=@avatar, color=@color, instructions=@instructions,
           tools_json=@tools_json, model=@model, mcp_json=@mcp_json, skills_json=@skills_json, is_manager=@is_manager, updated_at=@updated_at`
      )
      .run({
        id: merged.id, name: merged.name, role: merged.role, avatar: merged.avatar, color: merged.color,
        instructions: merged.instructions, tools_json: JSON.stringify(merged.tools), model: merged.model,
        mcp_json: JSON.stringify(merged.mcp), skills_json: JSON.stringify(merged.skills),
        is_manager: merged.isManager ? 1 : 0, created_at: merged.createdAt, updated_at: merged.updatedAt
      })
    return merged
  },
  delete(id: string) {
    getDb().prepare('DELETE FROM agents WHERE id = ? AND is_manager = 0').run(id)
  }
}

// ---------------------------------------------------------------- conversations & messages

interface ConvRow { id: string; agent_id: string; title: string; sdk_session_id: string | null; created_at: number; updated_at: number }
const toConv = (r: ConvRow): Conversation => ({
  id: r.id, agentId: r.agent_id, title: r.title, sdkSessionId: r.sdk_session_id, createdAt: r.created_at, updatedAt: r.updated_at
})

function previewOf(item: ChatItem): string {
  switch (item.kind) {
    case 'text': return item.text.replace(/[#*_`>\[\]]/g, '').replace(/\s+/g, ' ').trim()
    case 'question': return item.question
    case 'notice': return item.text
    case 'permission': return 'Waiting for your permission'
    case 'error': return item.error.title
    default: return ''
  }
}

export const convRepo = {
  list(): Conversation[] {
    const rows = getDb().prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all() as ConvRow[]
    const last = getDb().prepare(
      "SELECT content_json FROM messages WHERE conversation_id = ? AND role IN ('text','question','notice') ORDER BY created_at DESC LIMIT 1"
    )
    return rows.map((r) => {
      const m = last.get(r.id) as { content_json: string } | undefined
      return { ...toConv(r), preview: m ? previewOf(parse<ChatItem>(m.content_json, null as unknown as ChatItem)) : '' }
    })
  },
  get(id: string): Conversation | null {
    const r = getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConvRow | undefined
    return r ? toConv(r) : null
  },
  latestForAgent(agentId: string): Conversation | null {
    const r = getDb().prepare('SELECT * FROM conversations WHERE agent_id = ? ORDER BY updated_at DESC LIMIT 1').get(agentId) as ConvRow | undefined
    return r ? toConv(r) : null
  },
  create(agentId: string, title: string): Conversation {
    const t = now()
    const c: Conversation = { id: randomUUID(), agentId, title, sdkSessionId: null, createdAt: t, updatedAt: t }
    getDb().prepare('INSERT INTO conversations VALUES (?, ?, ?, ?, ?, ?)').run(c.id, c.agentId, c.title, null, t, t)
    return c
  },
  rename(id: string, title: string) {
    getDb().prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, id)
  },
  setSession(id: string, sessionId: string | null) {
    getDb().prepare('UPDATE conversations SET sdk_session_id = ? WHERE id = ?').run(sessionId, id)
  },
  touch(id: string) {
    getDb().prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now(), id)
  },
  delete(id: string) {
    getDb().transaction(() => {
      getDb().prepare('DELETE FROM messages WHERE conversation_id = ?').run(id)
      getDb().prepare('DELETE FROM conversations WHERE id = ?').run(id)
    })()
  },
  deleteForAgent(agentId: string) {
    const ids = getDb().prepare('SELECT id FROM conversations WHERE agent_id = ?').all(agentId) as { id: string }[]
    for (const { id } of ids) this.delete(id)
  }
}

export const msgRepo = {
  list(conversationId: string): ChatItem[] {
    const rows = getDb()
      .prepare('SELECT content_json FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC')
      .all(conversationId) as { content_json: string }[]
    return rows.map((r) => parse<ChatItem | null>(r.content_json, null)).filter(Boolean) as ChatItem[]
  },
  upsert(conversationId: string, item: ChatItem) {
    getDb()
      .prepare(
        `INSERT INTO messages (id, conversation_id, role, content_json, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET content_json = excluded.content_json`
      )
      .run(item.id, conversationId, item.kind, JSON.stringify(item), item.createdAt)
  },
  get(id: string): { conversationId: string; item: ChatItem } | null {
    const r = getDb().prepare('SELECT conversation_id, content_json FROM messages WHERE id = ?').get(id) as
      | { conversation_id: string; content_json: string }
      | undefined
    return r ? { conversationId: r.conversation_id, item: parse<ChatItem>(r.content_json, null as unknown as ChatItem) } : null
  },
  /** Questions/permissions left unanswered when the app closed can never be answered — mark them. */
  expirePending() {
    const rows = getDb().prepare("SELECT id, content_json FROM messages WHERE role IN ('question','permission')").all() as {
      id: string; content_json: string
    }[]
    for (const r of rows) {
      const it = parse<ChatItem>(r.content_json, null as unknown as ChatItem)
      if (it?.kind === 'question' && it.answer === undefined && !it.dismissed) {
        it.dismissed = true
        getDb().prepare('UPDATE messages SET content_json = ? WHERE id = ?').run(JSON.stringify(it), r.id)
      } else if (it?.kind === 'permission' && !it.decision) {
        it.decision = 'deny'
        getDb().prepare('UPDATE messages SET content_json = ? WHERE id = ?').run(JSON.stringify(it), r.id)
      }
    }
  }
}

// ---------------------------------------------------------------- tasks

interface TaskRow {
  id: string; title: string; description: string; agent_id: string | null; status: string; priority: string
  sdk_session_id: string | null; report: string | null; error: string | null; cost_usd: number; tokens: number
  created_at: number; started_at: number | null; finished_at: number | null; conversation_id: string | null
  last_activity: string | null; files_json: string
}

const toTask = (r: TaskRow): Task => ({
  id: r.id, title: r.title, description: r.description, agentId: r.agent_id, conversationId: r.conversation_id,
  status: r.status as Task['status'], priority: r.priority as Task['priority'], sdkSessionId: r.sdk_session_id,
  report: r.report, error: r.error, costUsd: r.cost_usd, tokens: r.tokens, lastActivity: r.last_activity,
  filesChanged: parse(r.files_json, []), createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at
})

const TASK_COLS: Record<string, string> = {
  title: 'title', description: 'description', agentId: 'agent_id', conversationId: 'conversation_id', status: 'status',
  priority: 'priority', sdkSessionId: 'sdk_session_id', report: 'report', error: 'error', costUsd: 'cost_usd',
  tokens: 'tokens', lastActivity: 'last_activity', startedAt: 'started_at', finishedAt: 'finished_at', filesChanged: 'files_json'
}

export const tasksRepo = {
  list(): Task[] {
    return (getDb().prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() as TaskRow[]).map(toTask)
  },
  get(id: string): Task | null {
    const r = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined
    return r ? toTask(r) : null
  },
  create(input: { title: string; description: string; agentId: string | null; conversationId: string | null; priority?: Task['priority'] }): Task {
    const id = randomUUID()
    getDb()
      .prepare('INSERT INTO tasks (id, title, description, agent_id, conversation_id, status, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.title, input.description, input.agentId, input.conversationId, 'todo', input.priority ?? 'normal', now())
    return this.get(id)!
  },
  update(id: string, patch: Partial<Task>): Task | null {
    const sets: string[] = []
    const vals: unknown[] = []
    for (const [k, v] of Object.entries(patch)) {
      const col = TASK_COLS[k]
      if (!col) continue
      sets.push(`${col} = ?`)
      vals.push(k === 'filesChanged' ? JSON.stringify(v) : v)
    }
    if (sets.length) getDb().prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
    return this.get(id)
  },
  delete(id: string) {
    getDb().prepare('DELETE FROM task_events WHERE task_id = ?').run(id)
    getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id)
  },
  markInterrupted(): number {
    return getDb()
      .prepare("UPDATE tasks SET status = 'interrupted', last_activity = 'The app closed while this was running' WHERE status IN ('in_progress','needs_input')")
      .run().changes
  },
  addEvent(taskId: string, type: TaskEvent['type'], payload: Record<string, unknown>): TaskEvent {
    const e: TaskEvent = { id: randomUUID(), taskId, type, payload, createdAt: now() }
    getDb().prepare('INSERT INTO task_events VALUES (?, ?, ?, ?, ?)').run(e.id, taskId, type, JSON.stringify(payload), e.createdAt)
    return e
  },
  events(taskId: string): TaskEvent[] {
    const rows = getDb().prepare('SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at ASC, rowid ASC').all(taskId) as {
      id: string; task_id: string; type: string; payload_json: string; created_at: number
    }[]
    return rows.map((r) => ({ id: r.id, taskId: r.task_id, type: r.type as TaskEvent['type'], payload: parse(r.payload_json, {}), createdAt: r.created_at }))
  }
}

// ---------------------------------------------------------------- usage

export const usageRepo = {
  add(u: { agentId?: string | null; taskId?: string | null; conversationId?: string | null; costUsd: number; tokens: number }) {
    const d = new Date()
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    getDb()
      .prepare('INSERT INTO usage VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), day, u.agentId ?? null, u.taskId ?? null, u.conversationId ?? null, u.costUsd, u.tokens, now())
  },
  summary(): UsageSummary {
    const db = getDb()
    const tot = db.prepare('SELECT COALESCE(SUM(cost_usd),0) c, COALESCE(SUM(tokens),0) t FROM usage').get() as { c: number; t: number }
    const byDay = db.prepare('SELECT day, SUM(cost_usd) cost, SUM(tokens) tokens FROM usage GROUP BY day ORDER BY day DESC LIMIT 14').all() as UsageSummary['byDay']
    const byAgent = db
      .prepare(`SELECT u.agent_id agentId, COALESCE(a.name, 'Unknown') name, SUM(u.cost_usd) cost, SUM(u.tokens) tokens FROM usage u LEFT JOIN agents a ON a.id = u.agent_id GROUP BY u.agent_id ORDER BY cost DESC`)
      .all() as UsageSummary['byAgent']
    const byTask = db
      .prepare('SELECT u.task_id taskId, t.title title, SUM(u.cost_usd) cost, SUM(u.tokens) tokens FROM usage u JOIN tasks t ON t.id = u.task_id GROUP BY u.task_id ORDER BY cost DESC LIMIT 20')
      .all() as UsageSummary['byTask']
    return { totalCost: tot.c, totalTokens: tot.t, byDay: byDay.reverse(), byAgent, byTask }
  }
}

// ---------------------------------------------------------------- search

export function searchAll(q: string): SearchResult[] {
  const like = `%${q.replace(/[%_]/g, '')}%`
  const db = getDb()
  const out: SearchResult[] = []
  const agents = db.prepare('SELECT id, name, role FROM agents WHERE name LIKE ? OR role LIKE ? LIMIT 5').all(like, like) as { id: string; name: string; role: string }[]
  for (const a of agents) out.push({ type: 'agent', id: a.id, title: a.name, subtitle: a.role })
  const tasks = db.prepare('SELECT id, title, status FROM tasks WHERE title LIKE ? OR description LIKE ? LIMIT 8').all(like, like) as { id: string; title: string; status: string }[]
  for (const t of tasks) out.push({ type: 'task', id: t.id, title: t.title, subtitle: `Task · ${t.status.replace('_', ' ')}` })
  const convs = db.prepare('SELECT id, title FROM conversations WHERE title LIKE ? LIMIT 5').all(like) as { id: string; title: string }[]
  for (const c of convs) out.push({ type: 'conversation', id: c.id, title: c.title, subtitle: 'Chat' })
  const msgs = db
    .prepare("SELECT m.id, m.conversation_id, m.content_json, c.title FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.role = 'text' AND m.content_json LIKE ? ORDER BY m.created_at DESC LIMIT 10")
    .all(like) as { id: string; conversation_id: string; content_json: string; title: string }[]
  for (const m of msgs) {
    const it = parse<ChatItem>(m.content_json, null as unknown as ChatItem)
    if (it?.kind !== 'text') continue
    const idx = it.text.toLowerCase().indexOf(q.toLowerCase())
    if (idx < 0) continue
    const snippet = it.text.slice(Math.max(0, idx - 30), idx + 70).replace(/\s+/g, ' ')
    out.push({ type: 'message', id: m.id, title: snippet, subtitle: `In “${m.title}”`, conversationId: m.conversation_id })
  }
  return out
}
