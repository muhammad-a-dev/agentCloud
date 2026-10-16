// Scheduled jobs: run a workflow, or give an agent a job, once or on repeat.
import { randomUUID } from 'crypto'
import type { Schedule } from '@shared/types'
import { describeRepeat, nextRun } from '@shared/schedule'
export { describeRepeat, nextRun }
import { getDb } from './db'
import { agentsRepo, tasksRepo } from './db/repos'
import { emit } from './events'
import { log } from './logging'
import { startTask } from './claude/agentRunner'
import { pushItem } from './claude/interactions'
import { managerConversationFor } from './claude/manager'
import { runWorkflow, workflowsRepo } from './workflows'

const parse = (s: string): Schedule | null => {
  try {
    return JSON.parse(s) as Schedule
  } catch {
    return null
  }
}

export const schedulesRepo = {
  list(): Schedule[] {
    const rows = getDb().prepare('SELECT data_json FROM schedules ORDER BY next_run_at IS NULL, next_run_at ASC').all() as { data_json: string }[]
    return rows.map((r) => parse(r.data_json)).filter(Boolean) as Schedule[]
  },
  get(id: string): Schedule | null {
    const r = getDb().prepare('SELECT data_json FROM schedules WHERE id = ?').get(id) as { data_json: string } | undefined
    return r ? parse(r.data_json) : null
  },
  put(s: Schedule): Schedule {
    getDb()
      .prepare('INSERT INTO schedules (id, data_json, next_run_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, next_run_at = excluded.next_run_at')
      .run(s.id, JSON.stringify(s), s.enabled ? s.nextRunAt : null)
    return s
  },
  delete(id: string) {
    getDb().prepare('DELETE FROM schedules WHERE id = ?').run(id)
  }
}

// ---------------------------------------------------------------- create / edit

export function saveSchedule(input: Partial<Schedule> & { title: string }): Schedule {
  const prev = input.id ? schedulesRepo.get(input.id) : null
  const t = Date.now()
  const s: Schedule = {
    id: prev?.id ?? randomUUID(),
    title: input.title.trim() || 'Scheduled job',
    kind: input.kind ?? prev?.kind ?? 'agent',
    workflowId: input.workflowId ?? prev?.workflowId ?? null,
    agentId: input.agentId ?? prev?.agentId ?? null,
    prompt: input.prompt ?? prev?.prompt ?? '',
    repeat: input.repeat ?? prev?.repeat ?? 'once',
    time: input.time ?? prev?.time ?? '09:00',
    date: input.date ?? prev?.date ?? null,
    weekday: input.weekday ?? prev?.weekday ?? 1,
    dayOfMonth: Math.max(1, Math.min(28, input.dayOfMonth ?? prev?.dayOfMonth ?? 1)),
    enabled: input.enabled ?? prev?.enabled ?? true,
    nextRunAt: null,
    lastRunAt: prev?.lastRunAt ?? null,
    lastStatus: prev?.lastStatus ?? null,
    lastError: prev?.lastError ?? null,
    createdAt: prev?.createdAt ?? t,
    updatedAt: t
  }
  if (s.kind === 'workflow') {
    if (!s.workflowId || !workflowsRepo.get(s.workflowId)) throw new Error('Pick a workflow to run.')
  } else {
    if (!s.agentId || !agentsRepo.get(s.agentId)) throw new Error('Pick who should do the job.')
    if (!s.prompt.trim()) throw new Error('Describe the job.')
  }
  if (s.repeat === 'once' && !s.date) throw new Error('Pick a date.')
  s.nextRunAt = nextRun(s)
  if (s.repeat === 'once' && s.enabled && !s.nextRunAt) throw new Error('That time has already passed. Pick a time in the future.')
  schedulesRepo.put(s)
  emit({ type: 'schedules:changed' })
  return s
}

export function setScheduleEnabled(id: string, enabled: boolean): Schedule | null {
  const s = schedulesRepo.get(id)
  if (!s) return null
  s.enabled = enabled
  s.nextRunAt = enabled ? nextRun(s) : s.nextRunAt
  if (enabled && !s.nextRunAt) s.enabled = false
  s.updatedAt = Date.now()
  schedulesRepo.put(s)
  emit({ type: 'schedules:changed' })
  return s
}

export function deleteSchedule(id: string) {
  schedulesRepo.delete(id)
  emit({ type: 'schedules:changed' })
}

// ---------------------------------------------------------------- running

async function fire(s: Schedule): Promise<{ ok: true } | { ok: false; error: string }> {
  let r: { ok: true } | { ok: false; error: string }
  const convId = managerConversationFor(null)
  if (s.kind === 'workflow') {
    r = s.workflowId ? await runWorkflow(s.workflowId, 'schedule') : { ok: false, error: 'No workflow chosen.' }
  } else {
    const agent = s.agentId ? agentsRepo.get(s.agentId) : null
    if (!agent) r = { ok: false, error: 'The agent for this job is no longer on the team.' }
    else {
      const task = tasksRepo.create({ title: s.title, description: s.prompt, agentId: agent.id, conversationId: convId })
      tasksRepo.addEvent(task.id, 'status', { status: 'todo', text: `Started by the schedule “${s.title}”` })
      emit({ type: 'task:update', task })
      r = await startTask(task.id)
    }
  }
  if (convId) {
    pushItem(convId, {
      kind: 'notice', id: randomUUID(), createdAt: Date.now(),
      level: r.ok ? 'info' : 'error',
      text: r.ok ? `Scheduled job started: ${s.title}` : `Scheduled job “${s.title}” couldn't start: ${r.error}`
    })
  }
  return r
}

export async function runScheduleNow(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = schedulesRepo.get(id)
  if (!s) return { ok: false, error: "That schedule doesn't exist anymore." }
  const r = await fire(s)
  s.lastRunAt = Date.now()
  s.lastStatus = r.ok ? 'started' : 'failed'
  s.lastError = r.ok ? null : r.error
  schedulesRepo.put(s)
  emit({ type: 'schedules:changed' })
  return r
}

async function tick() {
  const now = Date.now()
  for (const s of schedulesRepo.list()) {
    if (!s.enabled || !s.nextRunAt || s.nextRunAt > now) continue
    const r = await fire(s).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }))
    s.lastRunAt = now
    s.lastStatus = r.ok ? 'started' : 'failed'
    s.lastError = r.ok ? null : r.error
    s.nextRunAt = s.repeat === 'once' ? null : nextRun(s, now + 1000)
    if (!s.nextRunAt) s.enabled = false
    schedulesRepo.put(s)
    emit({ type: 'schedules:changed' })
  }
}

const MISSED_GRACE = 60 * 60 * 1000
let timer: NodeJS.Timeout | null = null

export function startScheduler() {
  // Jobs that came due while the app was closed: run if it was recent, otherwise skip to the next time.
  const now = Date.now()
  for (const s of schedulesRepo.list()) {
    if (!s.enabled || !s.nextRunAt || s.nextRunAt > now - MISSED_GRACE) continue
    s.lastStatus = 'missed'
    s.lastError = 'agentCloud was closed at the scheduled time.'
    s.nextRunAt = s.repeat === 'once' ? null : nextRun(s, now)
    if (!s.nextRunAt) s.enabled = false
    schedulesRepo.put(s)
  }
  if (timer) clearInterval(timer)
  timer = setInterval(() => void tick().catch((e) => log.error('scheduler tick failed', e)), 20000)
  setTimeout(() => void tick().catch((e) => log.error('scheduler tick failed', e)), 3000)
}

export function stopScheduler() {
  if (timer) clearInterval(timer)
  timer = null
}
