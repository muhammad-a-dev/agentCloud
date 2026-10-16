import { motion } from 'framer-motion'
import { CheckCircle2, Globe, Copy, Loader2, RefreshCw, Send, Smartphone, TriangleAlert, Unlink } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ChromeStatus, TelegramStatus } from '@shared/types'
import { Button, Confirm, Pill, SectionTitle, Toggle, inputCls } from '@/components/ui'
import { cx } from '@/lib/format'
import { api } from '@/lib/ipc'
import { useApp } from '@/stores/app'

/** Card at the top of Connections: lets agents use the user's own Chrome. */
export function ChromeCard() {
  const { settings, updateSettings } = useApp()
  const [st, setSt] = useState<ChromeStatus | null>(null)
  const check = () => void api.chromeStatus().then(setSt)
  useEffect(check, [settings?.chromeEnabled])
  const ready = st?.extensionInstalled && st.paired
  return (
    <div className="rounded-2xl bg-sidebar border border-line p-4 mb-4">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shrink-0"><Globe size={22} color="#1a73e8" /></span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[15px] flex items-center gap-2">
            Your Chrome browser
            {st && (ready ? <Pill tone="success">Ready</Pill> : <Pill tone="warning">Needs the Claude extension</Pill>)}
          </div>
          <div className="text-[13px] text-fg-2 mt-0.5">
            Lets {settings?.managerName ?? 'your Manager'} and agents with “Use your Chrome browser” click, type and read pages in <b className="text-fg">your own Chrome</b> — where you’re already logged in.
          </div>
          {st && !ready && (
            <div className="mt-3 text-[13px] text-fg-2 space-y-1">
              <div>1. Install the <b className="text-fg">Claude</b> extension for Chrome.</div>
              <div>2. Open it once and sign in with the same Claude account.</div>
              <div>3. Keep Chrome open when you ask for browser work.</div>
              <div className="flex gap-2 pt-2">
                <Button size="sm" variant="primary" onClick={() => api.openExternal('https://claude.ai/chrome')}>Get the extension</Button>
                <Button size="sm" onClick={check}><RefreshCw size={13} /> Check again</Button>
              </div>
            </div>
          )}
        </div>
        <Toggle checked={!!settings?.chromeEnabled} onChange={(v) => updateSettings({ chromeEnabled: v })} label="Use my Chrome" />
      </div>
    </div>
  )
}

export function TelegramSection() {
  const { settings, updateSettings, toast } = useApp()
  const [st, setSt] = useState<TelegramStatus | null>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmOff, setConfirmOff] = useState(false)

  useEffect(() => {
    void api.telegramStatus().then(setSt)
    return api.onEvent((e) => e.type === 'telegram:status' && setSt(e.status))
  }, [])

  const connect = async () => {
    setBusy(true)
    setError(null)
    const r = await api.telegramConnect(token)
    setBusy(false)
    if (!r.ok) return setError(r.error)
    setSt(r.data)
    setToken('')
    toast('success', 'Your bot is connected. Now pair your phone.')
  }

  return (
    <>
      <SectionTitle title="Telegram" subtitle={`Message ${settings?.managerName ?? 'your Manager'} from your phone. Results and files come back to you in Telegram.`} />
      {!st ? (
        <div className="flex items-center gap-2 text-fg-2"><Loader2 className="animate-spin" size={16} /> Loading…</div>
      ) : !st.connected ? (
        <div className="rounded-2xl bg-sidebar border border-line p-5">
          <div className="font-semibold mb-3 flex items-center gap-2"><Send size={16} className="text-[#29a9eb]" /> Set up in 2 minutes</div>
          <ol className="space-y-3 text-[14px] text-fg-2 mb-5">
            <Step n={1}>Open Telegram on your phone and search for <b className="text-fg">@BotFather</b> (the official one, with a blue tick).</Step>
            <Step n={2}>Send it <code className="font-mono text-fg">/newbot</code>, then choose a name and a username for your bot (the username must end in “bot”).</Step>
            <Step n={3}>BotFather replies with a long <b className="text-fg">token</b> like <code className="font-mono">123456789:ABC-def…</code>. Copy it and paste it below.</Step>
          </ol>
          <div className="flex gap-2">
            <input type="password" className={inputCls} value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste your bot token here" />
            <Button variant="primary" disabled={!token.trim() || busy} onClick={connect}>{busy ? <Loader2 className="animate-spin" size={14} /> : null} Connect</Button>
          </div>
          {error && <div className="text-sm text-danger mt-2">{error}</div>}
          <div className="text-xs text-muted mt-3">The token is stored encrypted on this computer. agentCloud must be running for Telegram messages to be answered.</div>
        </div>
      ) : (
        <>
          <div className="rounded-2xl bg-sidebar border border-line p-4 mb-4 flex items-center gap-3">
            <span className="w-10 h-10 rounded-full bg-[#29a9eb] flex items-center justify-center shrink-0"><Send size={18} color="#fff" /></span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold flex items-center gap-2">
                @{st.botUsername}
                {st.error ? <Pill tone="danger">Problem</Pill> : st.running && settings?.telegramEnabled ? <Pill tone="success">Listening</Pill> : <Pill>Paused</Pill>}
              </div>
              <div className="text-[13px] text-fg-2">{st.error ?? (settings?.telegramEnabled ? 'Messages from your paired phone go straight to your Manager.' : 'Telegram is paused. Messages will not be answered.')}</div>
            </div>
            <Toggle checked={!!settings?.telegramEnabled} onChange={(v) => updateSettings({ telegramEnabled: v })} label="Telegram on" />
          </div>

          <div className="rounded-2xl bg-sidebar border border-line p-4 mb-4">
            <div className="font-semibold mb-1 flex items-center gap-2"><Smartphone size={16} /> Pair your phone</div>
            <div className="text-[13.5px] text-fg-2 mb-3">
              Open <a className="text-accent underline cursor-pointer" onClick={() => api.openExternal(`https://t.me/${st.botUsername}`)}>t.me/{st.botUsername}</a> on your phone, press <b className="text-fg">Start</b>, then send this code:
            </div>
            <div className="flex items-center gap-3">
              <motion.div key={st.pairingCode} initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="font-mono text-[28px] tracking-[0.3em] font-semibold bg-card border border-line rounded-xl px-4 py-2">
                {st.pairingCode}
              </motion.div>
              <Button size="sm" onClick={() => { void navigator.clipboard.writeText(st.pairingCode ?? ''); toast('success', 'Code copied.') }}><Copy size={13} /> Copy</Button>
              <Button size="sm" variant="ghost" onClick={async () => setSt(await api.telegramNewCode())}><RefreshCw size={13} /> New code</Button>
            </div>
            <div className="text-xs text-muted mt-3">Each code works once. Only paired phones can give orders — everyone else is politely turned away.</div>
          </div>

          <div className="rounded-2xl bg-sidebar border border-line p-4 mb-4">
            <div className="font-semibold mb-2">Paired phones</div>
            {st.chats.length === 0 ? (
              <div className="text-[13.5px] text-muted">None yet — send the code above from Telegram.</div>
            ) : (
              st.chats.map((c) => (
                <div key={c.id} className="flex items-center gap-3 py-2 border-b border-divider last:border-0">
                  <CheckCircle2 size={16} className="text-success" />
                  <span className="flex-1 text-[14px]">{c.name}</span>
                  <Button size="sm" variant="ghost" onClick={async () => setSt(await api.telegramUnlink(c.id))}><Unlink size={13} /> Unpair</Button>
                </div>
              ))
            )}
          </div>

          <div className="rounded-2xl bg-sidebar border border-line p-4 mb-4 text-[13.5px] text-fg-2">
            <div className="font-semibold text-fg mb-1.5">What you can do from Telegram</div>
            <ul className="space-y-1 list-disc pl-5">
              <li>Ask for anything, just like in the app. Each paired phone gets its own chat in the sidebar.</li>
              <li>Questions arrive as buttons — tap one, or type your own answer.</li>
              <li>Send photos or files and they’re saved to your workspace for the team.</li>
              <li>Finished files are sent back to you. Type <code className="font-mono text-fg">/stop</code> to stop all work, <code className="font-mono text-fg">/new</code> for a fresh chat.</li>
            </ul>
          </div>

          <Button variant="danger" size="sm" onClick={() => setConfirmOff(true)}><TriangleAlert size={13} /> Disconnect bot</Button>
          <Confirm open={confirmOff} title="Disconnect Telegram?" message="The bot will stop answering and all paired phones are removed. Your chats stay in agentCloud." confirmLabel="Disconnect" danger onClose={() => setConfirmOff(false)}
            onConfirm={async () => { await api.telegramDisconnect(); setSt(await api.telegramStatus()) }} />
        </>
      )}
    </>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={cx('w-6 h-6 rounded-full bg-accent-soft text-accent text-[12px] font-semibold flex items-center justify-center shrink-0')}>{n}</span>
      <span className="pt-0.5">{children}</span>
    </li>
  )
}
