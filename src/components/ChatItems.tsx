import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Check, ChevronDown, CornerDownLeft, ExternalLink, FolderOpen, Paperclip, RefreshCw, ShieldQuestion, WifiOff, X, Clock, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChatItem } from '@shared/types'
import { cx } from '@/lib/format'
import { api } from '@/lib/ipc'
import { toolLabel } from '@/lib/toolLabels'
import { useApp } from '@/stores/app'
import { Markdown } from './Markdown'
import { Button } from './ui'

const appear = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.18, ease: 'easeOut' as const } }

export function TextBubble({ item }: { item: ChatItem & { kind: 'text' } }) {
  if (item.role === 'user') {
    return (
      <motion.div {...appear} className="flex justify-end">
        <div className={cx('max-w-[640px] bg-user rounded-2xl px-4 py-[11px] text-[15px] leading-[1.6]', item.queued && 'opacity-70')}>
          <div className="whitespace-pre-wrap break-words selectable">{item.text}</div>
          {!!item.attachments?.length && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {item.attachments.map((a) => (
                <button key={a} onClick={() => api.openPath(a)} className="flex items-center gap-1 text-xs bg-black/25 rounded-full px-2 py-0.5 text-fg-2 hover:text-fg">
                  <Paperclip size={11} /> {a.split('/').pop()}
                </button>
              ))}
            </div>
          )}
          {item.queued && <div className="text-[11.5px] text-muted mt-1 flex items-center gap-1"><Clock size={11} /> Waiting for connection…</div>}
          {item.source === 'telegram' && <div className="text-[11px] text-muted mt-1 flex items-center gap-1 justify-end"><Send size={10} /> from Telegram</div>}
        </div>
      </motion.div>
    )
  }
  return (
    <motion.div {...appear} className="flex">
      <div className="max-w-[640px] min-w-0 bg-card rounded-2xl px-[14px] py-[11px] text-[15px] leading-[1.6] break-words">
        <Markdown text={item.text} />
      </div>
    </motion.div>
  )
}

export function StreamingBubble({ text }: { text: string }) {
  return (
    <div className="flex">
      <div className="max-w-[640px] min-w-0 bg-card rounded-2xl px-[14px] py-[11px] text-[15px] leading-[1.6] break-words">
        <Markdown text={text} />
      </div>
    </div>
  )
}

function DiffView({ before, after }: { before: string; after: string }) {
  const a = before.split('\n')
  const b = after.split('\n')
  return (
    <pre className="font-mono text-[12px] leading-[1.5] overflow-x-auto max-h-[320px] overflow-y-auto">
      {a.map((l, i) => <div key={`a${i}`} className="bg-danger-soft text-[#fca5a5] px-2">- {l}</div>)}
      {b.map((l, i) => <div key={`b${i}`} className="bg-success-soft text-[#86efac] px-2">+ {l}</div>)}
    </pre>
  )
}

export function ToolCard({ item }: { item: ChatItem & { kind: 'tool' } }) {
  const [open, setOpen] = useState(false)
  const l = toolLabel(item.name, item.input)
  const Icon = l.icon
  const filePath = typeof item.input.file_path === 'string' ? item.input.file_path : null
  return (
    <motion.div {...appear} className="flex">
      <div className="max-w-[640px] w-full sm:w-auto min-w-[260px] rounded-xl border border-line bg-bg-raised overflow-hidden">
        <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2.5 px-3 h-10 text-[14px] text-left hover:bg-white/[0.03]">
          <span className={cx('w-6 h-6 rounded-md flex items-center justify-center shrink-0', item.status === 'error' ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent')}>
            <Icon size={14} />
          </span>
          <span className="truncate text-fg-2">
            {l.verb} {l.target && <b className="text-fg font-semibold">{l.target}</b>}
          </span>
          <span className="ml-auto flex items-center gap-2 shrink-0 pl-2">
            {item.status === 'running' && <span className="flex gap-0.5"><Dot d={0} /><Dot d={0.15} /><Dot d={0.3} /></span>}
            {item.status === 'done' && <Check size={14} className="text-success" />}
            {item.status === 'error' && <AlertTriangle size={14} className="text-danger" />}
            <ChevronDown size={15} className={cx('text-muted transition', open && 'rotate-180')} />
          </span>
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
              <div className="border-t border-line px-3 py-2.5 text-[12.5px] space-y-2">
                <div className="text-muted">Technical name: <code className="font-mono">{l.technical}</code></div>
                {item.name === 'Edit' && typeof item.input.old_string === 'string' ? (
                  <DiffView before={String(item.input.old_string)} after={String(item.input.new_string ?? '')} />
                ) : item.name === 'Write' && typeof item.input.content === 'string' ? (
                  <DiffView before="" after={String(item.input.content).slice(0, 4000)} />
                ) : (item.name === 'Bash' || item.name === 'PowerShell') ? (
                  <pre className="font-mono bg-black/40 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap">$ {String(item.input.command ?? '')}</pre>
                ) : (
                  <pre className="font-mono bg-black/40 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap max-h-[200px]">{JSON.stringify(item.input, null, 2)}</pre>
                )}
                {item.result && (
                  <pre className={cx('font-mono rounded-lg p-2 overflow-auto whitespace-pre-wrap max-h-[240px]', item.isError ? 'bg-danger-soft text-[#fca5a5]' : 'bg-black/40 text-fg-2')}>{item.result.slice(0, 6000)}</pre>
                )}
                {filePath && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => api.openPath(filePath)}><ExternalLink size={13} /> Open file</Button>
                    <Button size="sm" variant="ghost" onClick={() => api.showInFolder(filePath)}><FolderOpen size={13} /> Show in folder</Button>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

function Dot({ d }: { d: number }) {
  return <span className="w-1 h-1 rounded-full bg-accent dot-pulse" style={{ animationDelay: `${d}s` }} />
}

const LETTERS = ['A', 'B', 'C', 'D']

export function QuestionCard({ item, active }: { item: ChatItem & { kind: 'question' }; active: boolean }) {
  const [custom, setCustom] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const answered = item.answer !== undefined || item.dismissed
  const value = item.answer ?? picked

  const submit = (answer: string | null) => {
    if (answered || picked !== null) return
    setPicked(answer ?? '')
    void api.answerQuestion(item.id, answer)
  }

  const cardRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!active || answered) return
    // Take keyboard focus from the composer so A–D picks an option right away.
    const el = document.activeElement as HTMLElement | null
    if (!el || el.tagName === 'TEXTAREA' || el === document.body) cardRef.current?.focus({ preventScroll: true })
  }, [active, answered])

  useEffect(() => {
    if (!active || answered) return
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return
      const idx = LETTERS.indexOf(e.key.toUpperCase())
      if (idx >= 0 && idx < item.options.length) {
        e.preventDefault()
        submit(item.options[idx])
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  if (item.dismissed) {
    return (
      <motion.div {...appear} className="flex">
        <div className="max-w-[640px] text-[13px] text-muted italic px-1">Question closed: “{item.question}”</div>
      </motion.div>
    )
  }

  return (
    <motion.div {...appear} className="flex">
      <div ref={cardRef} tabIndex={-1} aria-label="Question" className="w-full max-w-[630px] bg-card rounded-2xl px-[14px] pt-[13px] pb-[14px] outline-none">
        <div className="flex items-start justify-between gap-3 mb-[9px]">
          <div className="font-semibold text-[15px] leading-[1.45]">
            {item.from && item.taskId && <div className="text-xs font-medium text-accent mb-0.5">{item.from} asks</div>}
            {item.question}
          </div>
          {!answered && (
            <button aria-label="Close question" onClick={() => submit(null)} className="text-fg-2 hover:text-fg mt-0.5 shrink-0">
              <X size={17} strokeWidth={1.8} />
            </button>
          )}
        </div>
        <div className="rounded-lg border border-[#3a3a3a] overflow-hidden">
          {item.options.map((opt, i) => {
            const selected = value === opt
            return (
              <motion.button
                key={opt}
                disabled={answered || picked !== null}
                onClick={() => submit(opt)}
                whileHover={answered ? undefined : { y: -1 }}
                whileTap={answered ? undefined : { scale: 0.98 }}
                className={cx(
                  'w-full flex items-center gap-[10px] h-[43px] px-[10px] text-left text-[15px] transition-colors',
                  i > 0 && 'border-t border-[#3a3a3a]',
                  selected ? 'bg-accent-soft' : answered ? 'opacity-50' : 'hover:bg-white/[0.05]'
                )}
              >
                <span className={cx('w-[20px] h-[20px] rounded-[4px] border flex items-center justify-center text-[11px] shrink-0', selected ? 'bg-accent border-accent text-accent-text' : 'bg-[#2e2e2e] border-[#444] text-fg-2')}>
                  <AnimatePresence mode="wait" initial={false}>
                    {selected ? (
                      <motion.span key="c" initial={{ scale: 0, rotate: -45 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 22 }}><Check size={13} strokeWidth={3} /></motion.span>
                    ) : (
                      <motion.span key="l" exit={{ scale: 0 }}>{LETTERS[i]}</motion.span>
                    )}
                  </AnimatePresence>
                </span>
                <span className="truncate">{opt}</span>
              </motion.button>
            )
          })}
        </div>
        {item.allowCustom && !answered && picked === null && (
          <form
            className="mt-3 relative"
            onSubmit={(e) => {
              e.preventDefault()
              if (custom.trim()) submit(custom.trim())
            }}
          >
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Type your own answer"
              className="w-full h-[34px] rounded-lg bg-[#0e0e0e] border border-[#333] px-[10px] text-[15px] placeholder:text-fg-2/80 outline-none focus:border-accent/60"
            />
            {custom.trim() && (
              <button type="submit" aria-label="Send answer" className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-2 hover:text-fg"><CornerDownLeft size={15} /></button>
            )}
          </form>
        )}
        {value && !item.options.includes(value) && (
          <div className="mt-3 text-[14px] text-fg-2">You answered: <span className="text-fg">{value}</span></div>
        )}
      </div>
    </motion.div>
  )
}

function describePermission(toolName: string, input: Record<string, unknown>): { title: string; detail?: string } {
  const l = toolLabel(toolName, input)
  switch (toolName) {
    case 'Write': return { title: `Create the file ${l.target}?`, detail: String(input.file_path ?? '') }
    case 'Edit': return { title: `Change the file ${l.target}?`, detail: String(input.file_path ?? '') }
    case 'Bash':
    case 'PowerShell': return { title: `Run a command${input.description ? `: ${String(input.description)}` : ''}?`, detail: String(input.command ?? '') }
    case 'WebFetch': return { title: `Open ${l.target}?`, detail: String(input.url ?? '') }
    default: return { title: `${l.verb}${l.target ? ` ${l.target}` : ''}?`, detail: JSON.stringify(input).slice(0, 300) }
  }
}

export function PermissionCard({ item }: { item: ChatItem & { kind: 'permission' } }) {
  const d = describePermission(item.toolName, item.input)
  return (
    <motion.div {...appear} className="flex">
      <div className="w-full max-w-[630px] bg-card rounded-2xl p-[14px] border border-accent/25">
        <div className="flex items-start gap-3">
          <ShieldQuestion className="text-accent shrink-0 mt-0.5" size={20} />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted mb-0.5">{item.from ?? 'An agent'} wants to</div>
            <div className="font-semibold text-[15px]">{d.title}</div>
            {d.detail && <pre className="mt-2 text-[12px] font-mono bg-black/40 rounded-lg p-2 whitespace-pre-wrap break-all max-h-[140px] overflow-auto text-fg-2">{d.detail}</pre>}
            {item.decision ? (
              <div className={cx('mt-3 text-sm font-medium', item.decision === 'allow' ? 'text-success' : 'text-danger')}>
                {item.decision === 'allow' ? 'You allowed this.' : 'Not allowed.'}
              </div>
            ) : (
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="primary" onClick={() => api.answerPermission(item.id, true)}><Check size={14} /> Allow</Button>
                <Button size="sm" onClick={() => api.answerPermission(item.id, false)}><X size={14} /> Deny</Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

export function NoticeRow({ item }: { item: ChatItem & { kind: 'notice' } }) {
  const openTask = useApp((s) => s.openTask)
  const color = { info: 'text-fg-2', success: 'text-success', warning: 'text-accent', error: 'text-danger' }[item.level]
  return (
    <motion.div {...appear} className="flex justify-center">
      <button
        disabled={!item.taskId}
        onClick={() => item.taskId && openTask(item.taskId)}
        className={cx('text-[12.5px] px-3 py-1 rounded-full bg-card/60 border border-line flex items-center gap-1.5', color, item.taskId && 'hover:bg-card')}
      >
        {item.level === 'success' ? <Check size={13} /> : item.level === 'error' ? <AlertTriangle size={13} /> : null}
        {item.text}
        {item.taskId && <span className="text-muted">· View task</span>}
      </button>
    </motion.div>
  )
}

export function ErrorCard({ item, conversationId }: { item: ChatItem & { kind: 'error' }; conversationId: string }) {
  const [details, setDetails] = useState(false)
  const setReconnect = useApp((s) => s.setReconnect)
  const updateSettings = useApp((s) => s.updateSettings)
  const toast = useApp((s) => s.toast)
  const e = item.error
  const Icon = e.kind === 'network' ? WifiOff : AlertTriangle
  return (
    <motion.div {...appear} className="flex">
      <div className="w-full max-w-[630px] rounded-2xl p-[14px] bg-danger-soft border border-danger/25">
        <div className="flex items-start gap-3">
          <Icon className="text-danger shrink-0 mt-0.5" size={19} />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-[15px]">{e.title}</div>
            <div className="text-[14px] text-fg-2 mt-0.5">{e.reason}</div>
            <div className="mt-3 flex flex-wrap gap-2 items-center">
              {e.action === 'reconnect' && <Button size="sm" variant="primary" onClick={() => setReconnect(true)}>Reconnect</Button>}
              {e.action === 'retry' && <Button size="sm" variant="primary" onClick={() => api.chatRetry(conversationId)}><RefreshCw size={13} /> Try again</Button>}
              {e.action === 'choose_workspace' && (
                <Button size="sm" variant="primary" onClick={async () => {
                  const p = await api.pickFolder()
                  if (p) {
                    await updateSettings({ workspace: p })
                    toast('success', 'Workspace folder updated.')
                    void api.chatRetry(conversationId)
                  }
                }}><FolderOpen size={13} /> Choose a folder</Button>
              )}
              {e.details && <button className="text-xs text-muted hover:text-fg" onClick={() => setDetails((v) => !v)}>{details ? 'Hide details' : 'Show details'}</button>}
            </div>
            {details && e.details && <pre className="mt-2 text-[11.5px] font-mono bg-black/40 rounded-lg p-2 whitespace-pre-wrap max-h-[160px] overflow-auto text-fg-2">{e.details}</pre>}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

export function ThinkingIndicator({ activity, retry }: { activity: string | null; retry?: { until: number; attempt: number; max: number } }) {
  const [now, setNow] = useState(Date.now())
  const ref = useRef<number>(0)
  useEffect(() => {
    if (!retry) return
    ref.current = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(ref.current)
  }, [retry])
  const secs = retry ? Math.max(0, Math.ceil((retry.until - now) / 1000)) : 0
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-3">
      <div className="bg-card rounded-2xl px-4 h-[42px] flex items-center gap-1.5">
        <span className="w-[7px] h-[7px] rounded-full bg-fg-2 dot-pulse" />
        <span className="w-[7px] h-[7px] rounded-full bg-fg-2 dot-pulse" style={{ animationDelay: '0.15s' }} />
        <span className="w-[7px] h-[7px] rounded-full bg-fg-2 dot-pulse" style={{ animationDelay: '0.3s' }} />
      </div>
      <AnimatePresence mode="wait">
        <motion.span key={retry ? 'retry' : activity ?? ''} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="text-[13px] text-muted">
          {retry ? (secs > 0 ? `Claude is busy — retrying in ${secs}s… (try ${retry.attempt} of ${retry.max})` : 'Retrying now…') : activity}
        </motion.span>
      </AnimatePresence>
    </motion.div>
  )
}
