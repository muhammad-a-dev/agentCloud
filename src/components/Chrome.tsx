// App chrome: error boundaries, toasts, window controls, offline banner, confetti.
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Info, Minus, Square, Copy, X, XCircle, WifiOff, ShieldAlert, OctagonX } from 'lucide-react'
import { Component, useEffect, useState, type ReactNode } from 'react'
import { api } from '@/lib/ipc'
import { useApp } from '@/stores/app'
import { Button, Tooltip } from './ui'

export class PanelBoundary extends Component<{ children: ReactNode; name?: string }, { error: Error | null; key: number }> {
  state = { error: null as Error | null, key: 0 }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.error(`[${this.props.name ?? 'panel'}]`, error)
  }
  render() {
    if (this.state.error) {
      return (
        <div className="h-full w-full flex items-center justify-center p-6">
          <div className="bg-card border border-line rounded-2xl p-5 max-w-sm text-center">
            <AlertTriangle className="mx-auto text-accent mb-2" size={26} />
            <div className="font-semibold mb-1">Something went wrong in this panel</div>
            <div className="text-sm text-fg-2 mb-4">The rest of agentCloud is still working.</div>
            <Button variant="primary" size="sm" onClick={() => this.setState((s) => ({ error: null, key: s.key + 1 }))}>Reload panel</Button>
          </div>
        </div>
      )
    }
    return <div key={this.state.key} className="contents">{this.props.children}</div>
  }
}

const TOAST_ICON = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle }
const TOAST_COLOR = { info: 'text-fg-2', success: 'text-success', warning: 'text-accent', error: 'text-danger' }

export function Toasts() {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  return (
    <div className="fixed bottom-24 right-5 z-[60] flex flex-col gap-2 items-end pointer-events-none">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = TOAST_ICON[t.level]
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 40, y: 10 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, x: 40, transition: { duration: 0.15 } }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="pointer-events-auto flex items-start gap-2.5 bg-card-2 border border-line rounded-xl pl-3 pr-2 py-2.5 shadow-[var(--shadow)] max-w-[360px]"
              role="status"
            >
              <Icon size={17} className={`${TOAST_COLOR[t.level]} mt-[2px] shrink-0`} />
              <div className="text-[13.5px] leading-snug flex-1">{t.message}</div>
              {t.action && (
                <button className="text-[13px] text-accent font-medium px-1" onClick={() => { t.action!.run(); dismiss(t.id) }}>{t.action.label}</button>
              )}
              <button aria-label="Dismiss" className="text-muted hover:text-fg p-0.5" onClick={() => dismiss(t.id)}><X size={14} /></button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

export function WindowControls() {
  const [max, setMax] = useState(false)
  useEffect(() => {
    void api.windowIsMaximized().then(setMax)
    return api.onEvent((e) => e.type === 'window:maximized' && setMax(e.value))
  }, [])
  const cls = 'w-11 h-9 flex items-center justify-center text-white/90 hover:bg-white/10 transition rounded-md'
  return (
    <div className="flex items-center no-drag">
      <Tooltip label="Minimize"><button aria-label="Minimize" className={cls} onClick={() => api.windowMinimize()}><Minus size={17} strokeWidth={1.4} /></button></Tooltip>
      <Tooltip label={max ? 'Restore' : 'Maximize'}>
        <button aria-label={max ? 'Restore' : 'Maximize'} className={cls} onClick={() => api.windowToggleMaximize().then(setMax)}>
          {max ? <Copy size={14} strokeWidth={1.4} className="-scale-x-100" /> : <Square size={14} strokeWidth={1.4} />}
        </button>
      </Tooltip>
      <Tooltip label="Close"><button aria-label="Close" className={`${cls} hover:!bg-[#c42b1c]`} onClick={() => api.windowClose()}><X size={18} strokeWidth={1.4} /></button></Tooltip>
    </div>
  )
}

export function FullAccessBadge() {
  const mode = useApp((s) => s.settings?.permissionMode)
  const openSettings = useApp((s) => s.openSettings)
  if (mode === 'ask') {
    return (
      <Tooltip label="Agents will ask before editing files or running commands. Click to change.">
        <button data-tour="access" onClick={() => openSettings('permissions')} className="no-drag h-7 px-2.5 rounded-full border border-line bg-card text-fg-2 text-xs font-medium flex items-center gap-1.5 hover:bg-card-hover">
          <ShieldAlert size={13} /> Ask first
        </button>
      </Tooltip>
    )
  }
  return (
    <Tooltip label="Full access: your agents can create, change and delete files in your workspace folder and run programs without asking first. Click to change.">
      <button data-tour="access" onClick={() => openSettings('permissions')} className="no-drag h-7 px-2.5 rounded-full border border-accent/40 bg-accent-soft text-accent text-xs font-semibold flex items-center gap-1.5 hover:brightness-110">
        <ShieldAlert size={13} /> Full access
      </button>
    </Tooltip>
  )
}

export function StopAllButton() {
  const tasks = useApp((s) => s.tasks)
  const busy = useApp((s) => s.busy)
  const toast = useApp((s) => s.toast)
  const running = tasks.filter((t) => t.status === 'in_progress' || t.status === 'needs_input').length + Object.keys(busy).length
  if (!running) return null
  return (
    <Tooltip label="Stop all agents right now (Ctrl+Shift+X)">
      <motion.button
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        onClick={async () => {
          const n = await api.stopAll()
          toast('warning', n ? `Stopped ${n} running job${n === 1 ? '' : 's'}.` : 'Nothing was running.')
        }}
        className="no-drag h-7 px-2.5 rounded-full border border-danger/40 bg-danger-soft text-danger text-xs font-semibold flex items-center gap-1.5 hover:bg-danger/20"
      >
        <OctagonX size={13} /> Stop all
      </motion.button>
    </Tooltip>
  )
}

export function OfflineBanner() {
  const online = useApp((s) => s.online)
  const queued = useApp((s) => s.queue.length)
  return (
    <AnimatePresence>
      {!online && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
          <div className="bg-[rgba(234,179,8,0.12)] border-b border-warning/30 text-warning text-[13px] px-4 py-2 flex items-center justify-center gap-2">
            <WifiOff size={14} /> You're offline. {queued ? `${queued} message${queued === 1 ? '' : 's'} will be sent when you're back online.` : "Messages you send will go out when you're back online."}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Small celebratory burst when a task finishes. */
export function Celebration() {
  const celebrate = useApp((s) => s.celebrate)
  const [burst, setBurst] = useState<{ x: number; y: number; at: number } | null>(null)
  useEffect(() => {
    if (!celebrate) return
    const el = document.querySelector(`[data-task-id="${celebrate.taskId}"]`)
    const r = el?.getBoundingClientRect()
    setBurst({ x: r ? r.left + r.width / 2 : window.innerWidth - 120, y: r ? r.top + r.height / 2 : window.innerHeight - 120, at: celebrate.at })
    const t = setTimeout(() => setBurst(null), 1400)
    return () => clearTimeout(t)
  }, [celebrate])
  if (!burst || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null
  const colors = ['#F7A51C', '#FBBF24', '#FB923C', '#ffffff', '#22c55e']
  return (
    <div className="fixed inset-0 pointer-events-none z-[70]" key={burst.at}>
      <motion.div className="absolute w-12 h-12 rounded-full bg-success flex items-center justify-center" style={{ left: burst.x - 24, top: burst.y - 24 }}
        initial={{ scale: 0, opacity: 0 }} animate={{ scale: [0, 1.15, 1], opacity: [0, 1, 0] }} transition={{ duration: 1.2, times: [0, 0.3, 1] }}>
        <CheckCircle2 className="text-white" size={28} />
      </motion.div>
      {Array.from({ length: 22 }).map((_, i) => {
        const angle = (i / 22) * Math.PI * 2
        const dist = 60 + (i % 4) * 18
        return (
          <motion.span key={i} className="absolute w-2 h-2 rounded-[2px]" style={{ left: burst.x, top: burst.y, background: colors[i % colors.length] }}
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
            animate={{ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist + 30, opacity: 0, rotate: 180 }}
            transition={{ duration: 1, ease: 'easeOut' }} />
        )
      })}
    </div>
  )
}
