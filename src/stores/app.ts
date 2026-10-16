import { create } from 'zustand'
import type { Agent, AppEvent, AuthStatus, ChatItem, Conversation, Schedule, Settings, Task, Workflow } from '@shared/types'
import { api } from '@/lib/ipc'

export type Route = 'chat' | 'tasks' | 'team' | 'settings' | 'workflows' | 'schedule'
export type SettingsSection = 'general' | 'connections' | 'telegram' | 'skills' | 'plugins' | 'agents' | 'permissions' | 'account' | 'advanced'

export interface Toast {
  id: number
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
  action?: { label: string; run: () => void }
}

interface QueuedMessage {
  conversationId: string
  text: string
  attachments?: string[]
  item: ChatItem
}

interface AppState {
  ready: boolean
  settings: Settings | null
  auth: AuthStatus | null
  agents: Agent[]
  conversations: Conversation[]
  tasks: Task[]
  workflows: Workflow[]
  schedules: Schedule[]
  workflowChatBusy: Record<string, boolean>
  activeWorkflowId: string | null
  sidebarOpen: boolean
  workflowPanelOpen: boolean
  route: Route
  settingsSection: SettingsSection
  activeConversationId: string | null
  items: Record<string, ChatItem[]>
  drafts: Record<string, string>
  busy: Record<string, string | null>
  retry: Record<string, { until: number; attempt: number; max: number } | undefined>
  online: boolean
  queue: QueuedMessage[]
  toasts: Toast[]
  openTaskId: string | null
  searchOpen: boolean
  reconnectOpen: boolean
  tourOpen: boolean
  justHired: string | null
  celebrate: { taskId: string; at: number } | null

  init(): Promise<void>
  refreshAgents(): Promise<void>
  refreshConversations(): Promise<void>
  refreshTasks(): Promise<void>
  refreshWorkflows(): Promise<void>
  refreshSchedules(): Promise<void>
  openWorkflow(id: string | null): void
  toggleSidebar(open?: boolean): void
  toggleWorkflowPanel(open?: boolean): void
  clearChat(id: string): Promise<void>
  setRoute(r: Route): void
  openSettings(s?: SettingsSection): void
  openConversation(id: string): Promise<void>
  newChat(): Promise<void>
  loadItems(id: string): Promise<void>
  send(text: string, attachments?: string[]): Promise<void>
  flushQueue(): Promise<void>
  updateSettings(patch: Partial<Settings>): Promise<void>
  toast(level: Toast['level'], message: string, action?: Toast['action']): void
  dismissToast(id: number): void
  openTask(id: string | null): void
  setSearch(open: boolean): void
  setReconnect(open: boolean): void
  setTour(open: boolean): void
  handleEvent(e: AppEvent): void
}

let toastSeq = 1
const LAST_CONV_KEY = 'agentcloud:lastConversation'
const SIDEBAR_KEY = 'agentcloud:sidebarOpen'
const WF_PANEL_KEY = 'agentcloud:workflowPanelOpen'

/** Remembered show/hide choices; storage can be unavailable, so fall back quietly. */
function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function upsertItem(list: ChatItem[] = [], item: ChatItem): ChatItem[] {
  const i = list.findIndex((x) => x.id === item.id)
  if (i === -1) return [...list, item]
  const copy = list.slice()
  copy[i] = item
  return copy
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  settings: null,
  auth: null,
  agents: [],
  conversations: [],
  tasks: [],
  workflows: [],
  schedules: [],
  workflowChatBusy: {},
  activeWorkflowId: null,
  sidebarOpen: readFlag(SIDEBAR_KEY, true),
  workflowPanelOpen: readFlag(WF_PANEL_KEY, true),
  route: 'chat',
  settingsSection: 'general',
  activeConversationId: null,
  items: {},
  drafts: {},
  busy: {},
  retry: {},
  online: navigator.onLine,
  queue: [],
  toasts: [],
  openTaskId: null,
  searchOpen: false,
  reconnectOpen: false,
  tourOpen: false,
  justHired: null,
  celebrate: null,

  async init() {
    const [settings, agents, conversations, tasks, busy, workflows, schedules, wfBusy] = await Promise.all([
      api.settingsGet(), api.agentsList(), api.conversationsList(), api.tasksList(), api.chatBusy(), api.workflowsList(), api.schedulesList(), api.workflowsChatBusy()
    ])
    document.documentElement.dataset.theme = settings.theme
    set({ settings, agents, conversations, tasks, busy, workflows, schedules, workflowChatBusy: Object.fromEntries(wfBusy.map((id) => [id, true])), ready: true })
    if (settings.onboarded) {
      let last: string | null = null
      try {
        last = localStorage.getItem(LAST_CONV_KEY)
      } catch {
        /* storage unavailable */
      }
      const target = conversations.find((c) => c.id === last) ?? conversations.find((c) => c.agentId === agents.find((a) => a.isManager)?.id) ?? conversations[0]
      if (target) await get().openConversation(target.id)
      else await get().newChat()
    }
    window.addEventListener('online', () => {
      set({ online: true })
      void get().flushQueue()
    })
    window.addEventListener('offline', () => set({ online: false }))
  },

  async refreshAgents() {
    set({ agents: await api.agentsList() })
  },
  async refreshConversations() {
    set({ conversations: await api.conversationsList() })
  },
  async refreshTasks() {
    set({ tasks: await api.tasksList() })
  },
  async refreshWorkflows() {
    set({ workflows: await api.workflowsList() })
  },
  async refreshSchedules() {
    set({ schedules: await api.schedulesList() })
  },
  openWorkflow(id) {
    set({ activeWorkflowId: id, route: 'workflows' })
  },
  toggleSidebar(open) {
    const sidebarOpen = open ?? !get().sidebarOpen
    writeFlag(SIDEBAR_KEY, sidebarOpen)
    set({ sidebarOpen })
  },
  toggleWorkflowPanel(open) {
    const workflowPanelOpen = open ?? !get().workflowPanelOpen
    writeFlag(WF_PANEL_KEY, workflowPanelOpen)
    set({ workflowPanelOpen })
  },
  async clearChat(id) {
    await api.conversationsClear(id)
    set((s) => {
      const drafts = { ...s.drafts }
      const busy = { ...s.busy }
      delete drafts[id]
      delete busy[id]
      return { items: { ...s.items, [id]: [] }, drafts, busy, queue: s.queue.filter((q) => q.conversationId !== id) }
    })
  },

  setRoute(route) {
    set({ route })
  },
  openSettings(section) {
    set({ route: 'settings', settingsSection: section ?? get().settingsSection })
  },

  async openConversation(id) {
    set({ activeConversationId: id, route: 'chat' })
    try {
      localStorage.setItem(LAST_CONV_KEY, id)
    } catch {
      /* ignore */
    }
    await get().loadItems(id)
  },

  async newChat() {
    const manager = get().agents.find((a) => a.isManager)
    const c = await api.conversationsCreate(manager?.id)
    await get().refreshConversations()
    await get().openConversation(c.id)
  },

  async loadItems(id) {
    const items = await api.chatItems(id)
    const queued = get().queue.filter((q) => q.conversationId === id).map((q) => q.item)
    set((s) => ({ items: { ...s.items, [id]: [...items, ...queued] } }))
  },

  async send(text, attachments) {
    const id = get().activeConversationId
    if (!id) return
    if (!get().online) {
      const item: ChatItem = { kind: 'text', id: `queued-${Date.now()}`, role: 'user', text, attachments, createdAt: Date.now(), queued: true }
      set((s) => ({ queue: [...s.queue, { conversationId: id, text, attachments, item }], items: { ...s.items, [id]: upsertItem(s.items[id], item) } }))
      return
    }
    set((s) => ({ busy: { ...s.busy, [id]: s.busy[id] ?? 'Thinking…' } }))
    const r = await api.chatSend(id, text, attachments)
    if (!r.ok) get().toast('error', r.error)
  },

  async flushQueue() {
    const q = get().queue
    if (!q.length) return
    set({ queue: [] })
    for (const m of q) {
      set((s) => ({ items: { ...s.items, [m.conversationId]: (s.items[m.conversationId] ?? []).filter((i) => i.id !== m.item.id) } }))
      await api.chatSend(m.conversationId, m.text, m.attachments)
    }
    get().toast('success', q.length === 1 ? 'Back online — your message was sent.' : `Back online — ${q.length} messages were sent.`)
  },

  async updateSettings(patch) {
    const settings = await api.settingsSet(patch)
    document.documentElement.dataset.theme = settings.theme
    set({ settings })
    if ('managerName' in patch || 'managerRole' in patch || 'managerAvatar' in patch) void get().refreshAgents()
  },

  toast(level, message, action) {
    const id = toastSeq++
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, level, message, action }] }))
    setTimeout(() => get().dismissToast(id), level === 'error' ? 7000 : 4500)
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
  openTask(id) {
    set({ openTaskId: id })
  },
  setSearch(open) {
    set({ searchOpen: open })
  },
  setReconnect(open) {
    set({ reconnectOpen: open })
  },
  setTour(open) {
    set({ tourOpen: open })
  },

  handleEvent(e) {
    switch (e.type) {
      case 'chat:item':
        set((s) => {
          const drafts = { ...s.drafts }
          if (e.item.kind === 'text' && e.item.role === 'assistant') delete drafts[e.conversationId]
          return {
            items: s.items[e.conversationId] ? { ...s.items, [e.conversationId]: upsertItem(s.items[e.conversationId], e.item) } : s.items,
            drafts,
            retry: { ...s.retry, [e.conversationId]: undefined }
          }
        })
        return
      case 'chat:delta':
        set((s) => ({ drafts: { ...s.drafts, [e.conversationId]: (s.drafts[e.conversationId] ?? '') + e.text }, retry: { ...s.retry, [e.conversationId]: undefined } }))
        return
      case 'chat:status':
        set((s) => {
          const busy = { ...s.busy }
          const drafts = { ...s.drafts }
          if (e.busy) busy[e.conversationId] = e.activity ?? busy[e.conversationId] ?? null
          else {
            delete busy[e.conversationId]
            delete drafts[e.conversationId]
          }
          return { busy, drafts, retry: e.busy ? s.retry : { ...s.retry, [e.conversationId]: undefined } }
        })
        return
      case 'chat:retry':
        set((s) => ({ retry: { ...s.retry, [e.conversationId]: { until: Date.now() + e.seconds * 1000, attempt: e.attempt, max: e.maxAttempts } } }))
        return
      case 'conversations:changed':
        void get().refreshConversations()
        return
      case 'agents:changed':
        void get().refreshAgents()
        if (e.hiredId) {
          set({ justHired: e.hiredId })
          setTimeout(() => get().justHired === e.hiredId && set({ justHired: null }), 3500)
        }
        return
      case 'task:update':
        set((s) => {
          const i = s.tasks.findIndex((t) => t.id === e.task.id)
          const tasks = i === -1 ? [e.task, ...s.tasks] : s.tasks.map((t) => (t.id === e.task.id ? e.task : t))
          return { tasks }
        })
        void get().refreshAgents()
        return
      case 'workflows:changed':
        void get().refreshWorkflows()
        return
      case 'workflow:update':
        set((s) => {
          const i = s.workflows.findIndex((w) => w.id === e.workflow.id)
          return { workflows: i === -1 ? [e.workflow, ...s.workflows] : s.workflows.map((w) => (w.id === e.workflow.id ? e.workflow : w)) }
        })
        return
      case 'workflow:chat':
        set((s) => ({ workflowChatBusy: { ...s.workflowChatBusy, [e.workflowId]: e.busy } }))
        return
      case 'schedules:changed':
        void get().refreshSchedules()
        return
      case 'task:celebrate':
        set({ celebrate: { taskId: e.taskId, at: Date.now() } })
        return
      case 'toast':
        get().toast(e.level, e.message)
        return
      case 'navigate':
        if (e.to === 'conversation') void get().openConversation(e.id)
        else set({ openTaskId: e.id })
        return
      default:
        return
    }
  }
}))
