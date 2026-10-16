import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity, Bot, ChevronDown, Cog, FolderOpen, KeyRound, Loader2, Plug, Plus, Puzzle, RefreshCw, Shield, Sparkles, Trash2, Wrench,
  GitBranch, Send, Globe, HardDrive, Mail, FileText, MessageCircle, Brain, MonitorSmartphone, Link2, Copy, Pencil, Download, Upload, Compass
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { McpServerEntry, PluginEntry, SkillEntry, UsageSummary } from '@shared/types'
import { AgentAvatar, ManagerAvatar, UserAvatar } from '@/components/Avatars'
import { AvatarPicker } from '@/components/AvatarPicker'
import { Button, Confirm, Field, Modal, Pill, SectionTitle, Skeleton, Toggle, inputCls } from '@/components/ui'
import { compact, cx, initials, money } from '@/lib/format'
import { api } from '@/lib/ipc'
import { useApp, type SettingsSection } from '@/stores/app'
import { AuthPanel } from './Overlays'
import { ChromeCard, TelegramSection } from './SettingsChannels'
import { AgentEditor } from './Team'
import type { Agent } from '@shared/types'

const NAV: { key: SettingsSection; label: string; icon: typeof Cog; technical?: string }[] = [
  { key: 'general', label: 'General', icon: Cog },
  { key: 'connections', label: 'Connections', icon: Plug, technical: 'MCP servers' },
  { key: 'telegram', label: 'Telegram', icon: Send },
  { key: 'skills', label: 'Skills', icon: Sparkles },
  { key: 'plugins', label: 'Plugins', icon: Puzzle },
  { key: 'agents', label: 'Agents', icon: Bot },
  { key: 'permissions', label: 'Permissions', icon: Shield },
  { key: 'account', label: 'Account & usage', icon: Activity },
  { key: 'advanced', label: 'Advanced', icon: Wrench }
]

export function SettingsPage() {
  const section = useApp((s) => s.settingsSection)
  const openSettings = useApp((s) => s.openSettings)
  return (
    <div className="flex-1 min-h-0 flex px-6 pb-6 gap-6">
      <nav className="w-[210px] shrink-0 space-y-0.5">
        {NAV.map((n) => (
          <button key={n.key} onClick={() => openSettings(n.key)} className={cx('w-full flex items-center gap-2.5 px-3 h-10 rounded-xl text-[14px] text-left transition relative', section === n.key ? 'text-fg' : 'text-fg-2 hover:text-fg hover:bg-card/60')}>
            {section === n.key && <motion.span layoutId="settings-nav" className="absolute inset-0 rounded-xl bg-card" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
            <n.icon size={16} className="relative" />
            <span className="relative">{n.label}</span>
          </button>
        ))}
      </nav>
      <div className="flex-1 min-w-0 overflow-y-auto pr-1">
        <AnimatePresence mode="wait">
          <motion.div key={section} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }} className="max-w-[820px]">
            {section === 'general' && <General />}
            {section === 'connections' && <Connections />}
            {section === 'telegram' && <TelegramSection />}
            {section === 'skills' && <Skills />}
            {section === 'plugins' && <Plugins />}
            {section === 'agents' && <AgentsTable />}
            {section === 'permissions' && <Permissions />}
            {section === 'account' && <Account />}
            {section === 'advanced' && <Advanced />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-2xl bg-sidebar border border-line p-4 mb-4', className)}>{children}</div>
}

function Row({ title, body, children }: { title: string; body?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-3 border-b border-divider last:border-0">
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium">{title}</div>
        {body && <div className="text-[13px] text-fg-2">{body}</div>}
      </div>
      {children}
    </div>
  )
}

/** Text field that saves on blur. */
function SavedInput({ value, onSave, placeholder, multiline }: { value: string; onSave: (v: string) => void; placeholder?: string; multiline?: boolean }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const props = { value: v, placeholder, onChange: (e: { target: { value: string } }) => setV(e.target.value), onBlur: () => v !== value && onSave(v) }
  return multiline ? <textarea {...props} className={cx(inputCls, 'min-h-[80px] resize-y')} /> : <input {...props} className={inputCls} />
}

// ---------------------------------------------------------------- general

function General() {
  const { settings, updateSettings, toast, setTour, setRoute } = useApp()
  if (!settings) return null
  return (
    <>
      <SectionTitle title="General" subtitle="Your Manager, your workspace and how agentCloud looks." />
      <Card>
        <div className="flex items-center gap-4 mb-4">
          <ManagerAvatar avatar={settings.managerAvatar} size={64} badge />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] text-fg-2 mb-1.5">Manager's look — pick one or upload a picture</div>
            <AvatarPicker value={settings.managerAvatar} onChange={(v) => updateSettings({ managerAvatar: v })} size={36} onError={(m) => toast('error', m)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          <Field label="Manager's name"><SavedInput value={settings.managerName} onSave={(v) => updateSettings({ managerName: v.trim() || 'Drake' })} /></Field>
          <Field label="Manager's role"><SavedInput value={settings.managerRole} onSave={(v) => updateSettings({ managerRole: v.trim() || 'Team Manager' })} /></Field>
        </div>
        <Field label="Personality" hint="How should your Manager talk to you?"><SavedInput multiline value={settings.managerPersona} onSave={(v) => updateSettings({ managerPersona: v })} /></Field>
        <Field label="Your name"><SavedInput value={settings.userName} onSave={(v) => updateSettings({ userName: v.trim() })} placeholder="What should agents call you?" /></Field>
        <Field label="Your picture" hint="Shown at the bottom of the sidebar.">
          <div className="flex items-center gap-4">
            <UserAvatar name={settings.userName || 'Me'} avatar={settings.userAvatar} size={56} />
            <div className="flex-1 min-w-0">
              <AvatarPicker value={settings.userAvatar} onChange={(v) => updateSettings({ userAvatar: v })} size={32} allowNone={initials(settings.userName || 'Me')} onError={(m) => toast('error', m)} />
            </div>
          </div>
        </Field>
      </Card>
      <Card>
        <WorkspaceRow />
        <Row title="Theme" body="Dark is easiest on the eyes; light is great in bright rooms.">
          <div className="flex bg-card border border-line rounded-full p-0.5">
            {(['dark', 'light'] as const).map((t) => (
              <button key={t} onClick={() => updateSettings({ theme: t })} className={cx('h-8 px-3 rounded-full text-[13px] capitalize', settings.theme === t ? 'bg-card-hover text-fg' : 'text-fg-2')}>{t}</button>
            ))}
          </div>
        </Row>
        <Row title="Launch when your computer starts"><Toggle checked={settings.launchOnStartup} onChange={(v) => updateSettings({ launchOnStartup: v })} label="Launch on startup" /></Row>
        <Row title="Notifications" body="Get a desktop notification when a task finishes or needs you."><Toggle checked={settings.notifications} onChange={(v) => updateSettings({ notifications: v })} label="Notifications" /></Row>
        <Row title="Guided tour" body="See the quick walkthrough again.">
          <Button size="sm" onClick={() => { setRoute('chat'); setTimeout(() => setTour(true), 250); toast('info', 'Starting the tour…') }}><Compass size={13} /> Replay tour</Button>
        </Row>
      </Card>
    </>
  )
}

function WorkspaceRow() {
  const { settings, updateSettings, toast } = useApp()
  return (
    <Row title="Workspace folder" body={<span className="break-all">{settings?.workspace ?? 'Not chosen yet'}</span>}>
      <div className="flex gap-2 shrink-0">
        {settings?.workspace && <Button size="sm" variant="ghost" onClick={() => api.openPath(settings.workspace!)}><FolderOpen size={13} /> Open</Button>}
        <Button size="sm" onClick={async () => {
          const p = await api.pickFolder()
          if (p) {
            await updateSettings({ workspace: p })
            toast('success', 'Workspace folder changed.')
          }
        }}>Change</Button>
      </div>
    </Row>
  )
}

// ---------------------------------------------------------------- connections

interface GalleryItem {
  key: string
  name: string
  icon: typeof GitBranch
  color: string
  blurb: string
  fields: { key: string; label: string; placeholder?: string; secret?: boolean; folder?: boolean; hint?: string }[]
  build: (v: Record<string, string>) => Record<string, unknown>
}

const GALLERY: GalleryItem[] = [
  {
    key: 'github', name: 'GitHub', icon: GitBranch, color: '#24292f', blurb: 'Issues, pull requests and code.',
    fields: [{ key: 'token', label: 'Personal access token', secret: true, hint: 'Create one at github.com → Settings → Developer settings → Tokens.' }],
    build: (v) => ({ type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: `Bearer ${v.token}` } })
  },
  {
    key: 'notion', name: 'Notion', icon: FileText, color: '#ffffff', blurb: 'Pages and databases. You’ll sign in the first time it’s used.',
    fields: [], build: () => ({ type: 'http', url: 'https://mcp.notion.com/mcp' })
  },
  {
    key: 'gmail', name: 'Gmail', icon: Mail, color: '#EA4335', blurb: 'Read and draft email through your email connector’s link.',
    fields: [{ key: 'url', label: 'Connector URL', placeholder: 'https://…', hint: 'Paste the MCP link from your Gmail connector provider.' }],
    build: (v) => ({ type: 'http', url: v.url })
  },
  {
    key: 'filesystem', name: 'Filesystem', icon: HardDrive, color: '#64748b', blurb: 'Give agents access to another folder.',
    fields: [{ key: 'folder', label: 'Folder', folder: true }],
    build: (v) => ({ type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', v.folder] })
  },
  {
    key: 'brave-search', name: 'Web search (Brave)', icon: Globe, color: '#FB542B', blurb: 'Extra web search with a Brave key.',
    fields: [{ key: 'key', label: 'Brave Search API key', secret: true }],
    build: (v) => ({ type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'], env: { BRAVE_API_KEY: v.key } })
  },
  {
    key: 'slack', name: 'Slack', icon: MessageCircle, color: '#4A154B', blurb: 'Read channels and post messages.',
    fields: [{ key: 'token', label: 'Bot token', secret: true, placeholder: 'xoxb-…' }, { key: 'team', label: 'Team ID', placeholder: 'T0123…' }],
    build: (v) => ({ type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'], env: { SLACK_BOT_TOKEN: v.token, SLACK_TEAM_ID: v.team } })
  },
  {
    key: 'memory', name: 'Memory', icon: Brain, color: '#8b5cf6', blurb: 'Lets agents remember facts between tasks.',
    fields: [], build: () => ({ type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] })
  },
  {
    key: 'browser', name: 'Web browser', icon: MonitorSmartphone, color: '#2ea44f', blurb: 'Agents can click around real websites.',
    fields: [], build: () => ({ type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'] })
  }
]

/** Hide tokens and keys when showing a connection's command line. */
function maskSecrets(text: string): string {
  return text
    .replace(/(--?[\w-]*(?:token|key|secret|password)[\w-]*[ =])(\S+)/gi, (_, flag) => `${flag}••••••`)
    .replace(/(sk-|sbp_|ghp_|gho_|github_pat_|xox[abpr]-|eyJ)[\w.-]{6,}/g, (m) => `${m.slice(0, 4)}••••••`)
}

function StatusDot({ status }: { status?: McpServerEntry['status'] }) {
  const c = status === 'connected' ? 'bg-success' : status === 'error' ? 'bg-danger' : status === 'testing' ? 'bg-accent dot-pulse' : 'bg-line-strong'
  return <span className={cx('w-2.5 h-2.5 rounded-full shrink-0', c)} />
}

function Connections() {
  const toast = useApp((s) => s.toast)
  const [list, setList] = useState<McpServerEntry[] | null>(null)
  const [results, setResults] = useState<Record<string, { status: McpServerEntry['status']; message?: string; details?: string }>>({})
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<McpServerEntry | null>(null)
  const [removing, setRemoving] = useState<McpServerEntry | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const load = async () => setList(await api.mcpList())
  useEffect(() => {
    void load()
  }, [])
  const test = async (s: McpServerEntry) => {
    const k = `${s.scope}:${s.name}`
    setResults((r) => ({ ...r, [k]: { status: 'testing' } }))
    const r = await api.mcpTest(s.name, s.config)
    setResults((x) => ({ ...x, [k]: { status: r.ok ? 'connected' : 'error', message: r.message, details: r.details } }))
  }
  return (
    <>
      <SectionTitle title="Connections" technical="MCP servers" subtitle="Apps and services your agents can use. Shared with Claude Code on this computer." right={<Button size="sm" variant="primary" onClick={() => setAdding(true)}><Plus size={14} /> Add connection</Button>} />
      <ChromeCard />
      {!list ? (
        <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
      ) : list.length === 0 ? (
        <Card className="text-center py-10">
          <Plug className="mx-auto text-accent mb-3" size={30} />
          <div className="font-semibold mb-1">No connections yet</div>
          <div className="text-sm text-fg-2 mb-4">Connect GitHub, Notion, Gmail and more so your agents can work with them.</div>
          <Button variant="primary" onClick={() => setAdding(true)}><Plus size={14} /> Add your first connection</Button>
        </Card>
      ) : (
        <div className="space-y-2">
          {list.map((s) => {
            const k = `${s.scope}:${s.name}`
            const r = results[k]
            return (
              <div key={k} className="rounded-2xl bg-sidebar border border-line px-4 py-3">
                <div className="flex items-center gap-3">
                  <StatusDot status={r?.status} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-[14.5px] flex items-center gap-2">{s.name} <Pill>{s.scope === 'user' ? 'Everywhere' : 'This workspace'}</Pill></div>
                    <div className="text-[12.5px] text-muted truncate">{maskSecrets(String(s.config.url ?? [s.config.command, ...((s.config.args as string[]) ?? [])].join(' ')))}</div>
                  </div>
                  <Button size="sm" onClick={() => test(s)} disabled={r?.status === 'testing'}>{r?.status === 'testing' ? <Loader2 className="animate-spin" size={13} /> : <RefreshCw size={13} />} {r ? 'Test again' : 'Test connection'}</Button>
                  <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => setEditing(s)}><Pencil size={13} /></Button>
                  <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => setRemoving(s)}><Trash2 size={13} /></Button>
                </div>
                {r && r.status !== 'testing' && (
                  <div className={cx('mt-2 text-[13px] pl-[22px]', r.status === 'connected' ? 'text-success' : 'text-danger')}>
                    {r.message}
                    {r.details && (
                      <button className="ml-2 text-muted hover:text-fg text-xs" onClick={() => setExpanded(expanded === k ? null : k)}>{expanded === k ? 'Hide details' : 'Show details'}</button>
                    )}
                    {expanded === k && r.details && <pre className="mt-2 text-[11.5px] font-mono bg-black/40 rounded-lg p-2 whitespace-pre-wrap text-fg-2">{r.details}</pre>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      <AddConnection open={adding || !!editing} existing={editing} onClose={() => { setAdding(false); setEditing(null) }} onSaved={() => { void load(); toast('success', 'Connection saved.') }} />
      <Confirm open={!!removing} title={`Remove ${removing?.name}?`} message="Agents won't be able to use this app anymore. This also removes it from Claude Code." confirmLabel="Remove" danger onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          const r = await api.mcpRemove(removing.name, removing.scope === 'project' ? 'project' : 'user')
          if (!r.ok) toast('error', r.error)
          void load()
        }} />
    </>
  )
}

function AddConnection({ open, existing, onClose, onSaved }: { open: boolean; existing: McpServerEntry | null; onClose: () => void; onSaved: () => void }) {
  const toast = useApp((s) => s.toast)
  const [mode, setMode] = useState<'easy' | 'advanced'>('easy')
  const [pick, setPick] = useState<GalleryItem | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [name, setName] = useState('')
  const [scope, setScope] = useState<'user' | 'project'>('user')
  const [kind, setKind] = useState<'stdio' | 'http' | 'sse'>('stdio')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [env, setEnv] = useState('')
  const [url, setUrl] = useState('')
  const [json, setJson] = useState('')
  const [showJson, setShowJson] = useState(false)
  const [testing, setTesting] = useState<{ ok: boolean; message: string; details?: string } | 'running' | null>(null)

  useEffect(() => {
    if (!open) return
    setPick(null)
    setValues({})
    setTesting(null)
    setShowJson(false)
    if (existing) {
      setMode('advanced')
      setName(existing.name)
      setScope(existing.scope === 'project' ? 'project' : 'user')
      loadConfig(existing.config)
    } else {
      setMode('easy')
      setName('')
      setScope('user')
      setKind('stdio'); setCommand(''); setArgs(''); setEnv(''); setUrl('')
    }
  }, [open, existing])

  const loadConfig = (c: Record<string, unknown>) => {
    const t = (c.type as string) ?? (c.url ? 'http' : 'stdio')
    setKind(t === 'sse' ? 'sse' : t === 'http' ? 'http' : 'stdio')
    setCommand(String(c.command ?? ''))
    setArgs(((c.args as string[]) ?? []).join('\n'))
    setEnv(Object.entries((c.env as Record<string, string>) ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'))
    setUrl(String(c.url ?? ''))
    setJson(JSON.stringify(c, null, 2))
  }

  const advancedConfig = (): Record<string, unknown> => {
    if (showJson) return JSON.parse(json)
    if (kind === 'stdio') {
      const envObj = Object.fromEntries(env.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
      return { type: 'stdio', command: command.trim(), args: args.split('\n').map((a) => a.trim()).filter(Boolean), ...(Object.keys(envObj).length ? { env: envObj } : {}) }
    }
    return { type: kind, url: url.trim() }
  }

  const current = (): { name: string; config: Record<string, unknown> } | null => {
    try {
      if (mode === 'easy') {
        if (!pick) return null
        if (pick.fields.some((f) => !values[f.key]?.trim())) return null
        return { name: name.trim() || pick.key, config: pick.build(values) }
      }
      if (!name.trim()) return null
      return { name: name.trim(), config: advancedConfig() }
    } catch {
      return null
    }
  }
  const c = current()

  return (
    <Modal open={open} onClose={onClose} title={existing ? `Edit ${existing.name}` : 'Add a connection'} width={680} footer={
      <>
        {c && <Button variant="ghost" onClick={async () => { setTesting('running'); setTesting(await api.mcpTest(c.name, c.config)) }} disabled={testing === 'running'}>{testing === 'running' ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />} Test connection</Button>}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!c} onClick={async () => {
          if (!c) return
          if (existing && existing.name !== c.name) await api.mcpRemove(existing.name, existing.scope === 'project' ? 'project' : 'user')
          const r = await api.mcpSave(c.name, c.config, scope)
          if (!r.ok) return toast('error', r.error)
          onSaved()
          onClose()
        }}>Save</Button>
      </>
    }>
      {!existing && (
        <div className="flex bg-card border border-line rounded-full p-0.5 w-fit mb-4">
          {(['easy', 'advanced'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={cx('h-8 px-4 rounded-full text-[13px]', mode === m ? 'bg-card-hover text-fg' : 'text-fg-2')}>{m === 'easy' ? 'Pick an app' : 'Advanced'}</button>
          ))}
        </div>
      )}
      {mode === 'easy' ? (
        !pick ? (
          <div className="grid grid-cols-2 gap-2">
            {GALLERY.map((g) => (
              <motion.button key={g.key} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} onClick={() => { setPick(g); setName(g.key) }} className="flex items-start gap-3 text-left rounded-xl border border-line bg-card hover:bg-card-hover p-3">
                <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: g.color }}><g.icon size={18} color={g.color === '#ffffff' ? '#111' : '#fff'} /></span>
                <span><span className="block font-semibold text-[14px]">{g.name}</span><span className="block text-[12.5px] text-fg-2">{g.blurb}</span></span>
              </motion.button>
            ))}
            <motion.button whileHover={{ y: -2 }} onClick={() => setMode('advanced')} className="flex items-start gap-3 text-left rounded-xl border border-dashed border-line-strong hover:bg-card p-3">
              <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-card-hover"><Link2 size={18} /></span>
              <span><span className="block font-semibold text-[14px]">Something else</span><span className="block text-[12.5px] text-fg-2">Enter the details yourself.</span></span>
            </motion.button>
          </div>
        ) : (
          <div>
            <button className="text-sm text-muted hover:text-fg mb-3" onClick={() => setPick(null)}>← All apps</button>
            <div className="flex items-center gap-3 mb-4">
              <span className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: pick.color }}><pick.icon size={20} color={pick.color === '#ffffff' ? '#111' : '#fff'} /></span>
              <div><div className="font-semibold">{pick.name}</div><div className="text-[13px] text-fg-2">{pick.blurb}</div></div>
            </div>
            {pick.fields.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint}>
                {f.folder ? (
                  <div className="flex gap-2">
                    <input className={inputCls} readOnly value={values[f.key] ?? ''} placeholder="No folder chosen" />
                    <Button onClick={async () => { const p = await api.pickFolder(); if (p) setValues((v) => ({ ...v, [f.key]: p })) }}>Choose</Button>
                  </div>
                ) : (
                  <input className={inputCls} type={f.secret ? 'password' : 'text'} placeholder={f.placeholder} value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
                )}
              </Field>
            ))}
            {pick.fields.length === 0 && <div className="text-sm text-fg-2 mb-4">Nothing to fill in — just save.</div>}
            {pick.build(values).command === 'npx' && <div className="text-xs text-muted mb-3">This connection needs Node.js installed on your computer.</div>}
          </div>
        )
      ) : (
        <div>
          <div className="grid grid-cols-2 gap-x-4">
            <Field label="Name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="my-server" /></Field>
            <Field label="Type">
              <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} disabled={showJson}>
                <option value="stdio">Program on this computer (command)</option>
                <option value="http">Remote server (URL)</option>
                <option value="sse">Remote server (SSE URL)</option>
              </select>
            </Field>
          </div>
          <button className="text-xs text-muted hover:text-fg mb-3 flex items-center gap-1" onClick={() => {
            if (!showJson) { try { setJson(JSON.stringify(advancedConfig(), null, 2)) } catch { /* keep */ } }
            else { try { loadConfig(JSON.parse(json)) } catch { return toast('error', 'That JSON isn’t valid.') } }
            setShowJson(!showJson)
          }}><ChevronDown size={12} className={cx(showJson && 'rotate-180')} /> {showJson ? 'Back to form' : 'Edit as JSON'}</button>
          {showJson ? (
            <textarea className={cx(inputCls, 'font-mono text-[12.5px] min-h-[200px]')} value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
          ) : kind === 'stdio' ? (
            <>
              <Field label="Command"><input className={inputCls} value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" /></Field>
              <Field label="Arguments" hint="One per line."><textarea className={cx(inputCls, 'font-mono text-[12.5px] min-h-[70px]')} value={args} onChange={(e) => setArgs(e.target.value)} placeholder={'-y\n@modelcontextprotocol/server-memory'} /></Field>
              <Field label="Environment variables" hint="One per line, like KEY=value."><textarea className={cx(inputCls, 'font-mono text-[12.5px] min-h-[60px]')} value={env} onChange={(e) => setEnv(e.target.value)} /></Field>
            </>
          ) : (
            <Field label="URL"><input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" /></Field>
          )}
        </div>
      )}
      {(mode === 'advanced' || pick) && (
        <Field label="Available in">
          <div className="flex bg-card border border-line rounded-full p-0.5 w-fit">
            <button onClick={() => setScope('user')} className={cx('h-8 px-3 rounded-full text-[13px]', scope === 'user' ? 'bg-card-hover text-fg' : 'text-fg-2')}>Everywhere <span className="text-muted">(user)</span></button>
            <button onClick={() => setScope('project')} className={cx('h-8 px-3 rounded-full text-[13px]', scope === 'project' ? 'bg-card-hover text-fg' : 'text-fg-2')}>This workspace <span className="text-muted">(project)</span></button>
          </div>
        </Field>
      )}
      {testing && testing !== 'running' && (
        <div className={cx('rounded-xl p-3 text-sm border', testing.ok ? 'bg-success-soft border-success/30 text-success' : 'bg-danger-soft border-danger/30 text-danger')}>
          {testing.message}
          {testing.details && <pre className="mt-2 text-[11.5px] font-mono whitespace-pre-wrap text-fg-2">{testing.details}</pre>}
        </div>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------- skills

function Skills() {
  const toast = useApp((s) => s.toast)
  const [list, setList] = useState<SkillEntry[] | null>(null)
  const [removing, setRemoving] = useState<SkillEntry | null>(null)
  const [scope, setScope] = useState<'user' | 'project'>('user')
  const [q, setQ] = useState('')
  const load = async () => setList(await api.skillsList())
  useEffect(() => {
    void load()
  }, [])
  const add = async (zip: boolean) => {
    const src = zip ? await api.pickFile([{ name: 'Zip file', extensions: ['zip'] }]) : await api.pickFolder()
    if (!src) return
    const r = await api.skillsAdd(src, scope)
    if (!r.ok) toast('error', r.error)
    else toast('success', 'Skill added.')
    void load()
  }
  const shown = (list ?? []).filter((s) => !q || `${s.name} ${s.description}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <SectionTitle title="Skills" subtitle="Know-how packs that teach your agents how to do specific things." right={
        <div className="flex gap-2 items-center">
          <select aria-label="Install for" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} className="h-8 bg-input border border-line rounded-full px-2.5 text-[13px] outline-none">
            <option value="user">For everything</option>
            <option value="project">This workspace only</option>
          </select>
          <Button size="sm" onClick={() => add(false)}><FolderOpen size={13} /> Add folder</Button>
          <Button size="sm" onClick={() => add(true)}><Upload size={13} /> Add zip</Button>
        </div>
      } />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search skills" className={cx(inputCls, 'mb-3 rounded-full')} />
      {!list ? <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div> : shown.length === 0 ? (
        <Card className="text-center py-10 text-sm text-fg-2">{list.length ? 'No skills match.' : 'No skills installed yet. Add a skill folder (with a SKILL.md file) or a zip.'}</Card>
      ) : (
        <div className="rounded-2xl border border-line divide-y divide-divider overflow-hidden">
          {shown.map((s) => (
            <div key={s.path} className="flex items-center gap-3 px-4 py-2.5 bg-sidebar">
              <Sparkles size={15} className="text-accent shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium flex items-center gap-2">{s.name} <span className="text-[11px] text-muted">{s.scope === 'user' ? 'everywhere' : 'workspace'}</span></div>
                <div className="text-[12.5px] text-fg-2 line-clamp-1">{s.description}</div>
              </div>
              <Toggle checked={s.enabled} onChange={async (v) => { await api.skillsToggle(s.name, v); void load() }} label={`Enable ${s.name}`} />
              <Button size="sm" variant="ghost" aria-label="Open folder" onClick={() => api.openPath(s.path)}><FolderOpen size={13} /></Button>
              <Button size="sm" variant="ghost" aria-label="Delete" onClick={() => setRemoving(s)}><Trash2 size={13} /></Button>
            </div>
          ))}
        </div>
      )}
      <Confirm open={!!removing} title={`Delete the ${removing?.name} skill?`} message="Its folder will be deleted from your computer. This can't be undone." confirmLabel="Delete" danger onClose={() => setRemoving(null)}
        onConfirm={async () => { if (!removing) return; const r = await api.skillsRemove(removing.path); if (!r.ok) toast('error', r.error); void load() }} />
    </>
  )
}

// ---------------------------------------------------------------- plugins

function Plugins() {
  const toast = useApp((s) => s.toast)
  const [list, setList] = useState<PluginEntry[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const [source, setSource] = useState('')
  const [plugin, setPlugin] = useState('')
  const [removing, setRemoving] = useState<PluginEntry | null>(null)
  const load = async () => setList(await api.pluginsList())
  useEffect(() => {
    void load()
  }, [])
  return (
    <>
      <SectionTitle title="Plugins" subtitle="Bundles of skills, agents and connections from Claude Code marketplaces." right={
        <div className="flex gap-2">
          <Button size="sm" onClick={async () => { const p = await api.pickFolder(); if (!p) return; const r = await api.pluginsInstallLocal(p); if (!r.ok) toast('error', r.error); else toast('success', 'Plugin added.'); void load() }}><FolderOpen size={13} /> From a folder</Button>
          <Button size="sm" variant="primary" onClick={() => setInstalling(true)}><Download size={13} /> From a marketplace</Button>
        </div>
      } />
      {!list ? <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div> : list.length === 0 ? (
        <Card className="text-center py-10 text-sm text-fg-2">No plugins installed.</Card>
      ) : (
        <div className="rounded-2xl border border-line divide-y divide-divider overflow-hidden">
          {list.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 bg-sidebar">
              <Puzzle size={15} className="text-accent shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium">{p.id.split('@')[0]} {p.version && <span className="text-[11.5px] text-muted">v{p.version}</span>}</div>
                <div className="text-[12px] text-muted truncate">{p.local ? p.installPath : `${p.id.split('@')[1] ?? ''} · ${p.scope}`}</div>
              </div>
              {busy === p.id ? <Loader2 className="animate-spin text-muted" size={16} /> : !p.local && (
                <Toggle checked={p.enabled} label={`Enable ${p.id}`} onChange={async (v) => { setBusy(p.id); const r = await api.pluginsToggle(p.id, v); setBusy(null); if (!r.ok) toast('error', r.error); void load() }} />
              )}
              <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => setRemoving(p)}><Trash2 size={13} /></Button>
            </div>
          ))}
        </div>
      )}
      <Modal open={installing} onClose={() => setInstalling(false)} title="Install from a marketplace" footer={
        <>
          <Button variant="ghost" onClick={() => setInstalling(false)}>Cancel</Button>
          <Button variant="primary" disabled={!source.trim() || busy === 'install'} onClick={async () => {
            setBusy('install')
            const r = await api.pluginsInstallMarketplace(source.trim(), plugin.trim() || undefined)
            setBusy(null)
            if (!r.ok) return toast('error', r.error)
            toast('success', r.data)
            setInstalling(false)
            setSource(''); setPlugin('')
            void load()
          }}>{busy === 'install' ? <><Loader2 className="animate-spin" size={14} /> Installing…</> : 'Install'}</Button>
        </>
      }>
        <Field label="Marketplace" hint="A URL, a GitHub repo like owner/repo, or a folder path."><input className={inputCls} value={source} onChange={(e) => setSource(e.target.value)} placeholder="anthropics/claude-plugins-official" /></Field>
        <Field label="Plugin to install (optional)" hint="Use the form plugin@marketplace. Leave empty to just add the marketplace."><input className={inputCls} value={plugin} onChange={(e) => setPlugin(e.target.value)} placeholder="plugin-name@marketplace" /></Field>
      </Modal>
      <Confirm open={!!removing} title={`Remove ${removing?.id.split('@')[0]}?`} message="The plugin will be uninstalled from Claude Code." confirmLabel="Remove" danger onClose={() => setRemoving(null)}
        onConfirm={async () => { if (!removing) return; setBusy(removing.id); const r = await api.pluginsRemove(removing.id); setBusy(null); if (!r.ok) toast('error', r.error); void load() }} />
    </>
  )
}

// ---------------------------------------------------------------- agents

function AgentsTable() {
  const { agents, toast } = useApp()
  const [editing, setEditing] = useState<Partial<Agent> | null>(null)
  const team = agents.filter((a) => !a.isManager)
  return (
    <>
      <SectionTitle title="Agents" subtitle="Everyone on your team. Agent files work in the Claude Code command line too." right={
        <div className="flex gap-2">
          <Button size="sm" onClick={async () => { const r = await api.agentsImport(); if (!r.ok) toast('error', r.error); else if (r.data.length) toast('success', `Imported ${r.data.length}.`) }}><Upload size={13} /> Import .md</Button>
          <Button size="sm" variant="primary" onClick={() => setEditing({ name: '', tools: ['read', 'write', 'web_search', 'web_fetch', 'skills'], model: 'balanced', avatar: 'blob', color: '#F7A51C' })}><Plus size={14} /> New agent</Button>
        </div>
      } />
      <div className="rounded-2xl border border-line overflow-hidden">
        <div className="grid grid-cols-[1fr_1.3fr_100px_80px_120px] gap-3 px-4 h-10 items-center text-[12px] text-muted bg-sidebar border-b border-line">
          <div>Name</div><div>Role</div><div>Model</div><div>Done</div><div />
        </div>
        {team.map((a) => (
          <div key={a.id} className="grid grid-cols-[1fr_1.3fr_100px_80px_120px] gap-3 px-4 py-2 items-center border-b border-divider last:border-0">
            <div className="flex items-center gap-2 min-w-0"><AgentAvatar avatar={a.avatar} color={a.color} size={24} /><span className="text-[14px] truncate">{a.name}</span></div>
            <div className="text-[13px] text-fg-2 truncate">{a.role}</div>
            <div className="text-[13px] capitalize">{a.model}</div>
            <div className="text-[13px]">{a.tasksDone ?? 0}</div>
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => setEditing(a)}><Pencil size={13} /></Button>
              <Button size="sm" variant="ghost" aria-label="Duplicate" onClick={() => api.agentsDuplicate(a.id)}><Copy size={13} /></Button>
              <Button size="sm" variant="ghost" aria-label="Export" onClick={async () => { const p = await api.agentsExport(a.id); if (p) toast('success', `Saved to ${p}`) }}><Download size={13} /></Button>
            </div>
          </div>
        ))}
        {!team.length && <div className="text-sm text-muted text-center py-8">No agents yet.</div>}
      </div>
      <AgentEditor agent={editing} onClose={() => setEditing(null)} />
    </>
  )
}

// ---------------------------------------------------------------- permissions

function ListEditor({ items, onChange, placeholder }: { items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [v, setV] = useState('')
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {items.map((i) => (
          <span key={i} className="flex items-center gap-1 text-[12.5px] font-mono bg-card border border-line rounded-full pl-2.5 pr-1 h-7">
            {i}
            <button aria-label={`Remove ${i}`} className="text-muted hover:text-fg px-1" onClick={() => onChange(items.filter((x) => x !== i))}>×</button>
          </span>
        ))}
        {!items.length && <span className="text-[13px] text-muted">None</span>}
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (v.trim() && !items.includes(v.trim())) onChange([...items, v.trim()]); setV('') }}>
        <input className={cx(inputCls, 'font-mono text-[13px]')} value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} />
        <Button type="submit" size="sm" disabled={!v.trim()}>Add</Button>
      </form>
    </div>
  )
}

function Permissions() {
  const { settings, updateSettings } = useApp()
  if (!settings) return null
  return (
    <>
      <SectionTitle title="Permissions" subtitle="Decide how much your agents can do on their own." />
      <div className="grid grid-cols-2 gap-3 mb-4">
        {([
          { k: 'full', t: 'Full access', b: 'Agents create, change and delete files in your workspace and run programs without stopping to ask. Fastest. You can always press Stop all.' },
          { k: 'ask', t: 'Ask before risky actions', b: 'Agents read and search freely, but ask you (with Allow / Deny buttons) before changing files or running programs.' }
        ] as const).map((o) => (
          <button key={o.k} onClick={() => updateSettings({ permissionMode: o.k })} className={cx('text-left rounded-2xl border p-4 transition', settings.permissionMode === o.k ? 'border-accent/60 bg-accent-soft' : 'border-line bg-sidebar hover:bg-card')}>
            <div className="flex items-center gap-2 font-semibold mb-1">
              <span className={cx('w-4 h-4 rounded-full border-2 flex items-center justify-center', settings.permissionMode === o.k ? 'border-accent' : 'border-line-strong')}>{settings.permissionMode === o.k && <span className="w-2 h-2 rounded-full bg-accent" />}</span>
              {o.t}
            </div>
            <div className="text-[13px] text-fg-2">{o.b}</div>
          </button>
        ))}
      </div>
      <Card><WorkspaceRow /></Card>
      <Card>
        <div className="font-medium text-[14px] mb-1">Always allowed commands</div>
        <div className="text-[13px] text-fg-2 mb-3">Commands that never need your permission, even in “Ask” mode. Example: <code className="font-mono">npm test</code></div>
        <ListEditor items={settings.allowedCommands} onChange={(v) => updateSettings({ allowedCommands: v })} placeholder="git status" />
      </Card>
      <Card>
        <div className="font-medium text-[14px] mb-1">Blocked commands</div>
        <div className="text-[13px] text-fg-2 mb-3">Agents can never run commands that start with these — even with full access.</div>
        <ListEditor items={settings.blockedCommands} onChange={(v) => updateSettings({ blockedCommands: v })} placeholder="rm -rf" />
      </Card>
    </>
  )
}

// ---------------------------------------------------------------- account & usage

function Account() {
  const toast = useApp((s) => s.toast)
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [hasKey, setHasKey] = useState(false)
  const [key, setKey] = useState(0)
  useEffect(() => {
    void api.usageSummary().then(setUsage)
    void api.authCheck().then((s) => setHasKey(s.hasStoredKey))
  }, [key])
  const max = Math.max(0.0001, ...(usage?.byDay.map((d) => d.cost) ?? [0]))
  return (
    <>
      <SectionTitle title="Account & usage" subtitle="Your Claude connection and what your team has used." />
      <div className="mb-4" key={key}><AuthPanel /></div>
      {hasKey && (
        <Card>
          <Row title="Saved API key" body="Stored encrypted on this computer.">
            <Button size="sm" variant="danger" onClick={async () => { await api.authClearApiKey(); toast('info', 'API key removed.'); setKey((k) => k + 1) }}><KeyRound size={13} /> Remove key</Button>
          </Row>
        </Card>
      )}
      {!usage ? <Skeleton className="h-48" /> : (
        <>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Card className="mb-0"><div className="text-[12.5px] text-muted">Total cost (estimated)</div><div className="text-[26px] font-semibold">{money(usage.totalCost)}</div></Card>
            <Card className="mb-0"><div className="text-[12.5px] text-muted">Tokens processed</div><div className="text-[26px] font-semibold">{compact(usage.totalTokens)}</div></Card>
          </div>
          <Card>
            <div className="font-medium text-[14px] mb-4">Cost per day</div>
            {usage.byDay.length === 0 ? <div className="text-sm text-muted">No usage yet.</div> : (
              <div className="flex items-end gap-2 h-[150px]" role="img" aria-label="Cost per day bar chart">
                {usage.byDay.map((d) => (
                  <div key={d.day} className="flex-1 flex flex-col items-center gap-1.5 min-w-0 group">
                    <div className="text-[10.5px] text-muted opacity-0 group-hover:opacity-100 transition">{money(d.cost)}</div>
                    <motion.div initial={{ height: 0 }} animate={{ height: `${Math.max(3, (d.cost / max) * 110)}px` }} transition={{ duration: 0.4, ease: 'easeOut' }} className="w-full max-w-[34px] rounded-t-md bg-accent" />
                    <div className="text-[10.5px] text-muted truncate">{d.day.slice(5)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <div className="grid grid-cols-2 gap-3">
            <Card className="mb-0">
              <div className="font-medium text-[14px] mb-2">By agent</div>
              {usage.byAgent.map((a) => <div key={a.agentId ?? 'x'} className="flex justify-between text-[13px] py-1.5 border-b border-divider last:border-0"><span className="truncate">{a.name}</span><span className="text-fg-2">{money(a.cost)} · {compact(a.tokens)}</span></div>)}
              {!usage.byAgent.length && <div className="text-sm text-muted">Nothing yet.</div>}
            </Card>
            <Card className="mb-0">
              <div className="font-medium text-[14px] mb-2">By task</div>
              {usage.byTask.map((t) => <div key={t.taskId} className="flex justify-between gap-3 text-[13px] py-1.5 border-b border-divider last:border-0"><span className="truncate">{t.title}</span><span className="text-fg-2 shrink-0">{money(t.cost)}</span></div>)}
              {!usage.byTask.length && <div className="text-sm text-muted">Nothing yet.</div>}
            </Card>
          </div>
          <div className="text-xs text-muted mt-3">With a Claude Pro or Max plan, these costs are estimates — you're billed by your plan, not per token.</div>
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------- advanced

function Advanced() {
  const toast = useApp((s) => s.toast)
  const [confirmReset, setConfirmReset] = useState(false)
  const [info, setInfo] = useState<{ version: string; dataPath: string; logsPath: string } | null>(null)
  useEffect(() => {
    void api.appInfo().then(setInfo)
  }, [])
  return (
    <>
      <SectionTitle title="Advanced" subtitle="Tools for troubleshooting." />
      <Card>
        <Row title="Logs folder" body={<span className="break-all">{info?.logsPath}</span>}><Button size="sm" onClick={() => api.openLogsFolder()}><FolderOpen size={13} /> Open</Button></Row>
        <Row title="Copy diagnostics" body="Copies version info and recent logs, so you can share them when asking for help.">
          <Button size="sm" onClick={async () => { await api.copyDiagnostics(); toast('success', 'Diagnostics copied to the clipboard.') }}><Copy size={13} /> Copy</Button>
        </Row>
        <Row title="Version" body={`agentCloud ${info?.version ?? ''}`}><span /></Row>
      </Card>
      <Card className="border-danger/30">
        <Row title="Reset agentCloud" body="Deletes all chats, tasks, agents and settings in agentCloud and starts fresh. Files in your workspace and your Claude Code settings are not touched.">
          <Button size="sm" variant="danger" onClick={() => setConfirmReset(true)}><Trash2 size={13} /> Reset app</Button>
        </Row>
      </Card>
      <Confirm open={confirmReset} title="Reset agentCloud?" message="All chats, tasks, agents and settings will be deleted and the app will restart. This can't be undone." confirmLabel="Reset everything" danger onClose={() => setConfirmReset(false)} onConfirm={() => api.resetApp()} />
    </>
  )
}
