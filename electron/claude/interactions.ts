// Questions (ask_user) and permission requests that wait for the user to answer in the UI.
import { BrowserWindow, Notification } from 'electron'
import { randomUUID } from 'crypto'
import type { ChatItem } from '@shared/types'
import { convRepo, msgRepo, settingsRepo, tasksRepo } from '../db/repos'
import { emit } from '../events'

type Waiter = { resolve: (answer: string | null) => void; conversationId: string; taskId?: string }
const waiting = new Map<string, Waiter>()

type ItemListener = (conversationId: string, item: ChatItem) => void
const itemListeners = new Set<ItemListener>()

/** Other channels (e.g. Telegram) can watch every chat item as it is added or updated. */
export function onItemPushed(fn: ItemListener) {
  itemListeners.add(fn)
  return () => itemListeners.delete(fn)
}

function notifyListeners(conversationId: string, item: ChatItem) {
  for (const fn of itemListeners) {
    try {
      fn(conversationId, item)
    } catch {
      /* a broken listener must never break the chat */
    }
  }
}

export function pushItem(conversationId: string, item: ChatItem) {
  msgRepo.upsert(conversationId, item)
  convRepo.touch(conversationId)
  emit({ type: 'chat:item', conversationId, item })
  if (item.kind !== 'tool') emit({ type: 'conversations:changed' })
  notifyListeners(conversationId, item)
}

export function notifyDesktop(title: string, body: string) {
  if (!settingsRepo.getAll().notifications) return
  const focused = BrowserWindow.getAllWindows().some((w) => w.isFocused())
  if (focused || !Notification.isSupported()) return
  const n = new Notification({ title, body })
  n.on('click', () => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w) {
      if (w.isMinimized()) w.restore()
      w.show()
      w.focus()
    }
  })
  n.show()
}

function setNeedsInput(taskId: string | undefined, waitingNow: boolean) {
  if (!taskId) return
  const t = tasksRepo.get(taskId)
  if (!t) return
  if (waitingNow && t.status === 'in_progress') {
    emit({ type: 'task:update', task: tasksRepo.update(taskId, { status: 'needs_input', lastActivity: 'Waiting for your answer' })! })
  } else if (!waitingNow && t.status === 'needs_input') {
    emit({ type: 'task:update', task: tasksRepo.update(taskId, { status: 'in_progress', lastActivity: 'Got your answer, continuing…' })! })
  }
}

export function askUser(opts: {
  conversationId: string
  question: string
  options: string[]
  allowCustom: boolean
  from?: string
  taskId?: string
  signal?: AbortSignal
}): Promise<string | null> {
  const item: ChatItem = {
    kind: 'question', id: randomUUID(), question: opts.question, options: opts.options.slice(0, 4), allowCustom: opts.allowCustom,
    from: opts.from, taskId: opts.taskId, createdAt: Date.now()
  }
  pushItem(opts.conversationId, item)
  setNeedsInput(opts.taskId, true)
  notifyDesktop(opts.from ? `${opts.from} has a question` : 'A question for you', opts.question)
  return new Promise((resolve) => {
    waiting.set(item.id, { resolve, conversationId: opts.conversationId, taskId: opts.taskId })
    opts.signal?.addEventListener('abort', () => answer(item.id, null, true))
  })
}

export function requestPermission(opts: {
  conversationId: string
  toolName: string
  input: Record<string, unknown>
  from?: string
  taskId?: string
  signal?: AbortSignal
}): Promise<boolean> {
  const item: ChatItem = {
    kind: 'permission', id: randomUUID(), toolName: opts.toolName, input: opts.input, from: opts.from, taskId: opts.taskId, createdAt: Date.now()
  }
  pushItem(opts.conversationId, item)
  setNeedsInput(opts.taskId, true)
  notifyDesktop(`${opts.from ?? 'An agent'} needs your permission`, 'Open agentCloud to allow or deny.')
  return new Promise((resolve) => {
    waiting.set(item.id, { resolve: (a) => resolve(a === 'allow'), conversationId: opts.conversationId, taskId: opts.taskId })
    opts.signal?.addEventListener('abort', () => answer(item.id, null, true))
  })
}

/** Called from the UI (or on abort). `answer === null` means dismissed. */
export function answer(itemId: string, value: string | null, aborted = false) {
  const w = waiting.get(itemId)
  const rec = msgRepo.get(itemId)
  if (rec) {
    const it = rec.item
    if (it.kind === 'question') {
      if (value === null) it.dismissed = true
      else it.answer = value
    } else if (it.kind === 'permission') {
      it.decision = value === 'allow' ? 'allow' : 'deny'
    }
    msgRepo.upsert(rec.conversationId, it)
    emit({ type: 'chat:item', conversationId: rec.conversationId, item: it })
    notifyListeners(rec.conversationId, it)
  }
  if (!w) return
  waiting.delete(itemId)
  if (!aborted) setNeedsInput(w.taskId, false)
  w.resolve(value)
}

export function cancelWaitersForTask(taskId: string) {
  for (const [id, w] of waiting) if (w.taskId === taskId) answer(id, null, true)
}

/** Read-only tools never need a permission card. */
export const SAFE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebSearch', 'ToolSearch', 'Skill', 'Task', 'TodoWrite', 'ListMcpResourcesTool', 'ReadMcpResourceTool'])
