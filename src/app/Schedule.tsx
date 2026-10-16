import { AnimatePresence, motion } from 'framer-motion'
import { CalendarClock, CalendarDays, Clock, Pencil, Play, Plus, Repeat, Trash2, Workflow as WorkflowIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Schedule, ScheduleRepeat } from '@shared/types'
import { describeRepeat, nextRun } from '@shared/schedule'
import { AgentAvatar } from '@/components/Avatars'
import { Button, Confirm, EmptyState, Field, Modal, Pill, Toggle, inputCls } from '@/components/ui'
import { cx } from '@/lib/format'
import { api } from '@/lib/ipc'
import { useApp } from '@/stores/app'

const REPEATS: { key: ScheduleRepeat; label: string }[] = [
  { key: 'once', label: 'Once' },
  { key: 'hourly', label: 'Every hour' },
  { key: 'daily', label: 'Every day' },
  { key: 'weekdays', label: 'Weekdays' },
  { key: 'weekly', label: 'Every week' },
  { key: 'monthly', label: 'Every month' }
]
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const pad = (n: number) => String(n).padStart(2, '0')
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** "in 5 minutes", "in 3 hours", "tomorrow at 9:00 AM" … */
export function whenInWords(ts: number | null): string {
  if (!ts) return 'Not planned'
  const diff = ts - Date.now()
  const d = new Date(ts)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (diff < 60_000) return 'in less than a minute'
  if (diff < 3_600_000) return `in ${Math.round(diff / 60_000)} min`
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000)
  if (days === 0) return `today at ${time}`
  if (days === 1) return `tomorrow at ${time}`
  if (days < 7) return `${DAYS[d.getDay()]} at ${time}`
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${time}`
}

/** Every run of a schedule between two times (hourly ones collapse to one entry per day). */
function occurrences(s: Schedule, from: number, to: number): number[] {
  if (!s.enabled || !s.nextRunAt) return []
  const out: number[] = []
  let t: number | null = s.nextRunAt
  while (t && t < to && out.length < 200) {
    if (t >= from) out.push(t)
    if (s.repeat === 'once') break
    t = nextRun(s, t + 1000)
  }
  if (s.repeat === 'hourly') {
    const seen = new Set<string>()
    return out.filter((x) => {
      const k = new Date(x).toDateString()
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }
  return out
}

export function SchedulePage() {
  const { schedules, workflows, agents, toast, openWorkflow } = useApp()
  const [editing, setEditing] = useState<Schedule | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Schedule | null>(null)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => tick((x) => x + 1), 30_000)
    return () => window.clearInterval(t)
  }, [])

  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])
  const wfById = useMemo(() => new Map(workflows.map((w) => [w.id, w])), [workflows])

  const week = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return Array.from({ length: 7 }, (_, i) => {
      const from = new Date(start)
      from.setDate(start.getDate() + i)
      const to = new Date(from)
      to.setDate(from.getDate() + 1)
      const items = schedules
        .flatMap((s) => occurrences(s, Math.max(from.getTime(), Date.now()), to.getTime()).map((at) => ({ s, at })))
        .sort((a, b) => a.at - b.at)
      return { date: from, items }
    })
  }, [schedules])

  const upcoming = schedules.filter((s) => s.enabled && s.nextRunAt).sort((a, b) => a.nextRunAt! - b.nextRunAt!)
  const paused = schedules.filter((s) => !(s.enabled && s.nextRunAt))

  const renderRow = (s: Schedule, i: number) => {
    const wf = s.workflowId ? wfById.get(s.workflowId) : undefined
    const agent = s.agentId ? agentsById.get(s.agentId) : undefined
    const active = s.enabled && !!s.nextRunAt
    return (
      <motion.div
        key={s.id}
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ delay: i * 0.025 }}
        className={cx('flex items-center gap-3 rounded-2xl border bg-card px-4 py-3', active ? 'border-line' : 'border-line opacity-70')}
      >
        <div className="shrink-0">
          {s.kind === 'workflow'
            ? <span className="w-10 h-10 rounded-xl bg-accent-soft text-accent flex items-center justify-center"><WorkflowIcon size={18} /></span>
            : agent ? <AgentAvatar avatar={agent.avatar} color={agent.color} size={40} /> : <span className="w-10 h-10 rounded-xl bg-card-hover" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[15px] truncate">{s.title}</span>
            <Pill tone={s.kind === 'workflow' ? 'accent' : 'neutral'}>{s.kind === 'workflow' ? 'Workflow' : agent?.name ?? 'Agent job'}</Pill>
          </div>
          <div className="text-[13px] text-fg-2 flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="flex items-center gap-1"><Repeat size={12} /> {describeRepeat(s)}</span>
            {s.kind === 'workflow' && wf && (
              <button className="hover:text-accent underline-offset-2 hover:underline" onClick={() => openWorkflow(wf.id)}>Open “{wf.name}”</button>
            )}
            {s.lastStatus && (
              <span className={cx(s.lastStatus === 'started' ? 'text-success' : 'text-danger')} title={s.lastError ?? undefined}>
                Last run: {s.lastStatus === 'started' ? 'started' : s.lastStatus === 'missed' ? 'missed (app was closed)' : 'failed'}
              </span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0 w-[150px]">
          <div className={cx('text-[13.5px] font-medium', active ? 'text-fg' : 'text-muted')}>{active ? whenInWords(s.nextRunAt) : s.repeat === 'once' && s.lastRunAt ? 'Done' : 'Paused'}</div>
          {active && <div className="text-[11.5px] text-muted">{new Date(s.nextRunAt!).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>}
        </div>
        <Toggle checked={s.enabled && !!s.nextRunAt} onChange={async (v) => {
          const r = await api.schedulesToggle(s.id, v)
          if (v && r && !r.enabled) toast('warning', 'That time has passed. Edit the schedule to pick a new one.')
        }} label={`Turn ${s.title} on or off`} />
        <div className="flex items-center gap-0.5 shrink-0">
          <Button size="sm" variant="ghost" title="Run now" onClick={async () => {
            const r = await api.schedulesRunNow(s.id)
            toast(r.ok ? 'success' : 'error', r.ok ? `Started “${s.title}”.` : r.error)
          }}><Play size={13} /></Button>
          <Button size="sm" variant="ghost" title="Edit" onClick={() => setEditing(s)}><Pencil size={13} /></Button>
          <Button size="sm" variant="ghost" title="Delete" onClick={() => setDeleting(s)}><Trash2 size={13} /></Button>
        </div>
      </motion.div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-10">
      <div className="max-w-[1100px] mx-auto">
        <div className="flex items-end justify-between gap-4 mt-2 mb-5">
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight">What’s scheduled</h1>
            <p className="text-fg-2 mt-1">Jobs and workflows that run by themselves. You can also ask your Manager: “every Monday at 9, send me a sales summary”.</p>
          </div>
          <Button variant="accent" onClick={() => setCreating(true)}><Plus size={15} /> New schedule</Button>
        </div>

        {/* next 7 days */}
        <div className="grid grid-cols-7 gap-2 mb-8">
          {week.map(({ date, items }, i) => {
            const isToday = i === 0
            return (
              <motion.div
                key={date.toDateString()}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className={cx('rounded-2xl border p-2.5 min-h-[150px] flex flex-col', isToday ? 'border-accent/60 bg-accent-soft/40' : 'border-line bg-card')}
              >
                <div className="flex items-baseline justify-between mb-2">
                  <span className={cx('text-[12px] font-semibold uppercase tracking-wide', isToday ? 'text-accent' : 'text-muted')}>{isToday ? 'Today' : date.toLocaleDateString([], { weekday: 'short' })}</span>
                  <span className="text-[18px] font-semibold">{date.getDate()}</span>
                </div>
                <div className="space-y-1 flex-1">
                  {items.length === 0 && <div className="text-[11.5px] text-muted mt-2">Nothing</div>}
                  {items.slice(0, 4).map(({ s, at }) => (
                    <button
                      key={`${s.id}-${at}`}
                      onClick={() => setEditing(s)}
                      title={`${s.title} — ${describeRepeat(s)}`}
                      className="w-full text-left rounded-lg bg-card-2 hover:bg-card-hover border border-line px-1.5 py-1"
                    >
                      <div className="text-[11px] text-accent font-medium">{s.repeat === 'hourly' ? 'Hourly' : new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
                      <div className="text-[12px] leading-tight truncate">{s.title}</div>
                    </button>
                  ))}
                  {items.length > 4 && <div className="text-[11px] text-muted">+{items.length - 4} more</div>}
                </div>
              </motion.div>
            )
          })}
        </div>

        {schedules.length === 0 ? (
          <EmptyState icon={<CalendarClock size={22} />} title="Nothing scheduled yet" body="Schedule a workflow or give an agent a job to do every day, every week, or just once later.">
            <Button variant="accent" onClick={() => setCreating(true)}><Plus size={14} /> Schedule something</Button>
          </EmptyState>
        ) : (
          <>
            {upcoming.length > 0 && (
              <>
                <div className="text-[12px] uppercase tracking-wide text-muted font-medium mb-2 flex items-center gap-1.5"><Clock size={12} /> Coming up</div>
                <div className="space-y-2 mb-8">
                  <AnimatePresence initial={false}>{upcoming.map(renderRow)}</AnimatePresence>
                </div>
              </>
            )}
            {paused.length > 0 && (
              <>
                <div className="text-[12px] uppercase tracking-wide text-muted font-medium mb-2 flex items-center gap-1.5"><CalendarDays size={12} /> Paused or finished</div>
                <div className="space-y-2">
                  <AnimatePresence initial={false}>{paused.map(renderRow)}</AnimatePresence>
                </div>
              </>
            )}
          </>
        )}
      </div>
      <ScheduleModal open={creating || !!editing} editing={editing} onClose={() => { setCreating(false); setEditing(null) }} />
      <Confirm
        open={!!deleting}
        title="Delete this schedule?"
        message={`“${deleting?.title}” won’t run anymore.`}
        confirmLabel="Delete"
        danger
        onConfirm={async () => { if (deleting) await api.schedulesDelete(deleting.id) }}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}

type Draft = Omit<Schedule, 'id' | 'nextRunAt' | 'lastRunAt' | 'lastStatus' | 'lastError' | 'createdAt' | 'updatedAt'> & { id?: string }

export function ScheduleModal({ open, onClose, editing, preset }: {
  open: boolean
  onClose: () => void
  editing?: Schedule | null
  preset?: Partial<Draft>
}) {
  const { workflows, agents, toast } = useApp()
  const team = agents.filter((a) => !a.isManager)
  const blank = (): Draft => ({
    title: '', kind: workflows.length ? 'workflow' : 'agent', workflowId: workflows[0]?.id ?? null, agentId: team[0]?.id ?? null, prompt: '',
    repeat: 'daily', time: '09:00', date: today(), weekday: new Date().getDay(), dayOfMonth: Math.min(new Date().getDate(), 28), enabled: true, ...preset
  })
  const [d, setD] = useState<Draft>(blank)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (open) setD(editing ? { ...editing, date: editing.date ?? today() } : blank())
  }, [open, editing]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const next = nextRun(d)
  const autoTitle = d.kind === 'workflow' ? workflows.find((w) => w.id === d.workflowId)?.name ?? 'Workflow' : d.prompt.trim().split('\n')[0].slice(0, 50) || 'Agent job'

  const save = async () => {
    setSaving(true)
    try {
      const r = await api.schedulesSave({ ...d, title: d.title.trim() || autoTitle })
      if (!r.ok) return toast('error', r.error)
      toast('success', `Scheduled: ${describeRepeat(r.data)}.`)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const chip = (on: boolean) => cx('h-9 px-3.5 rounded-full text-[13px] border transition', on ? 'bg-accent text-accent-text border-accent font-medium' : 'border-line hover:bg-card-hover text-fg-2')

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit schedule' : 'Schedule something'} width={600} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="accent" disabled={saving} onClick={save}><CalendarClock size={14} /> {editing ? 'Save' : 'Schedule it'}</Button>
      </>
    }>
      <Field label="What should happen?">
        <div className="flex gap-2">
          <button className={chip(d.kind === 'workflow')} onClick={() => set('kind', 'workflow')}>Run a workflow</button>
          <button className={chip(d.kind === 'agent')} onClick={() => set('kind', 'agent')}>Give an agent a job</button>
        </div>
      </Field>
      {d.kind === 'workflow' ? (
        <Field label="Which workflow?">
          {workflows.length ? (
            <select className={inputCls} value={d.workflowId ?? ''} onChange={(e) => set('workflowId', e.target.value)}>
              {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          ) : <div className="text-[13px] text-fg-2">You don’t have any workflows yet. Design one on the Workflows page first.</div>}
        </Field>
      ) : (
        <>
          <Field label="Who does it?">
            {team.length ? (
              <select className={inputCls} value={d.agentId ?? ''} onChange={(e) => set('agentId', e.target.value)}>
                {team.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.role}</option>)}
              </select>
            ) : <div className="text-[13px] text-fg-2">Your team is empty. Hire an agent first, or ask your Manager to schedule it for you.</div>}
          </Field>
          <Field label="What’s the job?" hint="Say what to do and what to deliver, e.g. “Check our website for broken links and save a list to links-report.md”.">
            <textarea className={cx(inputCls, 'min-h-[90px] resize-y')} value={d.prompt} onChange={(e) => set('prompt', e.target.value)} />
          </Field>
        </>
      )}
      <Field label="When?">
        <div className="flex flex-wrap gap-1.5 mb-3">
          {REPEATS.map((r) => <button key={r.key} className={chip(d.repeat === r.key)} onClick={() => set('repeat', r.key)}>{r.label}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {d.repeat === 'once' && <input type="date" className={cx(inputCls, 'w-[170px]')} value={d.date ?? ''} min={today()} onChange={(e) => set('date', e.target.value)} />}
          {d.repeat === 'weekly' && (
            <select className={cx(inputCls, 'w-[170px]')} value={d.weekday} onChange={(e) => set('weekday', Number(e.target.value))}>
              {DAYS.map((name, i) => <option key={name} value={i}>On {name}</option>)}
            </select>
          )}
          {d.repeat === 'monthly' && (
            <select className={cx(inputCls, 'w-[170px]')} value={d.dayOfMonth} onChange={(e) => set('dayOfMonth', Number(e.target.value))}>
              {Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>On day {i + 1}</option>)}
            </select>
          )}
          {d.repeat === 'hourly' ? (
            <select className={cx(inputCls, 'w-[170px]')} value={d.time.split(':')[1]} onChange={(e) => set('time', `00:${e.target.value}`)}>
              {['00', '15', '30', '45'].map((m) => <option key={m} value={m}>At :{m} past</option>)}
            </select>
          ) : (
            <input type="time" className={cx(inputCls, 'w-[140px]')} value={d.time} onChange={(e) => set('time', e.target.value)} />
          )}
        </div>
      </Field>
      <Field label="Name (optional)">
        <input className={inputCls} value={d.title} onChange={(e) => set('title', e.target.value)} placeholder={autoTitle} />
      </Field>
      <motion.div key={`${next}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className={cx('rounded-xl px-3 py-2.5 text-[13.5px] flex items-center gap-2', next ? 'bg-accent-soft text-fg' : 'bg-danger-soft text-danger')}>
        <CalendarClock size={15} className={next ? 'text-accent' : ''} />
        {next ? <>{describeRepeat(d)} · next run <b>{whenInWords(next)}</b></> : 'That time has already passed — pick a later one.'}
      </motion.div>
    </Modal>
  )
}
