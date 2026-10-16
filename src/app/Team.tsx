import { AnimatePresence, motion } from 'framer-motion'
import { Copy, Download, MessageSquare, Pencil, Plus, Upload, UserMinus, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Agent, AgentTemplate, Capability, McpServerEntry, ModelChoice, SkillEntry } from '@shared/types'
import { AgentAvatar } from '@/components/Avatars'
import { Button, Confirm, EmptyState, Field, Modal, Pill, Toggle, inputCls } from '@/components/ui'
import { cx } from '@/lib/format'
import { api } from '@/lib/ipc'
import { useApp } from '@/stores/app'

export const CAPABILITIES: { key: Capability; label: string; hint: string }[] = [
  { key: 'read', label: 'Read files', hint: 'Open and search files in the workspace' },
  { key: 'write', label: 'Create and edit files', hint: 'Make new documents and change existing ones' },
  { key: 'commands', label: 'Run programs and commands', hint: 'Use the computer’s command line' },
  { key: 'web_search', label: 'Search the web', hint: 'Look things up online' },
  { key: 'web_fetch', label: 'Open web pages', hint: 'Read the content of websites' },
  { key: 'browser', label: 'Use your Chrome browser', hint: 'Click and type on websites where you’re logged in' },
  { key: 'skills', label: 'Use skills', hint: 'Special know-how packs you’ve installed' },
  { key: 'helpers', label: 'Bring in helpers', hint: 'Split big jobs across short-lived helpers' }
]

export const MODELS: { key: ModelChoice; label: string; hint: string }[] = [
  { key: 'smartest', label: 'Smartest', hint: 'Best for hard problems. Slower and costs more.' },
  { key: 'balanced', label: 'Balanced', hint: 'Great for most work.' },
  { key: 'fastest', label: 'Fastest', hint: 'Quick and cheap for simple jobs.' }
]

const EMOJIS = ['🤖', '🔎', '✍️', '💻', '✉️', '📊', '🎨', '📅', '🧠', '🛠️', '📚', '🚀']
const COLORS = ['#F7A51C', '#F97316', '#EAB308', '#FB923C', '#22C55E', '#3B82F6', '#A855F7', '#EC4899']

export function TeamPage() {
  const { agents, conversations, openConversation, toast } = useApp()
  const [editing, setEditing] = useState<Partial<Agent> | null>(null)
  const [templates, setTemplates] = useState<AgentTemplate[]>([])
  const [picking, setPicking] = useState(false)
  const [firing, setFiring] = useState<Agent | null>(null)
  const team = agents.filter((a) => !a.isManager)

  useEffect(() => {
    void api.agentsTemplates().then(setTemplates)
  }, [])

  const chat = async (a: Agent) => {
    const c = conversations.find((x) => x.agentId === a.id) ?? (await api.conversationsOpenForAgent(a.id))
    await useApp.getState().refreshConversations()
    await openConversation(c.id)
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 pb-8">
      <div className="max-w-[1100px] mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-[19px] font-semibold">Your team</div>
            <div className="text-sm text-fg-2">Agents your Manager can hand work to. You can also chat with any of them directly.</div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={async () => {
              const r = await api.agentsImport()
              if (!r.ok) toast('error', r.error)
              else if (r.data.length) toast('success', `Imported ${r.data.length} agent${r.data.length === 1 ? '' : 's'}.`)
            }}><Upload size={13} /> Import</Button>
            <Button size="sm" variant="primary" onClick={() => setPicking(true)}><Plus size={14} /> Hire an agent</Button>
          </div>
        </div>

        {team.length === 0 ? (
          <EmptyState icon={<Users size={36} />} title="No agents yet" body="Your Manager hires agents automatically when you ask for something. You can also hire one yourself from a template.">
            <Button variant="primary" onClick={() => setPicking(true)}><Plus size={14} /> Hire your first agent</Button>
          </EmptyState>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
            <AnimatePresence initial={false}>
              {team.map((a) => (
                <motion.div key={a.id} layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="rounded-2xl bg-card border border-line p-4 flex flex-col">
                  <div className="flex items-start gap-3">
                    <AgentAvatar avatar={a.avatar} color={a.color} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-[15px] truncate">{a.name}</div>
                      <div className="text-[13px] text-fg-2 line-clamp-2">{a.role}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <Pill tone={a.status === 'working' ? 'accent' : a.status === 'error' ? 'danger' : 'neutral'}>
                      {a.status === 'working' && <span className="w-1.5 h-1.5 rounded-full bg-accent dot-pulse" />}
                      {a.status === 'working' ? 'Working' : a.status === 'error' ? 'Error' : 'Idle'}
                    </Pill>
                    <span className="text-[12px] text-muted">{a.tasksDone ?? 0} task{a.tasksDone === 1 ? '' : 's'} done</span>
                    <span className="text-[12px] text-muted ml-auto">{MODELS.find((m) => m.key === a.model)?.label}</span>
                  </div>
                  <div className="flex gap-1.5 mt-4 pt-3 border-t border-line">
                    <Button size="sm" onClick={() => void chat(a)}><MessageSquare size={13} /> Chat</Button>
                    <Button size="sm" variant="ghost" aria-label="Edit" title="Edit" onClick={() => setEditing(a)}><Pencil size={13} /></Button>
                    <Button size="sm" variant="ghost" aria-label="Duplicate" title="Duplicate" onClick={async () => { await api.agentsDuplicate(a.id); toast('success', `Made a copy of ${a.name}.`) }}><Copy size={13} /></Button>
                    <Button size="sm" variant="ghost" aria-label="Export" title="Export as a Claude Code agent file" onClick={async () => { const p = await api.agentsExport(a.id); if (p) toast('success', `Saved to ${p}`) }}><Download size={13} /></Button>
                    <Button size="sm" variant="ghost" aria-label="Fire" title="Fire" className="ml-auto hover:!text-danger" onClick={() => setFiring(a)}><UserMinus size={13} /></Button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <Modal open={picking} onClose={() => setPicking(false)} title="Hire an agent" width={720}>
        <div className="text-sm text-fg-2 mb-4">Start from a template, then adjust anything you like.</div>
        <div className="grid grid-cols-3 gap-3">
          {templates.map((t) => (
            <motion.button key={t.key} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} onClick={() => { setPicking(false); setEditing({ ...t }) }} className="text-left rounded-2xl border border-line bg-card hover:bg-card-hover p-3.5">
              <AgentAvatar avatar={t.avatar} color={t.color} size={36} />
              <div className="font-semibold text-[14px] mt-2.5">{t.name}</div>
              <div className="text-[12.5px] text-fg-2">{t.role}</div>
            </motion.button>
          ))}
          <motion.button whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} onClick={() => { setPicking(false); setEditing({ name: '', role: '', avatar: 'blob', color: '#F7A51C', tools: ['read', 'write', 'web_search', 'web_fetch', 'skills'], model: 'balanced', instructions: '' }) }} className="text-left rounded-2xl border border-dashed border-line-strong hover:bg-card p-3.5">
            <div className="w-9 h-9 rounded-xl bg-card-hover flex items-center justify-center"><Plus size={18} /></div>
            <div className="font-semibold text-[14px] mt-2.5">Start from scratch</div>
            <div className="text-[12.5px] text-fg-2">Describe a brand new role.</div>
          </motion.button>
        </div>
      </Modal>

      <AgentEditor agent={editing} onClose={() => setEditing(null)} />
      <Confirm open={!!firing} title={`Fire ${firing?.name}?`} message="They'll leave the team and any work they're doing will stop. Their past tasks stay on the board." confirmLabel="Fire" danger onClose={() => setFiring(null)}
        onConfirm={async () => { if (firing) { await api.agentsDelete(firing.id); toast('info', `${firing.name} has left the team.`) } }} />
    </div>
  )
}

export function AgentEditor({ agent, onClose }: { agent: Partial<Agent> | null; onClose: () => void }) {
  const toast = useApp((s) => s.toast)
  const [a, setA] = useState<Partial<Agent>>({})
  const [servers, setServers] = useState<McpServerEntry[]>([])
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!agent) return
    setA({ tools: [], mcp: [], skills: [], model: 'balanced', avatar: 'blob', color: '#F7A51C', ...agent })
    void api.mcpList().then(setServers)
    void api.skillsList().then(setSkills)
  }, [agent])
  const set = <K extends keyof Agent>(k: K, v: Agent[K]) => setA((x) => ({ ...x, [k]: v }))
  const toggleIn = (k: 'tools' | 'mcp' | 'skills', v: string) => {
    const list = (a[k] as string[] | undefined) ?? []
    set(k, (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]) as never)
  }
  const isNew = !agent?.id
  return (
    <Modal open={!!agent} onClose={onClose} title={isNew ? 'Hire an agent' : `Edit ${agent?.name}`} width={680} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!a.name?.trim() || saving} onClick={async () => {
          setSaving(true)
          try {
            await api.agentsSave({ ...a, name: a.name!.trim() } as Agent)
            toast('success', isNew ? `${a.name} joined your team.` : 'Saved.')
            onClose()
          } finally {
            setSaving(false)
          }
        }}>{isNew ? 'Hire' : 'Save'}</Button>
      </>
    }>
      <div className="flex gap-4 mb-2">
        <div className="shrink-0">
          <AgentAvatar avatar={a.avatar ?? 'blob'} color={a.color ?? '#F7A51C'} size={64} />
        </div>
        <div className="flex-1 grid grid-cols-2 gap-x-4">
          <Field label="Name"><input className={inputCls} value={a.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Research Agent" /></Field>
          <Field label="Role"><input className={inputCls} value={a.role ?? ''} onChange={(e) => set('role', e.target.value)} placeholder="One line about what they do" /></Field>
        </div>
      </div>
      <Field label="Look">
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => set('avatar', 'blob')} className={cx('rounded-lg p-0.5 border-2', a.avatar === 'blob' ? 'border-accent' : 'border-transparent')}><AgentAvatar avatar="blob" color={a.color ?? '#F7A51C'} size={30} /></button>
          {EMOJIS.map((e) => (
            <button key={e} onClick={() => set('avatar', e)} className={cx('w-[34px] h-[34px] rounded-lg text-[18px] border-2', a.avatar === e ? 'border-accent bg-card-hover' : 'border-transparent hover:bg-card')}>{e}</button>
          ))}
          <span className="w-px h-6 bg-line mx-1" />
          {COLORS.map((c) => (
            <button key={c} aria-label={`Color ${c}`} onClick={() => set('color', c)} className={cx('w-6 h-6 rounded-full border-2', a.color === c ? 'border-white' : 'border-transparent')} style={{ background: c }} />
          ))}
        </div>
      </Field>
      <Field label="What should this agent do?" hint="Describe how they should work, what good results look like, and anything to avoid.">
        <textarea className={cx(inputCls, 'min-h-[120px] resize-y')} value={a.instructions ?? ''} onChange={(e) => set('instructions', e.target.value)} />
      </Field>
      <Field label="Which tools can it use?">
        <div className="grid grid-cols-2 gap-2">
          {CAPABILITIES.map((c) => {
            const on = a.tools?.includes(c.key) ?? false
            return (
              <button key={c.key} onClick={() => toggleIn('tools', c.key)} className={cx('text-left rounded-xl border px-3 py-2 flex items-start gap-2.5 transition', on ? 'border-accent/50 bg-accent-soft' : 'border-line hover:bg-card')}>
                <span className={cx('mt-0.5 w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0', on ? 'bg-accent border-accent text-accent-text' : 'border-line-strong')}>{on && '✓'}</span>
                <span>
                  <span className="block text-[13.5px] font-medium">{c.label}</span>
                  <span className="block text-[12px] text-fg-2">{c.hint}</span>
                </span>
              </button>
            )
          })}
        </div>
      </Field>
      <Field label="Model">
        <div className="grid grid-cols-3 gap-2">
          {MODELS.map((m) => (
            <button key={m.key} onClick={() => set('model', m.key)} className={cx('text-left rounded-xl border px-3 py-2', a.model === m.key ? 'border-accent/60 bg-accent-soft' : 'border-line hover:bg-card')}>
              <div className="text-[13.5px] font-semibold">{m.label}</div>
              <div className="text-[12px] text-fg-2">{m.hint}</div>
            </button>
          ))}
        </div>
      </Field>
      <Field label="Connections it can use" hint={<>Leave all off to allow every connection. <span className="text-muted">(MCP servers)</span></>}>
        {servers.length === 0 ? <div className="text-[13px] text-muted">No connections yet — add them under Connect apps.</div> : (
          <div className="flex flex-wrap gap-2">
            {servers.map((s) => (
              <label key={`${s.scope}-${s.name}`} className="flex items-center gap-2 text-[13px] border border-line rounded-full pl-3 pr-1.5 h-8">
                {s.name}
                <Toggle checked={a.mcp?.includes(s.name) ?? false} onChange={() => toggleIn('mcp', s.name)} label={s.name} />
              </label>
            ))}
          </div>
        )}
      </Field>
      <Field label="Skills it can use" hint="Leave all off to allow every enabled skill.">
        {skills.length === 0 ? <div className="text-[13px] text-muted">No skills installed yet.</div> : (
          <div className="flex flex-wrap gap-1.5 max-h-[130px] overflow-y-auto">
            {skills.map((s) => {
              const on = a.skills?.includes(s.name) ?? false
              return (
                <button key={s.path} title={s.description} onClick={() => toggleIn('skills', s.name)} className={cx('text-[12.5px] px-2.5 h-7 rounded-full border', on ? 'border-accent text-accent bg-accent-soft' : 'border-line text-fg-2 hover:text-fg')}>{s.name}</button>
              )
            })}
          </div>
        )}
      </Field>
    </Modal>
  )
}
