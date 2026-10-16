import { AnimatePresence, motion } from 'framer-motion'
import { LayoutGrid, Mail, MessageSquarePlus, Plus, Search, Settings as SettingsIcon, Users, Code2, FileText, Trash2, Pencil, Compass } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Conversation } from '@shared/types'
import { cx } from '@/lib/format'
import { api } from '@/lib/ipc'
import { useApp } from '@/stores/app'
import { AgentAvatar, ManagerAvatar, UserAvatar } from './Avatars'
import { Confirm, IconButton, Tooltip } from './ui'

export function Sidebar() {
  const { agents, conversations, activeConversationId, route, tasks, settings, busy, justHired } = useApp()
  const { openConversation, newChat, setRoute, setSearch, openSettings, setTour } = useApp()
  const [menu, setMenu] = useState<{ conv: Conversation; x: number; y: number } | null>(null)
  const [userMenu, setUserMenu] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Conversation | null>(null)
  const manager = agents.find((a) => a.isManager)
  const running = tasks.filter((t) => t.status === 'in_progress' || t.status === 'needs_input').length
  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])

  return (
    <aside className="w-[315px] shrink-0 bg-sidebar border-r border-divider flex flex-col h-full relative">
      {/* header */}
      <div className="drag h-[72px] shrink-0 flex items-center justify-end gap-2 pr-[18px] pl-4">
        <IconButton data-tour="tasks" label="Tasks (Ctrl+T)" badge={running} onClick={() => setRoute('tasks')} className={cx(route === 'tasks' && 'bg-card-hover')}>
          <LayoutGrid size={15} />
        </IconButton>
        <IconButton label="Team" onClick={() => setRoute('team')} className={cx(route === 'team' && 'bg-card-hover')}>
          <Users size={15} />
        </IconButton>
        <IconButton label="Search (Ctrl+K)" onClick={() => setSearch(true)}>
          <Search size={16} strokeWidth={2.2} />
        </IconButton>
        <IconButton label="New chat (Ctrl+N)" onClick={() => void newChat()}>
          <Plus size={18} strokeWidth={2} />
        </IconButton>
      </div>

      {/* manager profile */}
      {manager && (
        <Tooltip label={`${manager.name}'s profile and settings`}>
          <button data-tour="manager" onClick={() => openSettings('general')} className="mx-auto -mt-3 mb-4 flex flex-col items-center group no-drag">
            <ManagerAvatar avatar={settings?.managerAvatar ?? 'drake'} size={68} badge className="transition group-hover:scale-[1.03]" />
            <div className="mt-1.5 text-[14px] font-medium leading-tight">{manager.name}</div>
            <div className="mt-1 max-w-[92px] truncate text-[12px] leading-[18px] px-1.5 rounded-[4px] border border-line bg-card text-fg-2">
              {manager.role}
            </div>
          </button>
        </Tooltip>
      )}

      {/* list */}
      <div className="flex-1 overflow-y-auto px-[14px] pb-3 space-y-1.5">
        <AnimatePresence initial={false}>
          {conversations.map((c) => {
            const agent = agentMap.get(c.agentId)
            const selected = route === 'chat' && c.id === activeConversationId
            const isBusy = c.id in busy
            const hired = justHired === c.agentId
            return (
              <motion.div
                key={c.id}
                layout
                initial={{ opacity: 0, scale: hired ? 0.85 : 0.97, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, height: 0, marginTop: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              >
                {renaming === c.id ? (
                  <RenameRow conv={c} onDone={() => setRenaming(null)} />
                ) : (
                  <button
                    onClick={() => void openConversation(c.id)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMenu({ conv: c, x: e.clientX, y: e.clientY })
                    }}
                    className={cx(
                      'w-full flex items-center gap-3 px-[10px] py-[9px] rounded-[10px] text-left transition',
                      selected ? 'bg-selected' : 'hover:bg-white/[0.04]',
                      hired && 'glow-pulse'
                    )}
                  >
                    <div className="relative">
                      {agent?.isManager ? (
                        <ManagerAvatar avatar={settings?.managerAvatar ?? 'drake'} size={44} />
                      ) : (
                        <AgentAvatar avatar={agent?.avatar ?? 'blob'} color={agent?.color ?? '#F7A51C'} size={44} />
                      )}
                      {isBusy && <span className="absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full bg-accent border-2 border-sidebar dot-pulse" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-[15px] leading-[20px] truncate">{c.title}</div>
                      <div className="text-[14px] leading-[20px] text-fg-2 truncate">{c.preview || (agent && !agent.isManager ? agent.role : 'Say hi to get started')}</div>
                    </div>
                  </button>
                )}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>

      {/* bottom bar */}
      <div className="h-[76px] shrink-0 flex items-center gap-3 px-[18px] relative">
        <Tooltip label="You — settings and help" side="top">
          <button aria-label="Your menu" onClick={() => setUserMenu((v) => !v)} className="rounded-full hover:brightness-125 transition">
            <UserAvatar name={settings?.userName || 'Me'} size={42} />
          </button>
        </Tooltip>
        <button
          data-tour="connect"
          onClick={() => openSettings('connections')}
          className="flex-1 h-[40px] rounded-full border border-line bg-sidebar hover:bg-card transition flex items-center justify-center gap-2.5 font-semibold text-[15px]"
        >
          Connect apps
          <span className="flex items-center -space-x-1">
            <span className="w-[17px] h-[17px] rounded-[4px] bg-[#4285F4] flex items-center justify-center ring-1 ring-sidebar"><Mail size={11} color="#fff" /></span>
            <span className="w-[17px] h-[17px] rounded-[4px] bg-white flex items-center justify-center ring-1 ring-sidebar"><FileText size={11} color="#111" /></span>
            <span className="w-[17px] h-[17px] rounded-[4px] bg-[#7BC043] flex items-center justify-center ring-1 ring-sidebar"><Code2 size={11} color="#111" /></span>
          </span>
        </button>
        <AnimatePresence>
          {userMenu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setUserMenu(false)} />
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.12 }}
                className="absolute bottom-[70px] left-[14px] z-40 w-[220px] bg-card-2 border border-line rounded-xl p-1.5 shadow-[var(--shadow)]"
              >
                <MenuItem icon={<SettingsIcon size={15} />} label="Settings" hint="Ctrl+," onClick={() => { setUserMenu(false); openSettings() }} />
                <MenuItem icon={<Users size={15} />} label="Team" onClick={() => { setUserMenu(false); setRoute('team') }} />
                <MenuItem icon={<MessageSquarePlus size={15} />} label="New chat" hint="Ctrl+N" onClick={() => { setUserMenu(false); void newChat() }} />
                <MenuItem icon={<Compass size={15} />} label="Show me around" onClick={() => { setUserMenu(false); setRoute('chat'); setTour(true) }} />
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {menu && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
          <div className="fixed z-40 w-[180px] bg-card-2 border border-line rounded-xl p-1.5 shadow-[var(--shadow)]" style={{ left: menu.x, top: menu.y }}>
            <MenuItem icon={<Pencil size={14} />} label="Rename" onClick={() => { setRenaming(menu.conv.id); setMenu(null) }} />
            <MenuItem icon={<Trash2 size={14} />} label="Delete chat" danger onClick={() => { setConfirmDelete(menu.conv); setMenu(null) }} />
          </div>
        </>
      )}
      <Confirm
        open={!!confirmDelete}
        title="Delete this chat?"
        message={`“${confirmDelete?.title}” and its messages will be removed. Files your agents created stay in your workspace.`}
        confirmLabel="Delete"
        danger
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (!confirmDelete) return
          await api.conversationsDelete(confirmDelete.id)
          const st = useApp.getState()
          if (st.activeConversationId === confirmDelete.id) {
            const next = st.conversations.find((c) => c.id !== confirmDelete.id)
            if (next) void st.openConversation(next.id)
            else void st.newChat()
          }
        }}
      />
    </aside>
  )
}

function RenameRow({ conv, onDone }: { conv: Conversation; onDone: () => void }) {
  const [v, setV] = useState(conv.title)
  const save = async () => {
    if (v.trim() && v !== conv.title) await api.conversationsRename(conv.id, v)
    onDone()
  }
  return (
    <input
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void save()
        if (e.key === 'Escape') onDone()
      }}
      className="w-full h-[62px] px-3 rounded-[10px] bg-card border border-accent/60 outline-none font-semibold"
    />
  )
}

export function MenuItem({ icon, label, hint, onClick, danger }: { icon?: React.ReactNode; label: string; hint?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cx('w-full flex items-center gap-2.5 px-2.5 h-9 rounded-lg text-[14px] hover:bg-card-hover text-left', danger && 'text-danger')}>
      <span className={cx('text-fg-2', danger && 'text-danger')}>{icon}</span>
      <span className="flex-1">{label}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </button>
  )
}
