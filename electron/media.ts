// Pictures, videos and documents shown in the chat: saves screenshots from tools and serves local files to the window.
import { app, protocol } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import type { MediaRef } from '@shared/types'
import { settingsRepo } from './db/repos'
import { log } from './logging'

export const MEDIA_SCHEME = 'acfile'

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac'
}
const EXT_FOR: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' }

/** Turns a chat path (relative to the workspace, absolute, or a file:// link) into a full path. */
export function workspacePath(p: string): string {
  const ws = settingsRepo.getAll().workspace ?? ''
  const clean = p.replace(/^file:\/\//, '').replace(/^\/+(?=[A-Za-z]:)/, '')
  return path.isAbsolute(clean) ? clean : path.join(ws, decodeURIComponent(clean))
}

function mediaDir(): string {
  const dir = path.join(app.getPath('userData'), 'media')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Saves the pictures inside a tool result (e.g. a browser screenshot) so the chat can show them. */
export function mediaFromToolResult(toolName: string, input: Record<string, unknown>, content: unknown): MediaRef[] {
  if (!Array.isArray(content)) return []
  const images = content.filter((c): c is { type: 'image'; source: { type: string; media_type?: string; data?: string } } => c?.type === 'image' && c.source?.type === 'base64' && typeof c.source.data === 'string')
  if (!images.length) return []
  // Reading an image file: show the original file instead of a copy.
  if (toolName === 'Read' && typeof input.file_path === 'string' && MIME[path.extname(input.file_path).toLowerCase()]) {
    return [{ path: input.file_path, name: path.basename(input.file_path) }]
  }
  const out: MediaRef[] = []
  for (const img of images) {
    try {
      const ext = EXT_FOR[img.source.media_type ?? ''] ?? '.png'
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      const file = path.join(mediaDir(), `screenshot-${stamp}-${randomUUID().slice(0, 6)}${ext}`)
      fs.writeFileSync(file, Buffer.from(img.source.data!, 'base64'))
      out.push({ path: file, name: 'Screenshot' })
    } catch (e) {
      log.warn('could not save tool image', e)
    }
  }
  return out
}

export function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])
}

/** Serves acfile://media/?p=<path> — only picture, video and sound files, with byte ranges so videos can seek. */
export function handleMediaProtocol() {
  protocol.handle(MEDIA_SCHEME, async (req) => {
    try {
      const p = new URL(req.url).searchParams.get('p') ?? ''
      const full = workspacePath(p)
      const type = MIME[path.extname(full).toLowerCase()]
      if (!type || !fs.existsSync(full)) return new Response('Not found', { status: 404 })
      const size = fs.statSync(full).size
      const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') ?? '')
      if (range && size > 0) {
        let start = range[1] ? Number(range[1]) : size - Number(range[2] || 0)
        let end = range[1] && range[2] ? Number(range[2]) : size - 1
        start = Math.max(0, Math.min(start, size - 1))
        end = Math.max(start, Math.min(end, size - 1))
        const body = Readable.toWeb(fs.createReadStream(full, { start, end })) as ReadableStream
        return new Response(body, {
          status: 206,
          headers: { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' }
        })
      }
      const body = Readable.toWeb(fs.createReadStream(full)) as ReadableStream
      return new Response(body, { headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } })
    } catch (e) {
      log.warn('media request failed', e)
      return new Response('Error', { status: 500 })
    }
  })
}
