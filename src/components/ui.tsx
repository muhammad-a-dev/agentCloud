import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '@/lib/format'

export function Tooltip({ label, children, side = 'bottom' }: { label: string; children: ReactNode; side?: 'bottom' | 'top' | 'right' | 'left' }) {
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  const timer = useRef<number>(0)
  const open = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const r = ref.current?.getBoundingClientRect()
      if (!r) return
      const p =
        side === 'bottom' ? { x: r.left + r.width / 2, y: r.bottom + 8 }
        : side === 'top' ? { x: r.left + r.width / 2, y: r.top - 8 }
        : side === 'right' ? { x: r.right + 8, y: r.top + r.height / 2 }
        : { x: r.left - 8, y: r.top + r.height / 2 }
      setPos(p)
      setShow(true)
    }, 350)
  }
  const close = () => {
    window.clearTimeout(timer.current)
    setShow(false)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const transform =
    side === 'bottom' ? 'translate(-50%, 0)' : side === 'top' ? 'translate(-50%, -100%)' : side === 'right' ? 'translate(0, -50%)' : 'translate(-100%, -50%)'
  return (
    <span ref={ref} onMouseEnter={open} onMouseLeave={close} onMouseDown={close} onFocus={open} onBlur={close} className="inline-flex">
      {children}
      {show && pos &&
        createPortal(
          <div
            role="tooltip"
            className="fixed z-[100] pointer-events-none px-2.5 py-1.5 rounded-lg bg-[#2b2b2b] text-white text-xs leading-snug shadow-lg max-w-[260px] border border-[#3a3a3a]"
            style={{ left: Math.min(Math.max(pos.x, 12), window.innerWidth - 12), top: pos.y, transform }}
          >
            {label}
          </div>,
          document.body
        )}
    </span>
  )
}

export function IconButton({
  label, children, className, badge, side, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; badge?: number; side?: 'bottom' | 'top' | 'right' | 'left' }) {
  return (
    <Tooltip label={label} side={side}>
      <button
        aria-label={label}
        className={cx('relative w-8 h-8 rounded-full bg-card border border-line flex items-center justify-center text-fg hover:bg-card-hover active:scale-95 transition', className)}
        {...rest}
      >
        {children}
        {!!badge && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-accent text-accent-text text-[10px] font-bold flex items-center justify-center">
            {badge}
          </span>
        )}
      </button>
    </Tooltip>
  )
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent'

export function Button({
  variant = 'secondary', size = 'md', className, children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' }) {
  const v: Record<BtnVariant, string> = {
    primary: 'bg-fg text-bg hover:opacity-90',
    accent: 'bg-accent text-accent-text hover:brightness-105',
    secondary: 'bg-card border border-line text-fg hover:bg-card-hover',
    ghost: 'text-fg-2 hover:text-fg hover:bg-card',
    danger: 'bg-danger-soft text-danger border border-danger/30 hover:bg-danger/20'
  }
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-full font-medium transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm',
        v[variant],
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Modal({
  open, onClose, title, children, width = 520, footer
}: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; width?: number; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="absolute inset-0 bg-[var(--overlay)]" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal
            className="relative bg-sidebar border border-line rounded-2xl shadow-[var(--shadow)] max-h-[88vh] flex flex-col w-full"
            style={{ maxWidth: width }}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            {title && (
              <div className="flex items-center justify-between px-5 pt-4 pb-3">
                <div className="font-semibold text-[16px]">{title}</div>
                <button aria-label="Close" onClick={onClose} className="text-muted hover:text-fg p-1 rounded-md">
                  <X size={18} />
                </button>
              </div>
            )}
            <div className="px-5 pb-5 overflow-y-auto">{children}</div>
            {footer && <div className="px-5 py-3 border-t border-line flex justify-end gap-2">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export function Confirm({
  open, title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose
}: { open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm(); onClose() }}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="text-fg-2 text-sm">{message}</div>
    </Modal>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="block mb-4">
      <div className="text-[13px] font-medium mb-1.5">{label}</div>
      {children}
      {hint && <div className="text-xs text-muted mt-1.5">{hint}</div>}
    </div>
  )
}

export const inputCls =
  'w-full bg-input border border-line rounded-xl px-3 py-2 text-[14px] text-fg placeholder:text-muted outline-none focus:border-accent/70 transition'

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative w-10 h-6 rounded-full transition shrink-0 flex items-center px-[3px]', checked ? 'bg-accent justify-end' : 'bg-card-hover border border-line justify-start')}
    >
      <motion.span layout transition={{ type: 'spring', stiffness: 500, damping: 32 }} className="w-[18px] h-[18px] rounded-full bg-white shadow" />
    </button>
  )
}

export function Pill({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'success' | 'danger' | 'warning'; className?: string }) {
  const t = {
    neutral: 'bg-card-hover text-fg-2 border-line',
    accent: 'bg-accent-soft text-accent border-accent/30',
    success: 'bg-success-soft text-success border-success/30',
    danger: 'bg-danger-soft text-danger border-danger/30',
    warning: 'bg-[rgba(234,179,8,0.12)] text-warning border-warning/30'
  }[tone]
  return <span className={cx('inline-flex items-center gap-1 px-2 h-[22px] rounded-full text-[11.5px] font-medium border whitespace-nowrap', t, className)}>{children}</span>
}

export function EmptyState({ icon, title, body, children }: { icon: ReactNode; title: string; body?: string; children?: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center text-center py-14 px-6">
      <div className="w-20 h-20 rounded-3xl bg-accent-soft flex items-center justify-center mb-5 text-accent">{icon}</div>
      <div className="font-semibold text-[17px] mb-1">{title}</div>
      {body && <div className="text-fg-2 text-sm max-w-sm mb-5">{body}</div>}
      {children}
    </motion.div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} />
}

export function SectionTitle({ title, subtitle, technical, right }: { title: string; subtitle?: string; technical?: string; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-5">
      <div>
        <div className="text-[19px] font-semibold leading-tight">
          {title}
          {technical && <span className="ml-2 text-xs font-normal text-muted align-middle">{technical}</span>}
        </div>
        {subtitle && <div className="text-fg-2 text-sm mt-1">{subtitle}</div>}
      </div>
      {right}
    </div>
  )
}
