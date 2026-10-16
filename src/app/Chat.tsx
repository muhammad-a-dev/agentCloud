import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Pencil, Upload, UserCog, Check, Eraser, MessageSquarePlus } from 'lucide-react'
import { Confirm, IconButton } from '@/components/ui'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatItem } from '@shared/types'
import { AgentAvatar, ManagerAvatar } from '@/components/Avatars'
import { ErrorCard, NoticeRow, PermissionCard, QuestionCard, StreamingBubble, TextBubble, ThinkingIndicator, ToolCard } from '@/components/ChatItems'
import { Composer, type ComposerHandle } from '@/components/Composer'
import { MenuItem } from '@/components/Sidebar'
import { cx, timeLabel } from '@/lib/format'
import { api } from '@/lib/ipc'
import { useApp } from '@/stores/app'

const EXAMPLES = [
  'Research the top 5 note-taking apps and write a comparison in my workspace.',
  'Write a friendly welcome email for new customers and save it as a document.',
  'Look at the files in my workspace and give me a short summary of what’s there.'
]

export function ChatHeaderPill() {
  const { agents, conversations, activeConversationId, settings, openConversation, setRoute } = useApp()
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const conv = conversations.find((c) => c.id === activeConversationId)
  const agent = agents.find((a) => a.id === conv?.agentId)
  const [title, setTitle] = useState(conv?.title ?? '')
  useEffect(() => setTitle(conv?.title ?? ''), [conv?.title])
  const [confirmClear, setConfirmClear] = useState(false)
  const newChat = useApp((s) => s.newChat)
  const clearChat = useApp((s) => s.clearChat)
  const toast = useApp((s) => s.toast)
  if (!conv || !agent) return null
  const label = agent.isManager ? conv.title : agent.name

  return (
    <div className="flex items-center gap-2 no-drag">
    <div className="relative no-drag">
      {renaming ? (
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={async () => { await api.conversationsRename(conv.id, title); setRenaming(false) }}
          onKeyDown={async (e) => {
            if (e.key === 'Enter') { await api.conversationsRename(conv.id, title); setRenaming(false) }
            if (e.key === 'Escape') setRenaming(false)
          }}
          className="h-[46px] w-[260px] rounded-full bg-sidebar border border-accent/60 px-4 text-[15px] font-semibold outline-none text-center"
        />
      ) : (
        <button onClick={() => setOpen((v) => !v)} className="h-[46px] pl-[14px] pr-[16px] rounded-full bg-sidebar border border-line flex items-center gap-2 hover:bg-card transition max-w-[360px]">
          {agent.isManager ? <ManagerAvatar avatar={settings?.managerAvatar ?? 'drake'} size={24} /> : <AgentAvatar avatar={agent.avatar} color={agent.color} size={24} />}
          <span className="font-semibold text-[15px] truncate">{label}</span>
          <ChevronDown size={14} className={cx('text-muted transition', open && 'rotate-180')} />
        </button>
      )}
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.12 }}
              className="absolute left-1/2 -translate-x-1/2 top-[54px] z-40 w-[260px] bg-card-2 border border-line rounded-xl p-1.5 shadow-[var(--shadow)]"
            >
              <div className="px-2.5 pt-1 pb-1.5 text-[11.5px] text-muted font-medium uppercase tracking-wide">Talk to</div>
              <div className="max-h-[280px] overflow-y-auto">
                {agents.map((a) => (
                  <button
                    key={a.id}
                    onClick={async () => {
                      setOpen(false)
                      const c = await api.conversationsOpenForAgent(a.id)
                      await useApp.getState().refreshConversations()
                      void openConversation(c.id)
                    }}
                    className="w-full flex items-center gap-2.5 px-2.5 h-10 rounded-lg hover:bg-card-hover text-left"
                  >
                    {a.isManager ? <ManagerAvatar avatar={settings?.managerAvatar ?? 'drake'} size={24} /> : <AgentAvatar avatar={a.avatar} color={a.color} size={24} />}
                    <span className="flex-1 min-w-0">
                      <span className="block text-[14px] truncate">{a.name}</span>
                    </span>
                    {a.id === agent.id && <Check size={14} className="text-accent" />}
                  </button>
                ))}
              </div>
              <div className="h-px bg-line my-1.5" />
              <MenuItem icon={<MessageSquarePlus size={14} />} label="Start a new chat" onClick={() => { setOpen(false); void newChat() }} />
              <MenuItem icon={<Eraser size={14} />} label="Clear this chat" onClick={() => { setOpen(false); setConfirmClear(true) }} />
              <MenuItem icon={<Pencil size={14} />} label="Rename this chat" onClick={() => { setOpen(false); setRenaming(true) }} />
              {!agent.isManager && <MenuItem icon={<UserCog size={14} />} label={`Edit ${agent.name}`} onClick={() => { setOpen(false); setRoute('team') }} />}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
      <IconButton label="New chat (Ctrl+N)" onClick={() => void newChat()} className="w-[38px] h-[38px]">
        <MessageSquarePlus size={16} />
      </IconButton>
      <IconButton label="Clear this chat" onClick={() => setConfirmClear(true)} className="w-[38px] h-[38px]">
        <Eraser size={16} />
      </IconButton>
      <Confirm
        open={confirmClear}
        title="Clear this chat?"
        message={`All messages in “${label}” will be removed and ${agent.name} will start fresh. Your files and tasks stay as they are.`}
        confirmLabel="Clear chat"
        danger
        onConfirm={async () => {
          await clearChat(conv.id)
          toast('success', 'Chat cleared. Start fresh!')
        }}
        onClose={() => setConfirmClear(false)}
      />
    </div>
  )
}

export function Chat() {
  const { activeConversationId, items, drafts, busy, retry, agents, conversations, send } = useApp()
  const scroller = useRef<HTMLDivElement>(null)
  const composer = useRef<ComposerHandle>(null)
  const stick = useRef(true)
  const [dragging, setDragging] = useState(false)
  const conv = conversations.find((c) => c.id === activeConversationId)
  const agent = agents.find((a) => a.id === conv?.agentId)
  const list = activeConversationId ? items[activeConversationId] : undefined
  const draft = activeConversationId ? drafts[activeConversationId] : undefined
  const isBusy = !!activeConversationId && activeConversationId in busy
  const activity = activeConversationId ? busy[activeConversationId] : null
  const retryInfo = activeConversationId ? retry[activeConversationId] : undefined

  const activeQuestionId = useMemo(() => {
    const q = [...(list ?? [])].reverse().find((i) => i.kind === 'question')
    return q && q.kind === 'question' && q.answer === undefined && !q.dismissed ? q.id : null
  }, [list])

  useEffect(() => {
    stick.current = true
    composer.current?.focus()
  }, [activeConversationId])

  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [list, draft, isBusy])

  const onScroll = () => {
    const el = scroller.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }

  const showTimestamp = (cur: ChatItem, prev?: ChatItem) => !prev || cur.createdAt - prev.createdAt > 10 * 60 * 1000

  return (
    <div
      className="flex-1 flex flex-col min-h-0 relative"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const paths = Array.from(e.dataTransfer.files).map((f) => api.getPathForFile(f)).filter(Boolean)
        void composer.current?.addAttachments(paths)
      }}
    >
      <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto">
        <div className="max-w-[1000px] mx-auto px-[18px] pb-6 pt-1 flex flex-col gap-[6px]">
          {!list ? (
            <div className="space-y-3 pt-10">
              <div className="skeleton h-14 w-[60%]" />
              <div className="skeleton h-10 w-[40%] ml-auto" />
              <div className="skeleton h-20 w-[70%]" />
            </div>
          ) : list.length === 0 && !draft && !isBusy ? (
            <EmptyChat name={agent?.name ?? 'your Manager'} isManager={!!agent?.isManager} role={agent?.role ?? ''} onPick={(t) => void send(t)} />
          ) : (
            list.map((item, i) => (
              <Fragment key={item.id}>
                {showTimestamp(item, list[i - 1]) && <div className="text-center text-[13px] text-muted mt-5 mb-[10px]">{timeLabel(item.createdAt)}</div>}
                {item.kind === 'text' ? <TextBubble item={item} />
                  : item.kind === 'tool' ? <ToolCard item={item} />
                  : item.kind === 'question' ? <QuestionCard item={item} active={item.id === activeQuestionId} />
                  : item.kind === 'permission' ? <PermissionCard item={item} />
                  : item.kind === 'notice' ? <NoticeRow item={item} />
                  : <ErrorCard item={item} conversationId={activeConversationId!} />}
              </Fragment>
            ))
          )}
          {draft && <StreamingBubble text={draft} />}
          <AnimatePresence>{isBusy && !draft && !activeQuestionId && <ThinkingIndicator activity={activity} retry={retryInfo} />}</AnimatePresence>
        </div>
      </div>
      <div className="px-[18px] pb-[18px] pt-1">
        <Composer
          ref={composer}
          placeholder={`Message ${agent?.isManager ? agent.name : agent?.name ?? ''}`}
          busy={isBusy}
          onSend={(t, a) => {
            stick.current = true
            void send(t, a)
          }}
          onStop={() => activeConversationId && api.chatStop(activeConversationId)}
        />
      </div>
      <AnimatePresence>
        {dragging && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-3 rounded-3xl border-2 border-dashed border-accent/70 bg-black/70 flex items-center justify-center pointer-events-none z-20">
            <div className="text-center">
              <Upload className="mx-auto text-accent mb-2" size={30} />
              <div className="font-semibold">Drop files to attach them</div>
              <div className="text-sm text-fg-2">They’ll be copied into your workspace</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function EmptyChat({ name, isManager, role, onPick }: { name: string; isManager: boolean; role: string; onPick: (t: string) => void }) {
  const userName = useApp((s) => s.settings?.userName)
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="pt-[14vh] flex flex-col items-center text-center">
      <div className="text-[13px] text-muted mb-3">{timeLabel(Date.now())}</div>
      <div className="bg-card rounded-2xl px-4 py-3 max-w-[560px] text-[15px] text-left">
        {isManager
          ? `Hi${userName ? ` ${userName}` : ''}, I'm ${name}! Tell me what you need and I'll put the right people on it. You can keep chatting with me while they work.`
          : `Hi${userName ? ` ${userName}` : ''}, I'm ${name} — ${role.charAt(0).toLowerCase() + role.slice(1)}. What can I do for you?`}
      </div>
      {isManager && (
        <div className="mt-6 flex flex-col gap-2 w-full max-w-[560px]">
          <div className="text-[12.5px] text-muted text-left px-1">Try one of these</div>
          {EXAMPLES.map((e) => (
            <motion.button key={e} whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }} onClick={() => onPick(e)} className="text-left text-[14px] rounded-xl border border-line bg-sidebar hover:bg-card px-3.5 py-2.5 text-fg-2 hover:text-fg transition-colors">
              {e}
            </motion.button>
          ))}
        </div>
      )}
    </motion.div>
  )
}
