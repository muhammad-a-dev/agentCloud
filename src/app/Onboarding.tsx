import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, FolderOpen, Sparkles, Users, ClipboardCheck, Check } from 'lucide-react'
import { useState } from 'react'
import { ManagerAvatar } from '@/components/Avatars'
import { AvatarPicker } from '@/components/AvatarPicker'
import { WindowControls } from '@/components/Chrome'
import { Button, Field, inputCls } from '@/components/ui'
import { cx } from '@/lib/format'
import { api } from '@/lib/ipc'
import { useApp } from '@/stores/app'
import { AuthPanel } from './Overlays'

const ROLES = ['Team Manager', 'Portfolio Manager', 'Project Lead', 'Chief of Staff', 'Personal Assistant']

export function Onboarding() {
  const settings = useApp((s) => s.settings)!
  const updateSettings = useApp((s) => s.updateSettings)
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  const [authOk, setAuthOk] = useState(false)
  const [workspace, setWorkspace] = useState<string | null>(settings.workspace)
  const [name, setName] = useState(settings.managerName)
  const [role, setRole] = useState(settings.managerRole)
  const [avatar, setAvatar] = useState(settings.managerAvatar)
  const [userName, setUserName] = useState(settings.userName)
  const [finishing, setFinishing] = useState(false)

  const go = (n: number) => {
    setDir(n > step ? 1 : -1)
    setStep(n)
  }
  const canNext = step === 0 || (step === 1 && authOk) || (step === 2 && !!workspace) || step === 3

  const finish = async () => {
    setFinishing(true)
    await updateSettings({ managerName: name.trim() || 'Drake', managerRole: role.trim() || 'Team Manager', managerAvatar: avatar, userName: userName.trim(), workspace, onboarded: true })
    const st = useApp.getState()
    await st.refreshAgents()
    await st.newChat()
    st.setTour(true)
  }

  return (
    <div className="h-full flex flex-col bg-bg">
      <div className="drag h-12 shrink-0 flex justify-end pr-2 pt-1"><WindowControls /></div>
      <div className="flex-1 flex items-center justify-center px-6 pb-10 overflow-y-auto">
        <div className="w-full max-w-[620px]">
          <div className="flex justify-center gap-2 mb-8">
            {[0, 1, 2, 3].map((i) => (
              <motion.span key={i} animate={{ width: i === step ? 24 : 8, backgroundColor: i <= step ? 'var(--accent)' : 'var(--border-strong)' }} className="h-2 rounded-full" />
            ))}
          </div>
          <div className="relative min-h-[440px]">
            <AnimatePresence mode="wait" custom={dir} initial={false}>
              <motion.div
                key={step}
                custom={dir}
                initial={{ opacity: 0, x: 40 * dir }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -40 * dir }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
              >
                {step === 0 && (
                  <div className="text-center">
                    <div className="flex justify-center mb-6"><ManagerAvatar avatar="drake" size={96} badge /></div>
                    <h1 className="text-[30px] font-semibold mb-3">Welcome to agentCloud</h1>
                    <p className="text-fg-2 text-[16px] max-w-[480px] mx-auto">
                      You chat with one friendly Manager, who builds a team of AI agents to do real work on your computer — research, documents, emails and more. You stay in charge; they report back in plain language.
                    </p>
                    <div className="grid grid-cols-3 gap-3 mt-9 text-left">
                      {[
                        { icon: Sparkles, t: 'Ask for anything', b: 'Just type what you need.' },
                        { icon: Users, t: 'A team does it', b: 'Agents work in parallel.' },
                        { icon: ClipboardCheck, t: 'Get a report', b: 'With links to every file.' }
                      ].map(({ icon: Icon, t, b }) => (
                        <div key={t} className="rounded-2xl bg-card border border-line p-4">
                          <Icon size={18} className="text-accent mb-2" />
                          <div className="font-semibold text-[14px]">{t}</div>
                          <div className="text-[13px] text-fg-2">{b}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {step === 1 && (
                  <div>
                    <h2 className="text-[24px] font-semibold mb-1">Connect to Claude</h2>
                    <p className="text-fg-2 mb-6">agentCloud uses Claude to think. Let's make sure it can reach your account.</p>
                    <AuthPanel onConnected={() => setAuthOk(true)} />
                  </div>
                )}
                {step === 2 && (
                  <div>
                    <h2 className="text-[24px] font-semibold mb-1">Choose a workspace folder</h2>
                    <p className="text-fg-2 mb-6">This is where your agents save and change files. They work only inside this folder, so pick one just for agentCloud.</p>
                    <div className="grid grid-cols-2 gap-3">
                      <motion.button whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} onClick={async () => setWorkspace(await api.createDefaultWorkspace())} className="text-left rounded-2xl border border-line bg-card hover:bg-card-hover p-4">
                        <Sparkles size={20} className="text-accent mb-3" />
                        <div className="font-semibold">Make one for me</div>
                        <div className="text-sm text-fg-2">Creates “agentCloud” in your Documents folder.</div>
                      </motion.button>
                      <motion.button whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} onClick={async () => { const p = await api.pickFolder(); if (p) setWorkspace(p) }} className="text-left rounded-2xl border border-line bg-card hover:bg-card-hover p-4">
                        <FolderOpen size={20} className="text-accent mb-3" />
                        <div className="font-semibold">Choose a folder</div>
                        <div className="text-sm text-fg-2">Pick any folder on your computer.</div>
                      </motion.button>
                    </div>
                    {workspace && (
                      <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-2xl border border-success/30 bg-success-soft p-3 flex items-center gap-2 text-sm">
                        <Check size={16} className="text-success" /> <span className="truncate">Workspace: <b>{workspace}</b></span>
                      </motion.div>
                    )}
                  </div>
                )}
                {step === 3 && (
                  <div>
                    <h2 className="text-[24px] font-semibold mb-1">Meet your Manager</h2>
                    <p className="text-fg-2 mb-6">Give them a name and a look. You can change this any time.</p>
                    <div className="flex items-center gap-4 mb-6">
                      <ManagerAvatar avatar={avatar} size={84} badge />
                      <div className="flex-1 max-h-[132px] overflow-y-auto pr-1">
                        <AvatarPicker value={avatar} onChange={setAvatar} size={40} onError={(m) => useApp.getState().toast('error', m)} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Manager's name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Drake" /></Field>
                      <Field label="Your name (optional)"><input className={inputCls} value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="What should they call you?" /></Field>
                    </div>
                    <Field label="Role">
                      <input className={inputCls} value={role} onChange={(e) => setRole(e.target.value)} />
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {ROLES.map((r) => (
                          <button key={r} onClick={() => setRole(r)} className={cx('text-xs px-2.5 h-7 rounded-full border', role === r ? 'border-accent text-accent bg-accent-soft' : 'border-line text-fg-2 hover:text-fg')}>{r}</button>
                        ))}
                      </div>
                    </Field>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="flex items-center justify-between mt-6">
            {step > 0 ? <Button variant="ghost" onClick={() => go(step - 1)}><ArrowLeft size={15} /> Back</Button> : <span />}
            <div className="flex items-center gap-3">
              {step === 1 && !authOk && <button className="text-sm text-muted hover:text-fg" onClick={() => go(2)}>I'll do this later</button>}
              {step < 3 ? (
                <Button variant="accent" disabled={!canNext} onClick={() => go(step + 1)}>{step === 0 ? "Let's get started" : 'Continue'} <ArrowRight size={15} /></Button>
              ) : (
                <Button variant="accent" disabled={finishing} onClick={finish}>Start chatting with {name || 'Drake'} <ArrowRight size={15} /></Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
