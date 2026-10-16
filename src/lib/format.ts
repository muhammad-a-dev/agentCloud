export function timeLabel(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const sameDay = d.toDateString() === now.toDateString()
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (sameDay) return `Today ${time}`
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })} ${time}`
}

export function elapsed(from: number | null, to?: number | null): string {
  if (!from) return ''
  const s = Math.max(0, Math.floor(((to ?? Date.now()) - from) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export function relative(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'ME'
  return (parts[0][0] + (parts[1]?.[0] ?? parts[0][1] ?? '')).toUpperCase()
}

export function money(n: number): string {
  return n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`
}

export function compact(n: number): string {
  return Intl.NumberFormat([], { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')
