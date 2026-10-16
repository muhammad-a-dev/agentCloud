import { AnimatePresence, motion } from 'framer-motion'
import { CircleSlash, ExternalLink, FileText, FolderOpen, MessageSquare, Play, RotateCcw, Trash2, UserRoundCog, Wand2, X, AlertTriangle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChatItem, TaskEvent } from '@shared/types'
import { STATUS_META } from '@/app/Tasks'
import { cx, elapsed, money, compact } from '@/lib/format'
import { api } from '@/lib/ipc'
import { useApp } from '@/stores/app'
import { AgentAvatar } from './Avatars'
import { PermissionCard, QuestionCard } from './ChatItems'
import { Markdown } from './Markdown'
import { Button, Confirm, Pill } from './ui'

export function TaskDrawer() {
  const { openTaskId, openTask, tasks, agents, toast, openConversation } = useApp()
  const task = tasks.find((t) => t.id === openTaskId)
  const [events, setEvents] = useState<TaskEvent[]>([])
  const [pending, setPending] = useState<ChatItem[]>([])
  const [reassign, setReassign] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const [, tick] = useState(0)

  useEffect(() => {
    if (!openTaskId) return
    void api.tasksEvents(openTaskId).then(setEvents)
    return api.onEvent((e) => {
      if (e.type === 'task:event' && e.event.taskId === openTaskId) setEvents((ev) => [...ev, e.event])
      if (e.type === 'chat:item' && (e.item.kind === 'question' || e.item.kind === 'permission') && e.item.taskId === openTaskId) {
        setPending((p) => {
          const i = p.findIndex((x) => x.id === e.item.id)
          return i === -1 ? [...p, e.item] : p.map((x) => (x.id === e.item.id ? e.item : x))
        })
      }
    })
  }, [openTaskId])

  useEffect(() => {
    setPending([])
    if (!task?.conversationId) return
    void api.chatItems(task.conversationId).then((items) =>
      setPending(items.filter((i) => (i.kind === 'question' && i.taskId === task.id && i.answer === undefined && !i.dismissed) || (i.kind === 'permission' && i.taskId === task.id && !i.decision)))
    )
  }, [task?.id, task?.conversationId])

  useEffect(() => {
    if (!openTaskId) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && openTask(null)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [openTaskId, openTask])

  const live = task?.status === 'in_progress' || task?.status === 'needs_input'
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [live])

  useEffect(() => {
    const el = logRef.current
    if (el && live) el.scrollTop = el.scrollHeight
  }, [events.length, live])

  const agent = agents.find((a) => a.id === task?.agentId)
  const run = async (fn: () => Promise<{ ok: boolean; error?: string } | void>, okMsg?: string) => {
    const r = await fn()
    if (r && !r.ok) toast('error', r.error ?? 'Something went wrong.')
    else if (okMsg) toast('success', okMsg)
  }

  return (
    <AnimatePresence>
      {task && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => openTask(null)} />
          <motion.aside
            initial={{ x: 480 }}
            animate={{ x: 0 }}
            exit={{ x: 480 }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-[480px] max-w-[92vw] bg-sidebar border-l border-line flex flex-col shadow-[var(--shadow)]"
          >
            <div className="px-5 pt-5 pb-4 border-b border-line">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[18px] font-semibold leading-snug">{task.title}</div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <Pill tone={STATUS_META[task.status].tone}>{STATUS_META[task.status].label}</Pill>
                    {agent && (
                      <span className="flex items-center gap-1.5 text-[13px] text-fg-2">
                        <AgentAvatar avatar={agent.avatar} color={agent.color} size={18} /> {agent.name}
                      </span>
                    )}
                    {task.startedAt && <span className="text-[12.5px] text-muted">· {elapsed(task.startedAt, live ? null : task.finishedAt)}</span>}
                    {task.costUsd > 0 && <span className="text-[12.5px] text-muted">· {money(task.costUsd)} · {compact(task.tokens)} tokens</span>}
                  </div>
                </div>
                <button aria-label="Close" className="text-muted hover:text-fg p-1" onClick={() => openTask(null)}><X size={18} /></button>
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                {live && <Button size="sm" variant="danger" onClick={() => run(() => api.tasksCancel(task.id), 'Task cancelled.')}><CircleSlash size={13} /> Cancel</Button>}
                {task.status === 'todo' && <Button size="sm" variant="primary" onClick={() => run(() => api.tasksStart(task.id))}><Play size={13} /> Start</Button>}
                {task.status === 'interrupted' && <Button size="sm" variant="primary" onClick={() => run(() => api.tasksResume(task.id))}><Play size={13} /> Resume</Button>}
                {(task.status === 'failed' || task.status === 'cancelled' || task.status === 'done' || task.status === 'interrupted') && (
                  <Button size="sm" onClick={() => run(() => api.tasksRetry(task.id))}><RotateCcw size={13} /> {task.status === 'done' ? 'Run again' : 'Retry'}</Button>
                )}
                {task.status === 'failed' && (
                  <Button size="sm" onClick={async () => {
                    const r = await api.tasksAskManagerToFix(task.id)
                    if (!r.ok) return toast('error', r.error)
                    openTask(null)
                    await openConversation(r.data)
                  }}><Wand2 size={13} /> Ask Manager to fix</Button>
                )}
                {!live && (
                  <div className="relative">
                    <Button size="sm" onClick={() => setReassign((v) => !v)}><UserRoundCog size={13} /> Reassign</Button>
                    {reassign && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setReassign(false)} />
                        <div className="absolute z-20 top-10 left-0 w-[220px] bg-card-2 border border-line rounded-xl p-1.5 shadow-[var(--shadow)] max-h-[260px] overflow-y-auto">
                          {agents.filter((a) => !a.isManager && a.id !== task.agentId).map((a) => (
                            <button key={a.id} className="w-full flex items-center gap-2 px-2.5 h-9 rounded-lg hover:bg-card-hover text-[14px]" onClick={async () => {
                              setReassign(false)
                              await api.tasksReassign(task.id, a.id)
                              toast('success', `Reassigned to ${a.name}. Press Start when ready.`)
                            }}>
                              <AgentAvatar avatar={a.avatar} color={a.color} size={20} /> {a.name}
                            </button>
                          ))}
                          {agents.filter((a) => !a.isManager && a.id !== task.agentId).length === 0 && <div className="text-xs text-muted p-2">No other agents yet.</div>}
                        </div>
                      </>
                    )}
                  </div>
                )}
                {task.conversationId && (
                  <Button size="sm" variant="ghost" onClick={async () => { openTask(null); await openConversation(task.conversationId!) }}><MessageSquare size={13} /> Open in chat</Button>
                )}
                {!live && <Button size="sm" variant="ghost" onClick={() => setConfirmDel(true)}><Trash2 size={13} /> Delete</Button>}
              </div>
            </div>

            <div ref={logRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {task.error && (task.status === 'failed' || task.status === 'interrupted') && (
                <div className="rounded-xl bg-danger-soft border border-danger/25 p-3 text-[14px] flex gap-2"><AlertTriangle size={16} className="text-danger shrink-0 mt-0.5" /> {task.error}</div>
              )}
              {task.status === 'interrupted' && !task.error && (
                <div className="rounded-xl bg-[rgba(234,179,8,0.1)] border border-warning/30 p-3 text-[14px]">agentCloud closed while this was running. Press <b>Resume</b> to pick up where it left off.</div>
              )}
              {pending.filter((p) => (p.kind === 'question' && p.answer === undefined && !p.dismissed) || (p.kind === 'permission' && !p.decision)).map((p) =>
                p.kind === 'question' ? <QuestionCard key={p.id} item={p} active /> : p.kind === 'permission' ? <PermissionCard key={p.id} item={p} /> : null
              )}

              {task.report && (
                <Section title="Report">
                  <div className="rounded-xl bg-card p-3.5 text-[14px]"><Markdown text={task.report.replace(/^#{1,3}\s*Report\s*\n/i, '')} /></div>
                </Section>
              )}

              {task.filesChanged.length > 0 && (
                <Section title="Files changed">
                  <div className="rounded-xl border border-line divide-y divide-divider">
                    {task.filesChanged.map((f) => (
                      <div key={f} className="flex items-center gap-2 px-3 h-10 text-[13.5px]">
                        <FileText size={14} className="text-accent shrink-0" />
                        <span className="truncate flex-1">{f}</span>
                        <button aria-label="Open file" title="Open" className="text-muted hover:text-fg" onClick={() => api.openPath(f)}><ExternalLink size={14} /></button>
                        <button aria-label="Show in folder" title="Show in folder" className="text-muted hover:text-fg" onClick={() => api.showInFolder(f)}><FolderOpen size={14} /></button>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              <Section title="Brief">
                <div className="text-[14px] text-fg-2"><Markdown text={task.description || '_No details._'} /></div>
              </Section>

              <Section title="Activity">
                <div className="space-y-1.5">
                  {events.map((e) => <EventRow key={e.id} e={e} />)}
                  {live && (
                    <div className="flex items-center gap-2 text-[13px] text-muted pl-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent dot-pulse" /> {task.lastActivity ?? 'Working…'}
                    </div>
                  )}
                  {!events.length && !live && <div className="text-[13px] text-muted">No activity yet.</div>}
                </div>
              </Section>
            </div>
          </motion.aside>
          <Confirm open={confirmDel} title="Delete this task?" message="The task and its activity log will be removed. Files that were created stay in your workspace." confirmLabel="Delete" danger onClose={() => setConfirmDel(false)}
            onConfirm={async () => {
              await api.tasksDelete(task.id)
              openTask(null)
              await useApp.getState().refreshTasks()
            }} />
        </>
      )}
    </AnimatePresence>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] font-semibold uppercase tracking-wide text-muted mb-2">{title}</div>
      {children}
    </div>
  )
}

function EventRow({ e }: { e: TaskEvent }) {
  const [open, setOpen] = useState(false)
  const p = e.payload as Record<string, unknown>
  const time = new Date(e.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  if (e.type === 'tool_result') {
    if (!p.isError) return null
    const raw = String(p.text ?? '').split('\n')[0]
    const why = /timeout|timed out/i.test(raw) ? 'it took too long'
      : /not found|no such file|enoent/i.test(raw) ? "something it looked for wasn't there"
      : /denied|permission/i.test(raw) ? "it wasn't allowed"
      : 'it ran into a problem'
    return <div title={raw} className="text-[12.5px] text-accent pl-[66px]">That step didn't work ({why}), so the agent carried on another way.</div>
  }
  const label =
    e.type === 'tool' ? String(p.label ?? p.name)
    : e.type === 'file' ? `Saved ${String(p.path)}`
    : e.type === 'report' ? 'Wrote the final report'
    : String(p.text ?? '').replace(/[#*`_>]+/g, '').replace(/\s+/g, ' ').trim()
  const tone = e.type === 'error' ? 'text-danger' : e.type === 'file' ? 'text-accent' : e.type === 'status' || e.type === 'report' ? 'text-fg' : 'text-fg-2'
  const expandable = e.type === 'text' && label.length > 140
  return (
    <div className="flex gap-3 text-[13px]">
      <span className="text-muted w-[54px] shrink-0 tabular-nums text-[11.5px] pt-[2px] whitespace-nowrap">{time}</span>
      <button disabled={!expandable && e.type !== 'tool'} onClick={() => setOpen((v) => !v)} className={cx('text-left min-w-0', tone)}>
        <span className={cx(!open && 'line-clamp-2')}>{label}</span>
        {open && e.type === 'tool' && <pre className="mt-1 font-mono text-[11.5px] bg-black/40 rounded-lg p-2 whitespace-pre-wrap max-h-[160px] overflow-auto text-fg-2">{JSON.stringify(p.input, null, 2)}</pre>}
      </button>
    </div>
  )
}
