import type { JSX } from 'react'
import { cx, initials } from '@/lib/format'

/** Illustrated avatars (hand-drawn SVG characters), usable for the Manager, agents and the user. */
export const MANAGER_AVATARS = [
  'drake', 'ava', 'milo', 'robo', 'zara', 'leo', 'nova', 'kai', 'ivy', 'omar', 'sam', 'ben', 'fox', 'cat', 'owl', 'panda', 'alien'
] as const

/** An uploaded picture, stored as a small data URL. */
export const isImageAvatar = (a: string | undefined | null) => !!a && a.startsWith('data:image/')

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

type PersonLook = {
  bg: string; skin: string; hair: string; shirt: string
  style: 'short' | 'long' | 'bun' | 'curly' | 'bald' | 'spiky'
  glasses?: boolean; beard?: boolean; blush?: boolean
}

function Person(p: PersonLook) {
  return (
    <g>
      <circle cx="50" cy="50" r="50" fill={p.bg} />
      {p.style === 'long' && <path d="M22 92c-4-32 0-66 28-68 28 2 32 36 28 68z" fill={p.hair} />}
      {p.style === 'curly' && <path d="M20 70c-6-30 6-50 30-50s36 20 30 50z" fill={p.hair} />}
      <path d="M18 100c2-18 14-26 32-26s30 8 32 26z" fill={p.shirt} />
      <path d="M41 71h18v9c0 6-18 6-18 0z" fill={p.skin} />
      <path d="M41 71h18v5c-6 3-12 3-18 0z" fill="#000" opacity="0.12" />
      <ellipse cx="28.5" cy="53" rx="4" ry="6" fill={p.skin} />
      <ellipse cx="71.5" cy="53" rx="4" ry="6" fill={p.skin} />
      <ellipse cx="50" cy="51" rx="21" ry="24" fill={p.skin} />
      {p.style === 'short' && <path d="M28 47c-1-17 9-26 22-26s23 9 22 26c-3-7-8-11-14-12-8 3-19 4-30 12z" fill={p.hair} />}
      {p.style === 'long' && <path d="M28 47c0-17 10-25 22-25s22 8 22 23c-10 0-22-4-28-12-3 6-9 11-16 14z" fill={p.hair} />}
      {p.style === 'bun' && (
        <>
          <circle cx="50" cy="19" r="9" fill={p.hair} />
          <path d="M28 47c0-17 10-25 22-25s22 8 22 25c-6-9-13-13-22-13s-16 4-22 13z" fill={p.hair} />
        </>
      )}
      {p.style === 'curly' && (
        <g fill={p.hair}>
          {[[32, 34], [40, 27], [50, 24], [60, 27], [68, 34], [72, 43], [28, 43]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="8" />)}
        </g>
      )}
      {p.style === 'spiky' && <path d="M27 46l3-14 6 5 3-11 6 7 5-10 5 10 6-7 3 11 6-5 3 14c-8-6-15-8-23-8s-15 2-23 8z" fill={p.hair} />}
      {p.style === 'bald' && <path d="M31 38c4-9 11-13 19-13s15 4 19 13c-6-4-12-6-19-6s-13 2-19 6z" fill="#fff" opacity="0.18" />}
      {p.beard && <path d="M30 58c2 14 10 21 20 21s18-7 20-21c-4 6-10 8-20 8s-16-2-20-8z" fill={p.hair} />}
      <circle cx="42" cy="53" r="2.6" fill="#1F1F1F" />
      <circle cx="58" cy="53" r="2.6" fill="#1F1F1F" />
      {p.glasses && (
        <g fill="none" stroke="#1F1F1F" strokeWidth="2.4">
          <circle cx="42" cy="53" r="6.5" fill="#fff" fillOpacity="0.25" />
          <circle cx="58" cy="53" r="6.5" fill="#fff" fillOpacity="0.25" />
          <path d="M48.5 53h3" />
        </g>
      )}
      {p.blush && (
        <>
          <circle cx="36" cy="61" r="3.5" fill="#F59E8B" opacity="0.55" />
          <circle cx="64" cy="61" r="3.5" fill="#F59E8B" opacity="0.55" />
        </>
      )}
      <path d={p.beard ? 'M44 64c3 2 9 2 12 0' : 'M44 64c3 3 9 3 12 0'} stroke="#7A2E14" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </g>
  )
}

const PEOPLE: Record<string, PersonLook> = {
  zara: { bg: '#F59E0B', skin: '#8D5A3B', hair: '#1C1917', shirt: '#0F766E', style: 'long', blush: true },
  leo: { bg: '#FDBA74', skin: '#F1C7A3', hair: '#7C2D12', shirt: '#1D4ED8', style: 'short', glasses: true, beard: true },
  nova: { bg: '#FB923C', skin: '#E0AC85', hair: '#312E81', shirt: '#BE185D', style: 'bun', blush: true },
  kai: { bg: '#FBBF24', skin: '#D9A07A', hair: '#111827', shirt: '#065F46', style: 'spiky' },
  ivy: { bg: '#F97316', skin: '#F6D2B8', hair: '#B91C1C', shirt: '#4338CA', style: 'long', glasses: true, blush: true },
  omar: { bg: '#EAB308', skin: '#A8724F', hair: '#1F2937', shirt: '#7C3AED', style: 'short', beard: true },
  sam: { bg: '#F7A51C', skin: '#6B4430', hair: '#0C0A09', shirt: '#DC2626', style: 'curly' },
  ben: { bg: '#FCD34D', skin: '#EBC09B', hair: '#57534E', shirt: '#334155', style: 'bald', beard: true, glasses: true }
}

function Fox() {
  return (
    <g>
      <circle cx="50" cy="50" r="50" fill="#FDE68A" />
      <path d="M22 18l14 26-20 2zM78 18L64 44l20 2z" fill="#EA580C" />
      <path d="M26 26l8 16-11 1zM74 26l-8 16 11 1z" fill="#FED7AA" />
      <path d="M16 46c4-16 18-24 34-24s30 8 34 24c-2 22-16 36-34 40-18-4-32-18-34-40z" fill="#F97316" />
      <path d="M50 86c-10-2-20-10-24-22 8 4 16 6 24 14 8-8 16-10 24-14-4 12-14 20-24 22z" fill="#FFF7ED" />
      <circle cx="39" cy="52" r="3" fill="#1F1F1F" />
      <circle cx="61" cy="52" r="3" fill="#1F1F1F" />
      <ellipse cx="50" cy="68" rx="4.5" ry="3.2" fill="#1F1F1F" />
    </g>
  )
}

function Cat() {
  return (
    <g>
      <circle cx="50" cy="50" r="50" fill="#FBBF24" />
      <path d="M24 22l10 22-16 4zM76 22L66 44l16 4z" fill="#57534E" />
      <ellipse cx="50" cy="58" rx="32" ry="28" fill="#78716C" />
      <path d="M44 34h4v12h-4zM52 34h4v12h-4z" fill="#57534E" />
      <ellipse cx="38" cy="56" rx="6" ry="7" fill="#FDE68A" />
      <ellipse cx="62" cy="56" rx="6" ry="7" fill="#FDE68A" />
      <ellipse cx="38" cy="57" rx="2" ry="5" fill="#1F1F1F" />
      <ellipse cx="62" cy="57" rx="2" ry="5" fill="#1F1F1F" />
      <path d="M47 67h6l-3 3z" fill="#FDA4AF" />
      <path d="M50 70c-2 4-6 4-8 2M50 70c2 4 6 4 8 2M28 66h-12M28 70l-11 3M72 66h12M72 70l11 3" stroke="#E7E5E4" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </g>
  )
}

function Owl() {
  return (
    <g>
      <circle cx="50" cy="50" r="50" fill="#FB923C" />
      <path d="M22 30l12 8M78 30l-12 8" stroke="#7C2D12" strokeWidth="5" strokeLinecap="round" />
      <ellipse cx="50" cy="60" rx="30" ry="32" fill="#92400E" />
      <ellipse cx="50" cy="72" rx="18" ry="18" fill="#FDE68A" />
      <circle cx="38" cy="50" r="11" fill="#FFF7ED" />
      <circle cx="62" cy="50" r="11" fill="#FFF7ED" />
      <circle cx="38" cy="50" r="5" fill="#1F1F1F" />
      <circle cx="62" cy="50" r="5" fill="#1F1F1F" />
      <path d="M46 58l4 7 4-7z" fill="#F59E0B" />
    </g>
  )
}

function Panda() {
  return (
    <g>
      <circle cx="50" cy="50" r="50" fill="#FCD34D" />
      <circle cx="26" cy="30" r="10" fill="#1F1F1F" />
      <circle cx="74" cy="30" r="10" fill="#1F1F1F" />
      <ellipse cx="50" cy="56" rx="31" ry="29" fill="#FAFAF9" />
      <ellipse cx="39" cy="54" rx="7" ry="9" fill="#1F1F1F" transform="rotate(-20 39 54)" />
      <ellipse cx="61" cy="54" rx="7" ry="9" fill="#1F1F1F" transform="rotate(20 61 54)" />
      <circle cx="40" cy="53" r="2.4" fill="#fff" />
      <circle cx="60" cy="53" r="2.4" fill="#fff" />
      <ellipse cx="50" cy="66" rx="4" ry="3" fill="#1F1F1F" />
      <path d="M45 72c3 2 7 2 10 0" stroke="#1F1F1F" strokeWidth="2" fill="none" strokeLinecap="round" />
    </g>
  )
}

function Alien() {
  return (
    <g>
      <circle cx="50" cy="50" r="50" fill="#F7A51C" />
      <path d="M36 20l-6-10M64 20l6-10" stroke="#65A30D" strokeWidth="3" strokeLinecap="round" />
      <circle cx="30" cy="10" r="4" fill="#A3E635" />
      <circle cx="70" cy="10" r="4" fill="#A3E635" />
      <path d="M50 18c20 0 30 14 30 30 0 20-16 36-30 36S20 68 20 48c0-16 10-30 30-30z" fill="#84CC16" />
      <ellipse cx="38" cy="50" rx="9" ry="12" fill="#1F1F1F" transform="rotate(-18 38 50)" />
      <ellipse cx="62" cy="50" rx="9" ry="12" fill="#1F1F1F" transform="rotate(18 62 50)" />
      <circle cx="36" cy="46" r="2.5" fill="#fff" />
      <circle cx="60" cy="46" r="2.5" fill="#fff" />
      <path d="M44 70c4 3 8 3 12 0" stroke="#365314" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </g>
  )
}

const ART: Record<string, () => JSX.Element> = {
  drake: Drake, ava: Ava, milo: Milo, robo: Robo, fox: Fox, cat: Cat, owl: Owl, panda: Panda, alien: Alien,
  ...Object.fromEntries(Object.entries(PEOPLE).map(([k, look]) => [k, () => <Person {...look} />]))
}

export const isArtAvatar = (a: string | undefined | null) => !!a && a in ART

export function ManagerAvatar({ avatar, size = 64, badge = false, className }: { avatar: string; size?: number; badge?: boolean; className?: string }) {
  const Art = ART[avatar] ?? Drake
  return (
    <div className={cx('relative shrink-0', className)} style={{ width: size, height: size }}>
      {isImageAvatar(avatar) ? (
        <img src={avatar} alt="" width={size} height={size} className="rounded-full object-cover w-full h-full" draggable={false} />
      ) : (
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
      )}
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
  if (isImageAvatar(avatar)) {
    return <img src={avatar} alt="" className={cx('shrink-0 rounded-xl object-cover', glow && 'glow-pulse')} style={{ width: size, height: size }} draggable={false} />
  }
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

export function UserAvatar({ name, avatar, size = 40 }: { name: string; avatar?: string; size?: number }) {
  if (avatar && (isImageAvatar(avatar) || ART[avatar])) return <ManagerAvatar avatar={avatar} size={size} />
  return (
    <div
      className="rounded-full bg-card border border-line flex items-center justify-center font-semibold text-fg-2 shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials(name || 'Me')}
    </div>
  )
}
