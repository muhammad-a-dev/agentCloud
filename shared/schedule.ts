// Schedule timing, shared by the main process (to run jobs) and the window (to preview them).
import type { Schedule } from './types'

function hm(time: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  const h = m ? Math.min(23, Number(m[1])) : 9
  const min = m ? Math.min(59, Number(m[2])) : 0
  return [h, min]
}

/** The next time this schedule should run after `from`, in local time, or null if it never will. */
export function nextRun(s: Pick<Schedule, 'repeat' | 'time' | 'date' | 'weekday' | 'dayOfMonth'>, from = Date.now()): number | null {
  const [h, m] = hm(s.time)
  if (s.repeat === 'once') {
    if (!s.date) return null
    const [y, mo, d] = s.date.split('-').map(Number)
    const at = new Date(y, mo - 1, d, h, m, 0, 0).getTime()
    return at > from ? at : null
  }
  if (s.repeat === 'hourly') {
    const d = new Date(from)
    d.setMinutes(m, 0, 0)
    if (d.getTime() <= from) d.setHours(d.getHours() + 1)
    return d.getTime()
  }
  const d = new Date(from)
  d.setHours(h, m, 0, 0)
  for (let i = 0; i < 400; i++) {
    const ok =
      s.repeat === 'daily' ||
      (s.repeat === 'weekdays' && d.getDay() >= 1 && d.getDay() <= 5) ||
      (s.repeat === 'weekly' && d.getDay() === s.weekday) ||
      (s.repeat === 'monthly' && d.getDate() === s.dayOfMonth)
    if (ok && d.getTime() > from) return d.getTime()
    d.setDate(d.getDate() + 1)
    d.setHours(h, m, 0, 0)
  }
  return null
}

/** Plain-words description, e.g. "Every weekday at 9:00". */
export function describeRepeat(s: Pick<Schedule, 'repeat' | 'time' | 'date' | 'weekday' | 'dayOfMonth'>): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  switch (s.repeat) {
    case 'once': return `Once on ${s.date} at ${s.time}`
    case 'hourly': return `Every hour at :${s.time.split(':')[1] ?? '00'}`
    case 'daily': return `Every day at ${s.time}`
    case 'weekdays': return `Every weekday at ${s.time}`
    case 'weekly': return `Every ${days[s.weekday] ?? 'Monday'} at ${s.time}`
    case 'monthly': return `Every month on day ${s.dayOfMonth} at ${s.time}`
  }
}
