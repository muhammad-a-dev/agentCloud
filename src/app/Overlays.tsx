import { AnimatePresence, motion } from 'framer-motion'
import { Bot, CheckCircle2, ClipboardList, FolderOpen, KeyRound, LogIn, MessageSquare, RefreshCw, Search, TriangleAlert, Loader2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useState } from 'react'
import type { AuthStatus, SearchResult } from '@shared/types'
import { Button, Modal, inputCls } from '@/components/ui'
import { cx } from '@/lib/format'
import { api } from '@/lib/ipc'
import { useApp } from '@/stores/app'

// ---------------------------------------------------------------- auth

export function AuthPanel({ onConnected, compact }: { onConnected?: (s: AuthStatus) => void; compact?: boolean }) {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [checking, setChecking] = useState(true)
  const [mode, setMode] = useState<'choose' | 'signin' | 'key'>('choose')
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const check = async () => {
    setChecking(true)
    setError(null)
    const s = await api.authCheck()
    setStatus(s)
    setChecking(false)
    if (s.ok) onConnected?.(s)
    else if (mode === 'signin') setError("We still can't see a sign-in. Finish signing in in the other window, then press Check again.")
  }
  useEffect(() => {
    void check()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (checking && !status) {
    return <div className="flex items-center gap-2 text-fg-2 py-6 justify-center"><Loader2 className="animate-spin" size={18} /> Checking your connection to Claude…</div>
  }

  if (status?.ok) {
    return (
      <div className="rounded-2xl border border-success/30 bg-success-soft p-4 flex items-start gap-3">
        <CheckCircle2 className="text-success shrink-0" size={22} />
        <div className="flex-1">
          <div className="font-semibold">Connected to Claude</div>
          <div className="text-sm text-fg-2">
            {status.method === 'api_key' ? 'Using your API key' : 'Signed in with Claude Code'}
            {status.email ? ` as ${status.email}` : ''}
            {status.plan ? ` · ${status.plan}` : ''}
          </div>
        </div>
        {!compact && <Button size="sm" variant="ghost" onClick={check}><RefreshCw size={13} /> Check again</Button>}
      </div>
    )
  }

  return (
    <div>
      <div className="rounded-2xl border border-accent/30 bg-accent-soft p-4 flex items-start gap-3 mb-4">
        <TriangleAlert className="text-accent shrink-0" size={20} />
        <div className="text-sm">
          <div className="font-semibold text-fg">agentCloud isn't connected to Claude yet</div>
          <div className="text-fg-2">Your agents need a Claude account to think and work. Pick one of the two ways below — it only takes a minute.</div>
        </div>
      </div>
      {mode === 'choose' && (
        <div className="grid grid-cols-2 gap-3">
          <ChoiceCard icon={<LogIn size={20} />} title="Sign in with Claude" body="Use your Claude Pro or Max account. Recommended." onClick={() => setMode('signin')} />
          <ChoiceCard icon={<KeyRound size={20} />} title="Paste an API key" body="Use a key from console.anthropic.com." onClick={() => setMode('key')} />
        </div>
      )}
      {mode === 'signin' && (
        <div className="rounded-2xl border border-line bg-card p-4">
          <ol className="text-sm text-fg-2 space-y-2 list-decimal pl-5 mb-4">
            <li>Press <b className="text-fg">Open sign-in window</b>. A small black window opens.</li>
            <li>Follow the steps there — your browser opens so you can log in to Claude.</li>
            <li>When it says you're signed in, close that window and press <b className="text-fg">Check again</b>.</li>
          </ol>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => api.authOpenSignIn()}><LogIn size={15} /> Open sign-in window</Button>
            <Button onClick={check} disabled={checking}>{checking ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />} Check again</Button>
            <Button variant="ghost" onClick={() => { setMode('choose'); setError(null) }}>Back</Button>
          </div>
        </div>
      )}
      {mode === 'key' && (
        <div className="rounded-2xl border border-line bg-card p-4">
          <div className="text-sm text-fg-2 mb-3">
            Get a key at{' '}
            <a className="text-accent underline cursor-pointer" onClick={() => api.openExternal('https://console.anthropic.com/settings/keys')}>console.anthropic.com</a>
            . It's stored encrypted on this computer and never shown again.
          </div>
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" className={inputCls} autoFocus />
          <div className="flex gap-2 mt-3">
            <Button
              variant="primary"
              disabled={!key.trim() || saving}
              onClick={async () => {
                setSaving(true)
                setError(null)
                const r = await api.authSaveApiKey(key)
                setSaving(false)
                if (r.ok) {
                  setStatus(r.data)
                  setKey('')
                  onConnected?.(r.data)
                } else setError(r.error)
              }}
            >
              {saving ? <Loader2 className="animate-spin" size={14} /> : <KeyRound size={14} />} {saving ? 'Checking the key…' : 'Save key'}
            </Button>
            <Button variant="ghost" onClick={() => { setMode('choose'); setError(null) }}>Back</Button>
          </div>
        </div>
      )}
      {error && <div className="mt-3 text-sm text-danger">{error}</div>}
    </div>
  )
}

function ChoiceCard({ icon, title, body, onClick }: { icon: React.ReactNode; title: string; body: string; onClick: () => void }) {
  return (
    <motion.button whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} onClick={onClick} className="text-left rounded-2xl border border-line bg-card hover:bg-card-hover p-4">
      <div className="w-9 h-9 rounded-xl bg-accent-soft text-accent flex items-center justify-center mb-3">{icon}</div>
      <div className="font-semibold text-[15px]">{title}</div>
      <div className="text-sm text-fg-2">{body}</div>
    </motion.button>
  )
}

export function ReconnectModal() {
  const open = useApp((s) => s.reconnectOpen)
  const setOpen = useApp((s) => s.setReconnect)
  const toast = useApp((s) => s.toast)
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Reconnect to Claude" width={560}>
      <AuthPanel
        onConnected={() => {
          toast('success', "You're connected. Press Try again on your message.")
          setTimeout(() => setOpen(false), 900)
        }}
      />
    </Modal>
  )
}

// ---------------------------------------------------------------- workspace missing

export function WorkspaceMissing() {
  const ws = useApp((s) => s.settings?.workspace)
  const updateSettings = useApp((s) => s.updateSettings)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    const check = () => void api.workspaceExists().then((ok) => setMissing(!ok))
    check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [ws])
  return (
    <AnimatePresence>
      {missing && (
        <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
          <div className="bg-danger-soft border-b border-danger/30 text-[13px] px-4 py-2 flex items-center justify-center gap-3">
            <TriangleAlert size={14} className="text-danger" />
            <span>Your workspace folder can't be found{ws ? ` (${ws})` : ''}. Agents need it to save their work.</span>
            <Button size="sm" variant="primary" onClick={async () => {
              const p = await api.pickFolder()
              if (p) await updateSettings({ workspace: p })
            }}><FolderOpen size={13} /> Choose a folder</Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ---------------------------------------------------------------- search

const ICONS = { conversation: MessageSquare, message: MessageSquare, task: ClipboardList, agent: Bot }

export function SearchPalette() {
  const open = useApp((s) => s.searchOpen)
  const setOpen = useApp((s) => s.setSearch)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [sel, setSel] = useState(0)

  useEffect(() => {
    if (!open) {
      setQ('')
      setResults([])
    }
  }, [open])
  useEffect(() => {
    const t = setTimeout(async () => {
      setResults(q.trim() ? await api.search(q) : [])
      setSel(0)
    }, 120)
    return () => clearTimeout(t)
  }, [q])

  const go = async (r: SearchResult) => {
    const st = useApp.getState()
    setOpen(false)
    if (r.type === 'conversation') await st.openConversation(r.id)
    else if (r.type === 'message' && r.conversationId) await st.openConversation(r.conversationId)
    else if (r.type === 'task') { st.setRoute('tasks'); st.openTask(r.id) }
    else if (r.type === 'agent') {
      const c = await api.conversationsOpenForAgent(r.id)
      await st.refreshConversations()
      await st.openConversation(c.id)
    }
  }

  return (
    <Modal open={open} onClose={() => setOpen(false)} width={600}>
      <div className="pt-4">
        <div className="flex items-center gap-2 border-b border-line pb-3 mb-2">
          <Search size={18} className="text-muted" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
              if (e.key === 'Enter' && results[sel]) void go(results[sel])
            }}
            placeholder="Search chats, tasks and agents…"
            className="flex-1 bg-transparent outline-none text-[16px] placeholder:text-muted"
          />
          <kbd className="text-[11px] text-muted border border-line rounded px-1.5">Esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          {q.trim() && !results.length && <div className="text-sm text-muted text-center py-8">Nothing found for “{q}”.</div>}
          {!q.trim() && <div className="text-sm text-muted text-center py-8">Type to search everything in agentCloud.</div>}
          {results.map((r, i) => {
            const Icon = ICONS[r.type]
            return (
              <button key={`${r.type}-${r.id}`} onMouseEnter={() => setSel(i)} onClick={() => void go(r)} className={cx('w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left', i === sel && 'bg-card-hover')}>
                <Icon size={16} className="text-accent shrink-0" />
                <div className="min-w-0">
                  <div className="text-[14px] truncate">{r.title}</div>
                  <div className="text-xs text-muted truncate">{r.subtitle}</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- guided tour

const STEPS = [
  { target: 'manager', title: 'Meet your Manager', body: 'This is who you talk to. Tell them what you need and they’ll hire agents and hand out the work. Click here to change their name or look.' },
  { target: 'composer', title: 'Just type what you want', body: 'Ask for anything — research, documents, emails, code. Press Enter to send. Use + to attach files or drop them right onto the window.' },
  { target: 'tasks', title: 'Watch the work happen', body: 'Every job becomes a task. Open the board to see what’s in progress, read reports and stop anything at any time.' },
  { target: 'connect', title: 'Connect your apps', body: 'Link Gmail, GitHub, Notion and more so your agents can work with them.' },
  { target: 'access', title: 'Full access', body: 'Agents can change files in your workspace without asking. Switch to “Ask before risky actions” here whenever you like. Ctrl+Shift+X stops everything instantly.' }
]

export function Tour() {
  const open = useApp((s) => s.tourOpen)
  const setTour = useApp((s) => s.setTour)
  const updateSettings = useApp((s) => s.updateSettings)
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (open) setStep(0)
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    const update = () => setRect(document.querySelector(`[data-tour="${STEPS[step].target}"]`)?.getBoundingClientRect() ?? null)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [open, step])

  const finish = () => {
    setTour(false)
    void updateSettings({ tourDone: true })
  }

  if (!open) return null
  const s = STEPS[step]
  const pad = 8
  const r = rect ?? new DOMRect(window.innerWidth / 2 - 50, window.innerHeight / 2 - 20, 100, 40)
  const below = r.bottom + 200 < window.innerHeight
  const left = Math.min(Math.max(r.left + r.width / 2 - 170, 16), window.innerWidth - 356)
  return (
    <div className="fixed inset-0 z-[80]">
      <motion.div
        className="absolute rounded-2xl pointer-events-none"
        animate={{ left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 }}
        transition={{ type: 'spring', stiffness: 260, damping: 30 }}
        style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.65)', border: '2px solid var(--accent)' }}
      />
      <div className="absolute inset-0" onClick={finish} />
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="absolute w-[340px] bg-card-2 border border-line rounded-2xl p-4 shadow-[var(--shadow)]"
          style={{ left, top: below ? r.bottom + pad + 12 : undefined, bottom: below ? undefined : window.innerHeight - r.top + pad + 12 }}
        >
          <div className="text-[11.5px] text-accent font-semibold mb-1">Step {step + 1} of {STEPS.length}</div>
          <div className="font-semibold text-[15px] mb-1">{s.title}</div>
          <div className="text-sm text-fg-2 mb-4">{s.body}</div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1 mr-auto">
              {STEPS.map((_, i) => <span key={i} className={cx('w-1.5 h-1.5 rounded-full', i === step ? 'bg-accent' : 'bg-line-strong')} />)}
            </div>
            <Button size="sm" variant="ghost" onClick={finish}>Skip</Button>
            <Button size="sm" variant="primary" onClick={() => (step < STEPS.length - 1 ? setStep(step + 1) : finish())}>{step < STEPS.length - 1 ? 'Next' : 'Got it'}</Button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
