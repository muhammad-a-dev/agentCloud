import { ImagePlus } from 'lucide-react'
import { useRef } from 'react'
import { cx } from '@/lib/format'
import { MANAGER_AVATARS, ManagerAvatar, isImageAvatar } from './Avatars'

/** Shrinks an uploaded picture to a 256px square (cropped to the middle) so it stays small. */
export function imageFileToAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Please pick a picture (PNG, JPG, GIF or WebP).'))
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight)
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 256
      canvas.getContext('2d')!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/webp', 0.9))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("That picture couldn't be opened."))
    }
    img.src = url
  })
}

/** Grid of illustrated avatars plus an "Upload your own" tile. */
export function AvatarPicker({ value, onChange, size = 40, onError, allowNone }: {
  value: string
  onChange: (v: string) => void
  size?: number
  onError?: (msg: string) => void
  /** Show a "no picture" option (initials), used for the user's own avatar. */
  allowNone?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const ring = (on: boolean) => cx('rounded-full p-0.5 border-2 transition', on ? 'border-accent' : 'border-transparent hover:border-line-strong')
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {allowNone !== undefined && (
        <button type="button" aria-label="No picture" title="Just my initials" onClick={() => onChange('')} className={ring(!value)}>
          <span className="rounded-full bg-card border border-line flex items-center justify-center font-semibold text-fg-2" style={{ width: size, height: size, fontSize: size * 0.36 }}>{allowNone}</span>
        </button>
      )}
      {isImageAvatar(value) && (
        <span className={ring(true)} title="Your picture">
          <ManagerAvatar avatar={value} size={size} />
        </span>
      )}
      {MANAGER_AVATARS.map((a) => (
        <button type="button" key={a} aria-label={`Avatar ${a}`} onClick={() => onChange(a)} className={ring(value === a)}>
          <ManagerAvatar avatar={a} size={size} />
        </button>
      ))}
      <button
        type="button"
        onClick={() => input.current?.click()}
        title="Upload your own picture"
        aria-label="Upload your own picture"
        className="ml-0.5 rounded-full border-2 border-dashed border-line-strong hover:border-accent hover:text-accent text-fg-2 flex items-center justify-center transition"
        style={{ width: size + 4, height: size + 4 }}
      >
        <ImagePlus size={Math.max(14, Math.round(size * 0.4))} />
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          try {
            onChange(await imageFileToAvatar(f))
          } catch (err) {
            onError?.(err instanceof Error ? err.message : String(err))
          }
        }}
      />
    </div>
  )
}
