import { ExternalLink, FileText, FolderOpen } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/lib/ipc'

export type MediaKind = 'image' | 'video' | 'audio' | 'document'

const KINDS: Record<string, MediaKind> = {}
for (const e of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif']) KINDS[e] = 'image'
for (const e of ['mp4', 'webm', 'mov', 'm4v', 'ogv']) KINDS[e] = 'video'
for (const e of ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac']) KINDS[e] = 'audio'
for (const e of ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'txt', 'md', 'rtf', 'odt', 'ods', 'odp', 'html', 'json', 'zip']) KINDS[e] = 'document'

const extOf = (p: string) => /\.([a-z0-9]+)$/i.exec(p.split(/[?#]/)[0])?.[1]?.toLowerCase() ?? ''
function cleanPath(p: string): string {
  const s = p.replace(/^file:\/\//, '').replace(/^\/+(?=[A-Za-z]:)/, '')
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export function mediaKind(p: string): MediaKind | null {
  return KINDS[extOf(p)] ?? null
}

/** URL the window can load a local file from (served by the main process). */
export function mediaUrl(p: string): string {
  return `acfile://media/?p=${encodeURIComponent(cleanPath(p))}`
}

const fileName = (p: string) => cleanPath(p).split(/[\\/]/).pop() || p

/** Shows a picture, video or sound inline, or a small card for documents. Built from spans so it can sit inside a paragraph. */
export function MediaPreview({ path, name, compact }: { path: string; name?: string; compact?: boolean }) {
  const [broken, setBroken] = useState(false)
  const kind = mediaKind(path)
  if (!kind) return null
  const title = name || fileName(path)
  if (!broken && kind === 'image') {
    return (
      <span className="block my-2">
        <img
          src={mediaUrl(path)}
          alt={title}
          title={`${title} — click to open`}
          onError={() => setBroken(true)}
          onClick={() => api.openPath(cleanPath(path))}
          className={compact ? 'max-h-[120px] max-w-[200px] rounded-lg border border-line cursor-zoom-in object-cover' : 'max-h-[420px] max-w-full rounded-xl border border-line cursor-zoom-in'}
        />
      </span>
    )
  }
  if (!broken && kind === 'video') {
    return (
      <span className="block my-2">
        <video src={mediaUrl(path)} controls preload="metadata" onError={() => setBroken(true)} className="max-h-[420px] max-w-full rounded-xl border border-line bg-black" />
      </span>
    )
  }
  if (!broken && kind === 'audio') {
    return (
      <span className="block my-2">
        <audio src={mediaUrl(path)} controls preload="metadata" onError={() => setBroken(true)} className="w-full max-w-[420px]" />
      </span>
    )
  }
  return <FileCard path={path} title={title} missing={broken} />
}

function FileCard({ path, title, missing }: { path: string; title: string; missing?: boolean }) {
  const ext = extOf(path)
  return (
    <span className="my-2 flex items-center gap-3 max-w-[420px] rounded-xl border border-line bg-bg-raised px-3 py-2.5 not-prose">
      <span className="w-9 h-9 rounded-lg bg-accent-soft text-accent flex items-center justify-center shrink-0"><FileText size={18} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] text-fg font-medium">{title}</span>
        <span className="block text-[12px] text-muted">{missing ? "Can't show this file" : ext ? `${ext.toUpperCase()} file` : 'File'}</span>
      </span>
      <button title="Open" onClick={() => api.openPath(cleanPath(path))} className="text-fg-2 hover:text-fg p-1"><ExternalLink size={15} /></button>
      <button title="Show in folder" onClick={() => api.showInFolder(cleanPath(path))} className="text-fg-2 hover:text-fg p-1"><FolderOpen size={15} /></button>
    </span>
  )
}
