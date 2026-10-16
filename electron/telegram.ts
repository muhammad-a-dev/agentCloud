// Telegram message channel: talk to the Manager from your phone through your own Telegram bot.
// Only chats that sent the in-app pairing code are allowed to give orders.
import { safeStorage } from 'electron'
import { randomInt } from 'crypto'
import fs from 'fs'
import path from 'path'
import type { ChatItem, TelegramStatus } from '@shared/types'
import { agentsRepo, convRepo, msgRepo, settingsRepo } from './db/repos'
import { emit } from './events'
import { log } from './logging'
import { answer, onItemPushed } from './claude/interactions'
import { abortAllChats, busyMap, sessionFor } from './claude/manager'
import { cancelAllTasks } from './claude/agentRunner'

interface LinkedChat {
  id: number
  name: string
  conversationId: string
}

const TOKEN_KEY = 'telegramTokenEnc'
const CHATS_KEY = 'telegramChats'
const CODE_KEY = 'telegramPairingCode'
const BOT_KEY = 'telegramBotUsername'
const MAX_FILE_BYTES = 49 * 1024 * 1024
/** Overridable for testing against a local fake Telegram server. */
const API = process.env.AGENTCLOUD_TELEGRAM_API || 'https://api.telegram.org'

let polling: AbortController | null = null
let running = false
let lastError: string | null = null
let typingTimer: NodeJS.Timeout | null = null
const sentItems = new Set<string>()
/** Telegram message id of each question/permission we sent, so we can update it once answered. */
const promptMessages = new Map<string, { chatId: number; messageId: number }>()

// ---------------------------------------------------------------- storage

function getToken(): string | null {
  const enc = settingsRepo.getRaw<string | null>(TOKEN_KEY, null)
  if (!enc || !safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return null
  }
}

const chats = () => settingsRepo.getRaw<LinkedChat[]>(CHATS_KEY, [])
const saveChats = (c: LinkedChat[]) => settingsRepo.setRaw(CHATS_KEY, c)

function pairingCode(): string {
  let code = settingsRepo.getRaw<string | null>(CODE_KEY, null)
  if (!code) {
    code = String(randomInt(100000, 999999))
    settingsRepo.setRaw(CODE_KEY, code)
  }
  return code
}

export function telegramChatFor(conversationId: string): number | null {
  return chats().find((c) => c.conversationId === conversationId)?.id ?? null
}

export function telegramStatus(): TelegramStatus {
  const connected = !!getToken()
  return {
    connected,
    running,
    botUsername: settingsRepo.getRaw<string | null>(BOT_KEY, null),
    pairingCode: connected ? pairingCode() : null,
    chats: chats().map(({ id, name }) => ({ id, name })),
    error: lastError
  }
}

function pushStatus() {
  emit({ type: 'telegram:status', status: telegramStatus() })
}

// ---------------------------------------------------------------- Bot API

async function call<T>(method: string, body: Record<string, unknown> = {}, signal?: AbortSignal, token = getToken()): Promise<T> {
  if (!token) throw new Error('Telegram is not connected.')
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal
  })
  const json = (await res.json()) as { ok: boolean; result: T; description?: string }
  if (!json.ok) throw new Error(json.description ?? `Telegram error ${res.status}`)
  return json.result
}

async function sendDocument(chatId: number, file: string, caption?: string) {
  const token = getToken()
  if (!token) return
  const form = new FormData()
  form.append('chat_id', String(chatId))
  if (caption) form.append('caption', caption)
  form.append('document', new Blob([fs.readFileSync(file)]), path.basename(file))
  const res = await fetch(`${API}/bot${token}/sendDocument`, { method: 'POST', body: form })
  const json = (await res.json()) as { ok: boolean; description?: string }
  if (!json.ok) throw new Error(json.description ?? 'Could not send the file')
}

// ---------------------------------------------------------------- formatting

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Turns the Manager's Markdown into Telegram-safe HTML, and collects linked workspace files. */
function toTelegram(md: string): { html: string; files: string[] } {
  const files: string[] = []
  let out = esc(md)
  out = out.replace(/```[\w-]*\n([\s\S]*?)```/g, (_, code) => `<pre>${code}</pre>`)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => {
    if (href.startsWith('file://')) {
      files.push(decodeURIComponent(href.slice('file://'.length)))
      return `<b>${label}</b>`
    }
    if (href.startsWith('task://')) return `<b>${label}</b>`
    if (/^https?:/.test(href)) return `<a href="${href.replace(/"/g, '&quot;')}">${label}</a>`
    return label
  })
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, '$1<i>$2</i>')
  out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  out = out.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
  out = out.replace(/^\s*[-*]\s+/gm, '• ')
  return { html: out, files }
}

function chunks(s: string, size = 3900): string[] {
  const out: string[] = []
  let rest = s
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size)
    if (cut < size / 2) cut = size
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  if (rest.trim()) out.push(rest)
  return out
}

async function sendText(chatId: number, md: string, extra: Record<string, unknown> = {}): Promise<number | null> {
  const { html, files } = toTelegram(md)
  let lastId: number | null = null
  const parts = chunks(html)
  for (let i = 0; i < parts.length; i++) {
    const markup = i === parts.length - 1 ? extra : {}
    try {
      lastId = (await call<{ message_id: number }>('sendMessage', { chat_id: chatId, text: parts[i], parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...markup })).message_id
    } catch {
      // Fall back to plain text if Telegram rejects the formatting.
      lastId = (await call<{ message_id: number }>('sendMessage', { chat_id: chatId, text: parts[i].replace(/<[^>]+>/g, ''), ...markup })).message_id
    }
  }
  const ws = settingsRepo.getAll().workspace ?? ''
  for (const f of [...new Set(files)]) {
    const full = path.isAbsolute(f) ? f : path.join(ws, f)
    try {
      if (fs.existsSync(full) && fs.statSync(full).size <= MAX_FILE_BYTES) await sendDocument(chatId, full)
    } catch (e) {
      log.warn('telegram file send failed', e)
    }
  }
  return lastId
}

// ---------------------------------------------------------------- outgoing: app → Telegram

async function relay(conversationId: string, item: ChatItem) {
  const chatId = telegramChatFor(conversationId)
  if (!chatId || !settingsRepo.getAll().telegramEnabled) return
  // Answered questions / permissions: update the buttons message.
  const prompt = promptMessages.get(item.id)
  if (prompt && ((item.kind === 'question' && (item.answer !== undefined || item.dismissed)) || (item.kind === 'permission' && item.decision))) {
    promptMessages.delete(item.id)
    const note = item.kind === 'question' ? (item.dismissed ? 'Closed' : `✅ ${item.answer}`) : item.decision === 'allow' ? '✅ Allowed' : '🚫 Not allowed'
    await call('editMessageReplyMarkup', { chat_id: prompt.chatId, message_id: prompt.messageId, reply_markup: { inline_keyboard: [[{ text: note, callback_data: 'noop' }]] } }).catch(() => {})
    return
  }
  if (sentItems.has(item.id)) return
  switch (item.kind) {
    case 'text':
      if (item.role !== 'assistant') return
      sentItems.add(item.id)
      await sendText(chatId, item.text)
      return
    case 'question': {
      if (item.answer !== undefined || item.dismissed) return
      sentItems.add(item.id)
      const keyboard = item.options.map((o, i) => [{ text: o, callback_data: `q:${item.id}:${i}` }])
      const who = item.from && item.taskId ? `<i>${esc(item.from)} asks:</i>\n` : ''
      const id = await sendText(chatId, `${who}**${item.question}**${item.allowCustom ? '\n\nTap a button, or just type your own answer.' : ''}`, { reply_markup: { inline_keyboard: keyboard } })
      if (id) promptMessages.set(item.id, { chatId, messageId: id })
      return
    }
    case 'permission': {
      if (item.decision) return
      sentItems.add(item.id)
      const what = String(item.input.description ?? item.input.command ?? item.input.file_path ?? item.input.url ?? item.toolName)
      const id = await sendText(chatId, `🔐 **${item.from ?? 'An agent'} wants to:** ${what}`, {
        reply_markup: { inline_keyboard: [[{ text: '✅ Allow', callback_data: `p:${item.id}:1` }, { text: '🚫 Deny', callback_data: `p:${item.id}:0` }]] }
      })
      if (id) promptMessages.set(item.id, { chatId, messageId: id })
      return
    }
    case 'tool':
      if (item.status !== 'done' || !item.media?.length) return
      sentItems.add(item.id)
      for (const m of item.media) {
        const full = path.isAbsolute(m.path) ? m.path : path.join(settingsRepo.getAll().workspace ?? '', m.path)
        try {
          if (fs.existsSync(full) && fs.statSync(full).size <= MAX_FILE_BYTES) await sendDocument(chatId, full, m.name)
        } catch (e) {
          log.warn('telegram media send failed', e)
        }
      }
      return
    case 'notice':
      if (item.level === 'info') return
      sentItems.add(item.id)
      await sendText(chatId, `${item.level === 'success' ? '✅' : item.level === 'error' ? '⚠️' : 'ℹ️'} ${item.text}`)
      return
    case 'error':
      sentItems.add(item.id)
      await sendText(chatId, `⚠️ **${item.error.title}**\n${item.error.reason}`)
      return
  }
}

// ---------------------------------------------------------------- incoming: Telegram → app

interface TgUpdate {
  update_id: number
  message?: {
    message_id: number
    chat: { id: number; type: string; first_name?: string; username?: string; title?: string }
    text?: string
    caption?: string
    document?: { file_id: string; file_name?: string }
    photo?: { file_id: string; file_size?: number }[]
  }
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } }
}

function managerConversation(chatId: number, name: string): string {
  const list = chats()
  const existing = list.find((c) => c.id === chatId)
  if (existing && convRepo.get(existing.conversationId)) return existing.conversationId
  const manager = agentsRepo.manager()!
  const conv = convRepo.create(manager.id, `Telegram · ${name}`)
  saveChats([...list.filter((c) => c.id !== chatId), { id: chatId, name, conversationId: conv.id }])
  emit({ type: 'conversations:changed' })
  return conv.id
}

async function downloadAttachment(fileId: string, fileName: string): Promise<string | null> {
  const ws = settingsRepo.getAll().workspace
  const token = getToken()
  if (!ws || !token) return null
  const f = await call<{ file_path: string }>('getFile', { file_id: fileId })
  const res = await fetch(`${API}/file/bot${token}/${f.file_path}`)
  if (!res.ok) return null
  const dir = path.join(ws, 'attachments')
  fs.mkdirSync(dir, { recursive: true })
  const ext = path.extname(fileName)
  const base = path.basename(fileName, ext)
  let dest = path.join(dir, fileName)
  for (let i = 2; fs.existsSync(dest); i++) dest = path.join(dir, `${base} (${i})${ext}`)
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
  return path.relative(ws, dest).replace(/\\/g, '/')
}

function pendingQuestion(conversationId: string) {
  const items = msgRepo.list(conversationId)
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === 'question') return it.answer === undefined && !it.dismissed && it.allowCustom ? it : null
  }
  return null
}

async function handleUpdate(u: TgUpdate) {
  if (u.callback_query) {
    const q = u.callback_query
    const chatId = q.message?.chat.id
    if (!chatId || !chats().some((c) => c.id === chatId)) return void call('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {})
    const [kind, itemId, value] = (q.data ?? '').split(':')
    const rec = itemId ? msgRepo.get(itemId) : null
    if (kind === 'q' && rec?.item.kind === 'question') answer(itemId, rec.item.options[Number(value)] ?? null)
    else if (kind === 'p') answer(itemId, value === '1' ? 'allow' : 'deny')
    await call('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {})
    return
  }
  const m = u.message
  if (!m || m.chat.type !== 'private') return
  const chatId = m.chat.id
  const name = m.chat.first_name || m.chat.username || 'Telegram'
  const text = (m.text ?? m.caption ?? '').trim()
  const linked = chats().some((c) => c.id === chatId)

  if (!linked) {
    if (text.includes(pairingCode())) {
      const convId = managerConversation(chatId, name)
      settingsRepo.setRaw(CODE_KEY, String(randomInt(100000, 999999))) // one-time code
      pushStatus()
      const manager = agentsRepo.manager()
      await sendText(chatId, `🎉 Connected! You can now message **${manager?.name ?? 'your Manager'}** right here.\nAsk for anything, just like in the app.\n\nCommands: /new to start a fresh chat, /stop to stop all work.`)
      emit({ type: 'toast', level: 'success', message: `Telegram connected: ${name}` })
      void convId
    } else {
      await sendText(chatId, '🔒 This is a private agentCloud bot.\nTo connect, open agentCloud → Settings → Telegram, and send the 6-digit pairing code shown there.')
    }
    return
  }

  if (!settingsRepo.getAll().telegramEnabled) {
    await sendText(chatId, '⏸ Telegram is paused in agentCloud. Turn it back on in Settings → Telegram.')
    return
  }

  if (text === '/start') return void sendText(chatId, `👋 Hi ${name}! Just send me a message and I'll get to work.`)
  if (text === '/stop') {
    const n = cancelAllTasks() + abortAllChats()
    return void sendText(chatId, n ? `🛑 Stopped ${n} running job${n === 1 ? '' : 's'}.` : 'Nothing was running.')
  }
  if (text === '/new') {
    const manager = agentsRepo.manager()!
    const conv = convRepo.create(manager.id, `Telegram · ${name}`)
    saveChats(chats().map((c) => (c.id === chatId ? { ...c, conversationId: conv.id } : c)))
    emit({ type: 'conversations:changed' })
    return void sendText(chatId, '✨ Started a fresh chat. What can I do for you?')
  }

  const convId = managerConversation(chatId, name)
  const attachments: string[] = []
  try {
    if (m.document) {
      const p = await downloadAttachment(m.document.file_id, m.document.file_name ?? 'file')
      if (p) attachments.push(p)
    } else if (m.photo?.length) {
      const best = m.photo[m.photo.length - 1]
      const p = await downloadAttachment(best.file_id, `photo-${Date.now()}.jpg`)
      if (p) attachments.push(p)
    }
  } catch (e) {
    log.warn('telegram attachment failed', e)
    await sendText(chatId, "⚠️ I couldn't save that file (Telegram only lets bots download files up to 20 MB).")
  }
  if (!text && !attachments.length) return

  // A typed reply while a question is waiting answers that question.
  const q = text && !attachments.length ? pendingQuestion(convId) : null
  if (q) return void answer(q.id, text)

  await sessionFor(convId).send(text || 'Please take a look at the attached file.', attachments.length ? attachments : undefined, 'telegram')
}

// ---------------------------------------------------------------- polling

async function pollLoop(signal: AbortSignal) {
  let offset = settingsRepo.getRaw<number>('telegramOffset', 0)
  running = true
  pushStatus()
  while (!signal.aborted) {
    try {
      const updates = await call<TgUpdate[]>('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] }, signal)
      if (lastError) {
        lastError = null
        pushStatus()
      }
      for (const u of updates) {
        offset = u.update_id + 1
        settingsRepo.setRaw('telegramOffset', offset)
        await handleUpdate(u).catch((e) => log.error('telegram update failed', e))
      }
    } catch (e) {
      if (signal.aborted) break
      const msg = e instanceof Error ? e.message : String(e)
      if (/unauthorized|not found/i.test(msg)) {
        lastError = 'Telegram no longer accepts this bot token. Connect again with a new token.'
        pushStatus()
        break
      }
      lastError = /fetch failed|network|ENOTFOUND|ETIMEDOUT/i.test(msg) ? "Can't reach Telegram right now — retrying…" : msg
      pushStatus()
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
  running = false
  pushStatus()
}

function typingTick() {
  if (!settingsRepo.getAll().telegramEnabled) return
  const busy = busyMap()
  for (const c of chats()) if (c.conversationId in busy) void call('sendChatAction', { chat_id: c.id, action: 'typing' }).catch(() => {})
}

let unsubscribe: (() => void) | null = null

export function startTelegram() {
  if (polling || !getToken()) return
  polling = new AbortController()
  if (!unsubscribe) {
    unsubscribe = onItemPushed((conversationId, item) => {
      if (telegramChatFor(conversationId)) relay(conversationId, item).catch((e) => log.warn('telegram relay failed', e))
    })
  }
  typingTimer = setInterval(typingTick, 4500)
  void pollLoop(polling.signal)
}

export function stopTelegram() {
  polling?.abort()
  polling = null
  if (typingTimer) clearInterval(typingTimer)
  typingTimer = null
}

export async function connectTelegram(token: string): Promise<TelegramStatus> {
  const t = token.trim()
  if (!/^\d+:[\w-]{30,}$/.test(t)) throw new Error('That doesn’t look like a bot token. It looks like 123456789:ABC-def… and comes from @BotFather.')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this computer.')
  const me = await call<{ username: string }>('getMe', {}, undefined, t).catch(() => {
    throw new Error('Telegram didn’t accept that token. Copy it again from @BotFather and paste the whole thing.')
  })
  stopTelegram()
  settingsRepo.setRaw(TOKEN_KEY, safeStorage.encryptString(t).toString('base64'))
  settingsRepo.setRaw(BOT_KEY, me.username)
  settingsRepo.setRaw('telegramOffset', 0)
  settingsRepo.setRaw(CODE_KEY, String(randomInt(100000, 999999)))
  lastError = null
  startTelegram()
  return telegramStatus()
}

export function disconnectTelegram() {
  stopTelegram()
  for (const k of [TOKEN_KEY, BOT_KEY, CODE_KEY, CHATS_KEY, 'telegramOffset']) settingsRepo.deleteRaw(k)
  lastError = null
  pushStatus()
}

export function unlinkTelegramChat(chatId: number): TelegramStatus {
  saveChats(chats().filter((c) => c.id !== chatId))
  pushStatus()
  return telegramStatus()
}

export function newPairingCode(): TelegramStatus {
  settingsRepo.setRaw(CODE_KEY, String(randomInt(100000, 999999)))
  pushStatus()
  return telegramStatus()
}
