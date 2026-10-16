import { app } from 'electron'
import fs from 'fs'
import path from 'path'

const MAX_BYTES = 2 * 1024 * 1024
const MAX_FILES = 5
let logDir = ''

export function logsPath(): string {
  if (!logDir) {
    logDir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(logDir, { recursive: true })
  }
  return logDir
}

function rotate(file: string) {
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size < MAX_BYTES) return
    for (let i = MAX_FILES - 1; i >= 1; i--) {
      const src = `${file}.${i}`
      if (fs.existsSync(src)) fs.renameSync(src, `${file}.${i + 1}`)
    }
    fs.renameSync(file, `${file}.1`)
    const oldest = `${file}.${MAX_FILES}`
    if (fs.existsSync(oldest)) fs.unlinkSync(oldest)
  } catch {
    /* never let logging crash the app */
  }
}

function write(level: string, args: unknown[]) {
  const line = `${new Date().toISOString()} [${level}] ${args
    .map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === 'string' ? a : safeJson(a)))
    .join(' ')}\n`
  try {
    const file = path.join(logsPath(), 'main.log')
    rotate(file)
    fs.appendFileSync(file, line)
  } catch {
    /* ignore */
  }
  if (!app.isPackaged) (level === 'ERROR' ? console.error : console.log)(line.trimEnd())
}

function safeJson(v: unknown) {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export const log = {
  info: (...a: unknown[]) => write('INFO', a),
  warn: (...a: unknown[]) => write('WARN', a),
  error: (...a: unknown[]) => write('ERROR', a)
}

export function readRecentLog(maxChars = 20000): string {
  try {
    const t = fs.readFileSync(path.join(logsPath(), 'main.log'), 'utf8')
    return t.slice(-maxChars)
  } catch {
    return ''
  }
}
