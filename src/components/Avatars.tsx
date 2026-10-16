import type { JSX } from 'react'
import { cx, initials } from '@/lib/format'

/** Illustrated manager avatars (hand-drawn SVG characters). */
export const MANAGER_AVATARS = ['drake', 'ava', 'milo', 'robo'] as const

function Drake() {
  return (
    <g>
      <circle cx="50" cy="50" r="50" fill="#F7A51C" />
      <path d="M18 100c2-18 14-28 32-28s30 10 32 28z" fill="#C2410C" />
      <path d="M40 74h20v8c0 6-20 6-20 0z" fill="#F2C29B" />
      <ellipse cx="50" cy="50" rx="22" ry="25" fill="#F7D0AE" />
      <ellipse cx="27.5" cy="52" rx="4" ry="6" fill="#F2C29B" />
      <ellipse cx="72.5" cy="52" rx="4" ry="6" fill="#F2C29B" />
      <path d="M26 46c-2-18 8-28 24-28 15 0 26 8 25 27-4-6-9-9-14-10-7 4-18 5-30 3-2 2-4 5-5 8z" fill="#5B3420" />
      <path d="M33 22c6-6 18-7 26-3-6 0-11 2-14 5z" fill="#7A4A2D" />
      <path d="M32 66c4 10 32 10 36 0-2 9-10 14-18 14s-16-5-18-14z" fill="#5B3420" />
      <g fill="none" stroke="#1F1F1F" strokeWidth="2.6">
        <rect x="31" y="44" width="15" height="12" rx="4" fill="#fff" fillOpacity="0.35" />
        <rect x="54" y="44" width="15" height="12" rx="4" fill="#fff" fillOpacity="0.35" />
        <path d="M46 49h8" />
      </g>
      <circle cx="38.5" cy="50" r="2.4" fill="#1F1F1F" />
      <circle cx="61.5" cy="50" r="2.4" fill="#1F1F1F" />
      <path d="M43 65c4 3 10 3 14 0" stroke="#7A2E14" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M33 41c3-2 7-2 10-1M57 40c3-1 7-1 10 1" stroke="#3B2114" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </g>
  )
}

function Ava() {
  return (
    <g>
      <circle cx="50" cy="50" r="50" fill="#FBBF24" />
      <path d="M22 88c-2-30 2-62 28-64 26 2 30 34 28 64z" fill="#3F2A1D" />
      <path d="M18 100c2-18 14-26 32-26s30 8 32 26z" fill="#9A3412" />
      <path d="M41 72h18v8c0 6-18 6-18 0z" fill="#E8B48C" />
      <ellipse cx="50" cy="50" rx="21" ry="24" fill="#F3C9A3" />
      <path d="M28 46c0-16 10-24 22-24s22 8 22 22c-10 0-22-4-28-12-3 6-9 11-16 14z" fill="#3F2A1D" />
      <circle cx="41" cy="52" r="2.6" fill="#1F1F1F" />
      <circle cx="59" cy="52" r="2.6" fill="#1F1F1F" />
      <circle cx="36" cy="60" r="3.5" fill="#F59E8B" opacity="0.6" />
      <circle cx="64" cy="60" r="3.5" fill="#F59E8B" opacity="0.6" />
      <path d="M44 64c3 3 9 3 12 0" stroke="#9F3A22" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </g>
  )
}

function Milo() {
  return (
    <g>
      <circle cx="50" cy="50" r="50" fill="#FB923C" />
      <path d="M18 100c2-18 14-26 32-26s30 8 32 26z" fill="#1E3A8A" />
      <path d="M41 72h18v8c0 6-18 6-18 0z" fill="#B97B4E" />
      <ellipse cx="50" cy="52" rx="21" ry="23" fill="#C98B5B" />
      <path d="M27 44c0-14 10-22 23-22s23 8 23 22z" fill="#1F2937" />
      <path d="M25 44h52c2 0 2 5 0 5H25c-2 0-2-5 0-5z" fill="#111827" />
      <circle cx="42" cy="55" r="2.6" fill="#1F1F1F" />
      <circle cx="58" cy="55" r="2.6" fill="#1F1F1F" />
      <path d="M43 65c4 4 10 4 14 0" stroke="#5A2A12" strokeWidth="2.6" fill="none" strokeLinecap="round" />
    </g>
  )
}

function Robo() {
  return (
    <g>
      <circle cx="50" cy="50" r="50" fill="#F7A51C" />
      <rect x="47" y="12" width="6" height="12" rx="3" fill="#3A3A3A" />
      <circle cx="50" cy="12" r="5" fill="#EF4444" />
      <rect x="22" y="26" width="56" height="46" rx="14" fill="#E5E7EB" />
      <rect x="30" y="36" width="40" height="22" rx="10" fill="#1F2937" />
      <circle cx="41" cy="47" r="4.5" fill="#F7A51C" />
      <circle cx="59" cy="47" r="4.5" fill="#F7A51C" />
      <rect x="16" y="40" width="7" height="16" rx="3" fill="#9CA3AF" />
      <rect x="77" y="40" width="7" height="16" rx="3" fill="#9CA3AF" />
      <path d="M26 100c0-16 10-24 24-24s24 8 24 24z" fill="#9CA3AF" />
    </g>
  )
}

const ART: Record<string, () => JSX.Element> = { drake: Drake, ava: Ava, milo: Milo, robo: Robo }

export function ManagerAvatar({ avatar, size = 64, badge = false, className }: { avatar: string; size?: number; badge?: boolean; className?: string }) {
  const Art = ART[avatar] ?? Drake
  return (
    <div className={cx('relative shrink-0', className)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} className="rounded-full overflow-hidden" aria-hidden>
        <defs>
          <clipPath id={`clip-${avatar}`}>
            <circle cx="50" cy="50" r="50" />
          </clipPath>
        </defs>
        <g clipPath={`url(#clip-${avatar})`}>
          <Art />
        </g>
      </svg>
      {badge && (
        <span
          className="absolute rounded-full bg-accent border-2 border-sidebar flex items-center justify-center"
          style={{ width: size * 0.3, height: size * 0.3, right: -1, bottom: 1 }}
        >
          <svg viewBox="0 0 24 24" width={size * 0.17} height={size * 0.17} fill="#fff">
            <path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7.1L12 17.3 5.8 21l1.6-7.1L2 9.2l7.1-.6z" />
          </svg>
        </span>
      )}
    </div>
  )
}

/** The orange agent "blob" with eyes, like the reference sidebar item. */
export function AgentBlob({ color = '#F7A51C', size = 40 }: { color?: string; size?: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden>
      <path d="M24 5c3.2 0 5 1.8 6.7 4.8l12.6 22.7c3 5.4.4 10.5-6 10.5H10.7c-6.4 0-9-5.1-6-10.5L17.3 9.8C19 6.8 20.8 5 24 5z" fill={color} />
      <rect x="18" y="24" width="4" height="9" rx="2" fill="#1a1206" />
      <rect x="26" y="24" width="4" height="9" rx="2" fill="#1a1206" />
    </svg>
  )
}

export function AgentAvatar({ avatar, color, size = 40, glow = false }: { avatar: string; color: string; size?: number; glow?: boolean }) {
  const isEmoji = avatar && avatar !== 'blob' && !/^[a-z]+$/.test(avatar)
  if (!isEmoji && ART[avatar]) return <ManagerAvatar avatar={avatar} size={size} />
  return (
    <div className={cx('shrink-0 flex items-center justify-center rounded-xl', glow && 'glow-pulse')} style={{ width: size, height: size }}>
      {isEmoji ? (
        <div className="w-full h-full rounded-xl flex items-center justify-center" style={{ background: color, fontSize: size * 0.52 }}>
          <span style={{ filter: 'saturate(0.9)' }}>{avatar}</span>
        </div>
      ) : (
        <AgentBlob color={color} size={size} />
      )}
    </div>
  )
}

export function UserAvatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <div
      className="rounded-full bg-card border border-line flex items-center justify-center font-semibold text-fg-2 shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials(name || 'Me')}
    </div>
  )
}
