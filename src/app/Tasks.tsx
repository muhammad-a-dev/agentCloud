import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { ClipboardList, LayoutGrid, List, Plus, Search, Play, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Task, TaskStatus } from '@shared/types'
import { AgentAvatar } from '@/components/Avatars'
import { Button, EmptyState, Field, Modal, Pill, inputCls } from '@/components/ui'
import { cx, elapsed, relative } from '@/lib/format'
import { api } from '@/lib/ipc'
import { useApp } from '@/stores/app'

export const STATUS_META: Record<TaskStatus, { label: string; tone: 'neutral' | 'accent' | 'success' | 'danger' | 'warning' }> = {
  todo: { label: 'To do', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'accent' },
  needs_input: { label: 'Needs your input', tone: 'warning' },
  done: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  interrupted: { label: 'Interrupted', tone: 'warning' }
}

const COLUMNS: { key: string; title: string; statuses: TaskStatus[] }[] = [
  { key: 'todo', title: 'To do', statuses: ['todo'] },
  { key: 'in_progress', title: 'In progress', statuses: ['in_progress'] },
  { key: 'needs_input', title: 'Needs your input', statuses: ['needs_input'] },
  { key: 'done', title: 'Done', statuses: ['done'] },
  { key: 'failed', title: 'Failed', statuses: ['failed', 'cancelled', 'interrupted'] }
]

function useTick(active: boolean) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => set((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [active])
}

export function TaskCard({ task, draggable }: { task: Task; draggable?: boolean }) {
  const agents = useApp((s) => s.agents)
  const openTask = useApp((s) => s.openTask)
  const agent = agents.find((a) => a.id === task.agentId)
  const live = task.status === 'in_progress' || task.status === 'needs_input'
  useTick(live)
  const meta = STATUS_META[task.status]
  return (
    <motion.div
      layout
      layoutId={task.id}
      data-task-id={task.id}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      whileHover={{ y: -2 }}
      draggable={draggable}
      onDragStartCapture={(e: React.DragEvent) => e.dataTransfer.setData('text/task', task.id)}
      onClick={() => openTask(task.id)}
      className="cursor-pointer rounded-xl bg-card border border-line hover:border-line-strong p-3 select-none"
    >
      <div className="flex items-start gap-2.5">
        {agent ? <AgentAvatar avatar={agent.avatar} color={agent.color} size={26} /> : <div className="w-[26px] h-[26px] rounded-lg bg-card-hover" />}
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[14px] leading-snug line-clamp-2">{task.title}</div>
          <div className="text-[12px] text-muted truncate">{agent?.name ?? 'Unassigned'}</div>
        </div>
      </div>
      {task.lastActivity && (
        <div className={cx('text-[12.5px] mt-2 line-clamp-2', task.status === 'failed' ? 'text-danger' : 'text-fg-2')}>
          {live && <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent dot-pulse mr-1.5 align-middle" />}
          {task.lastActivity}
        </div>
      )}
      <div className="flex items-center justify-between mt-2.5">
        <Pill tone={meta.tone}>{meta.label}</Pill>
        <span className="text-[11.5px] text-muted">
          {task.startedAt ? elapsed(task.startedAt, live ? null : task.finishedAt) : relative(task.createdAt)}
        </span>
      </div>
    </motion.div>
  )
}

export function TasksPage() {
  const { tasks, agents, toast } = useApp()
  const [view, setView] = useState<'board' | 'list'>(() => {
    try {
      return (localStorage.getItem('agentcloud:taskView') as 'board' | 'list') || 'board'
    } catch {
      return 'board'
    }
  })
  const [q, setQ] = useState('')
  const [agentFilter, setAgentFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('all')
  const [creating, setCreating] = useState(false)
  const [dropCol, setDropCol] = useState<string | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem('agentcloud:taskView', view)
    } catch {
      /* ignore */
    }
  }, [view])

  const filtered = useMemo(() => {
    const since = dateFilter === 'today' ? new Date().setHours(0, 0, 0, 0) : dateFilter === 'week' ? Date.now() - 7 * 864e5 : dateFilter === 'month' ? Date.now() - 30 * 864e5 : 0
    return tasks.filter((t) =>
      (agentFilter === 'all' || t.agentId === agentFilter) &&
      (statusFilter === 'all' || t.status === statusFilter) &&
      t.createdAt >= since &&
      (!q.trim() || `${t.title} ${t.description}`.toLowerCase().includes(q.toLowerCase()))
    )
  }, [tasks, q, agentFilter, statusFilter, dateFilter])

  const onDrop = async (col: string, id: string) => {
    setDropCol(null)
    const t = tasks.find((x) => x.id === id)
    if (!t) return
    if (col === 'in_progress' && (t.status === 'todo' || t.status === 'interrupted' || t.status === 'cancelled' || t.status === 'failed')) {
      const r = await (t.status === 'interrupted' ? api.tasksResume(id) : api.tasksStart(id))
      if (!r.ok) toast('error', r.error)
    } else if (col === 'todo' && t.status !== 'todo') {
      await api.tasksMoveToTodo(id)
    }
  }

  const selectCls = 'h-9 bg-input border border-line rounded-full px-3 text-[13px] outline-none text-fg'

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-6 pb-4 flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" className="h-9 w-[220px] bg-input border border-line rounded-full pl-8 pr-3 text-[13px] outline-none focus:border-accent/60" />
        </div>
        <select aria-label="Filter by agent" value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} className={selectCls}>
          <option value="all">All agents</option>
          {agents.filter((a) => !a.isManager).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectCls}>
          <option value="all">Any status</option>
          {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select aria-label="Filter by date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className={selectCls}>
          <option value="all">Any time</option>
          <option value="today">Today</option>
          <option value="week">Last 7 days</option>
          <option value="month">Last 30 days</option>
        </select>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex bg-card border border-line rounded-full p-0.5">
            {(['board', 'list'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={cx('h-8 px-3 rounded-full text-[13px] flex items-center gap-1.5', view === v ? 'bg-card-hover text-fg' : 'text-fg-2')}>
                {v === 'board' ? <LayoutGrid size={13} /> : <List size={13} />} {v === 'board' ? 'Board' : 'List'}
              </button>
            ))}
          </div>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}><Plus size={14} /> New task</Button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <EmptyTasks />
      ) : view === 'board' ? (
        <LayoutGroup>
          <div className="flex-1 min-h-0 overflow-x-auto px-6 pb-6">
            <div className="grid grid-cols-5 gap-3 min-w-[880px] h-full">
              {COLUMNS.map((col) => {
                const list = filtered.filter((t) => col.statuses.includes(t.status))
                const droppable = col.key === 'todo' || col.key === 'in_progress'
                return (
                  <div
                    key={col.key}
                    onDragOver={(e) => {
                      if (droppable && e.dataTransfer.types.includes('text/task')) {
                        e.preventDefault()
                        setDropCol(col.key)
                      }
                    }}
                    onDragLeave={() => setDropCol(null)}
                    onDrop={(e) => void onDrop(col.key, e.dataTransfer.getData('text/task'))}
                    className={cx('rounded-2xl bg-sidebar border flex flex-col min-h-0 transition-colors', dropCol === col.key ? 'border-accent/60 bg-accent-soft' : 'border-divider')}
                  >
                    <div className="px-3 pt-3 pb-2 flex items-center gap-2 text-[13px] font-semibold">
                      {col.title}
                      <span className="text-muted font-normal">{list.length}</span>
                    </div>
                    <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
                      <AnimatePresence initial={false}>
                        {list.map((t) => <TaskCard key={t.id} task={t} draggable={t.status === 'todo' || t.status === 'in_progress' || t.status === 'interrupted'} />)}
                      </AnimatePresence>
                      {!list.length && <div className="text-[12.5px] text-muted text-center py-6">{col.key === 'in_progress' ? 'Drag a card here to start it' : 'Nothing here'}</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </LayoutGroup>
      ) : (
        <TaskList tasks={filtered} />
      )}
      <NewTaskModal open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}

function TaskList({ tasks }: { tasks: Task[] }) {
  const agents = useApp((s) => s.agents)
  const openTask = useApp((s) => s.openTask)
  const toast = useApp((s) => s.toast)
  useTick(tasks.some((t) => t.status === 'in_progress'))
  return (
    <div className="flex-1 overflow-y-auto px-6 pb-6">
      <div className="rounded-2xl border border-line overflow-hidden">
        <div className="grid grid-cols-[1fr_160px_150px_90px_110px] gap-3 px-4 h-10 items-center text-[12px] text-muted bg-sidebar border-b border-line">
          <div>Task</div><div>Agent</div><div>Status</div><div>Time</div><div />
        </div>
        <AnimatePresence initial={false}>
          {tasks.map((t) => {
            const a = agents.find((x) => x.id === t.agentId)
            const m = STATUS_META[t.status]
            return (
              <motion.div layout key={t.id} data-task-id={t.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => openTask(t.id)} className="grid grid-cols-[1fr_160px_150px_90px_110px] gap-3 px-4 py-2.5 items-center border-b border-divider last:border-0 hover:bg-card cursor-pointer">
                <div className="min-w-0">
                  <div className="text-[14px] font-medium truncate">{t.title}</div>
                  <div className="text-[12px] text-muted truncate">{t.lastActivity}</div>
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  {a && <AgentAvatar avatar={a.avatar} color={a.color} size={20} />}
                  <span className="text-[13px] truncate">{a?.name ?? 'Unassigned'}</span>
                </div>
                <div><Pill tone={m.tone}>{m.label}</Pill></div>
                <div className="text-[12.5px] text-muted">{t.startedAt ? elapsed(t.startedAt, t.status === 'in_progress' ? null : t.finishedAt) : relative(t.createdAt)}</div>
                <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                  {t.status === 'todo' && <Button size="sm" onClick={async () => { const r = await api.tasksStart(t.id); if (!r.ok) toast('error', r.error) }}><Play size={12} /> Start</Button>}
                  {(t.status === 'failed' || t.status === 'cancelled') && <Button size="sm" onClick={async () => { const r = await api.tasksRetry(t.id); if (!r.ok) toast('error', r.error) }}><RotateCcw size={12} /> Retry</Button>}
                  {t.status === 'interrupted' && <Button size="sm" onClick={async () => { const r = await api.tasksResume(t.id); if (!r.ok) toast('error', r.error) }}><Play size={12} /> Resume</Button>}
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
        {!tasks.length && <div className="text-sm text-muted text-center py-10">No tasks match your filters.</div>}
      </div>
    </div>
  )
}

function EmptyTasks() {
  const { settings, send, setRoute, activeConversationId, openConversation, conversations, agents } = useApp()
  const name = settings?.managerName ?? 'Drake'
  const chips = ['Research the top 5 note-taking apps and write a comparison', 'Draft a weekly newsletter about our product', 'Organise the files in my workspace into folders']
  return (
    <EmptyState icon={<ClipboardList size={36} />} title="No tasks yet" body={`Ask ${name} to do something! Tasks appear here as soon as your team starts working.`}>
      <div className="flex flex-col gap-2 w-full max-w-[460px]">
        {chips.map((c) => (
          <motion.button key={c} whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }}
            onClick={async () => {
              const manager = agents.find((a) => a.isManager)
              const current = conversations.find((x) => x.id === activeConversationId)
              if (!current || current.agentId !== manager?.id) {
                const conv = conversations.find((x) => x.agentId === manager?.id)
                if (conv) await openConversation(conv.id)
              }
              setRoute('chat')
              void send(c + '.')
            }}
            className="text-[13.5px] rounded-full border border-line bg-sidebar hover:bg-card px-4 py-2 text-fg-2 hover:text-fg">
            {c}
          </motion.button>
        ))}
      </div>
    </EmptyState>
  )
}

export function NewTaskModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { agents, settings, toast } = useApp()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [agentId, setAgentId] = useState<string>('manager')
  const [priority, setPriority] = useState<Task['priority']>('normal')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (open) {
      setTitle('')
      setDescription('')
      setAgentId('manager')
      setPriority('normal')
    }
  }, [open])
  const team = agents.filter((a) => !a.isManager)
  const submit = async (start: boolean) => {
    setSaving(true)
    try {
      await api.tasksCreate({ title: title.trim(), description: description.trim(), agentId: agentId === 'manager' ? null : agentId, priority, start })
      toast('success', agentId === 'manager' ? `${settings?.managerName ?? 'The Manager'} will take it from here.` : start ? 'Task started.' : 'Task added to To do.')
      onClose()
    } catch (e) {
      toast('error', e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="New task" width={560} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        {agentId !== 'manager' && <Button disabled={!title.trim() || saving} onClick={() => submit(false)}>Add to To do</Button>}
        <Button variant="primary" disabled={!title.trim() || saving} onClick={() => submit(true)}>{agentId === 'manager' ? `Send to ${settings?.managerName ?? 'Manager'}` : 'Start now'}</Button>
      </>
    }>
      <Field label="What needs doing?"><input autoFocus className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Compare the top 5 note-taking apps" /></Field>
      <Field label="Details" hint="The more detail, the better the result: what you want, where to save it, and what “done” looks like.">
        <textarea className={cx(inputCls, 'min-h-[110px] resize-y')} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Who should do it?">
          <select className={inputCls} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="manager">Let {settings?.managerName ?? 'the Manager'} decide</option>
            {team.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select className={inputCls} value={priority} onChange={(e) => setPriority(e.target.value as Task['priority'])}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </Field>
      </div>
    </Modal>
  )
}
