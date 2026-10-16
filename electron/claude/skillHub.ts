// Finds and downloads skills from the open skills catalog (skills.sh) with the `skills` command-line tool.
import { spawn } from 'child_process'
import { listSkills } from './config'
import { log } from '../logging'

export const FIND_SKILLS = 'find-skills'
const FIND_SKILLS_SOURCE = 'vercel-labs/skills@find-skills'

export interface CatalogSkill {
  /** Install id, e.g. "anthropics/skills@xlsx". */
  id: string
  installs: number
  url?: string
}

// Only plain names reach the shell, so nothing in them can be read as a command.
const SOURCE_RE = /^[\w.-]+(?:\/[\w.-]+)*$/
const SKILL_RE = /^[\w .:-]+$/

function runSkillsCli(args: string[], timeout: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const win = process.platform === 'win32'
    const quoted = win ? args.map((a) => (/\s/.test(a) ? `"${a}"` : a)) : args
    const child = spawn(win ? 'npx.cmd' : 'npx', ['-y', 'skills', ...quoted], {
      shell: win, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', CI: '1' }
    })
    let out = ''
    const timer = setTimeout(() => child.kill(), timeout)
    child.stdout.on('data', (d) => (out += String(d)))
    child.stderr.on('data', (d) => (out += String(d)))
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: -1, out: `${out}\n${e.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, out: out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '') })
    })
  })
}

function parseInstalls(s: string): number {
  const m = /^([\d.,]+)\s*([KMB]?)$/i.exec(s.trim())
  if (!m) return 0
  const n = parseFloat(m[1].replace(/,/g, ''))
  return Math.round(n * ({ K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase()] ?? 1))
}

/** Searches the online catalog. Results are sorted by install count, most popular first. */
export async function searchCatalog(query: string): Promise<CatalogSkill[]> {
  const words = query.replace(/[^\w .-]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 6)
  if (!words.length) return []
  const r = await runSkillsCli(['find', ...words], 90000)
  const lines = r.out.split(/\r?\n/).map((l) => l.trim())
  const out: CatalogSkill[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\S.*?@.+?)\s+([\d.,]+\s*[KMB]?) installs?$/i.exec(lines[i])
    if (!m) continue
    const url = /(https:\/\/skills\.sh\/\S+)/.exec(lines[i + 1] ?? '')?.[1]
    out.push({ id: m[1], installs: parseInstalls(m[2]), url })
  }
  if (!out.length && r.code !== 0) {
    log.warn('skills find failed', r.out.slice(-500))
    throw new Error("Couldn't reach the online skills catalog.")
  }
  return out.sort((a, b) => b.installs - a.installs)
}

let queue: Promise<unknown> = Promise.resolve()

/** Downloads a catalog skill into ~/.claude/skills and returns its installed name. */
export function installFromCatalog(id: string): Promise<string> {
  const run = async () => {
    const at = id.lastIndexOf('@')
    const source = id.slice(0, at)
    const skill = id.slice(at + 1).trim()
    if (at <= 0 || !SOURCE_RE.test(source) || !SKILL_RE.test(skill)) throw new Error(`"${id}" is not a valid skill id (expected owner/repo@skill).`)
    const before = new Set(listSkills().map((s) => s.name))
    const slug = skill.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const add = (name: string) => runSkillsCli(['add', source, '--skill', name, '-g', '-a', 'claude-code', '-y', '--copy'], 180000)
    let picked = skill
    let r = await add(skill)
    if (/No matching skills found/i.test(r.out)) {
      // The catalog name doesn't always match the name inside the repository: pick the closest one it offers.
      const available = [...r.out.slice(r.out.search(/Available skills/i)).matchAll(/^[│|\s]*-\s+(\S[^\r\n]*?)\s*$/gm)].map((m) => m[1])
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
      const pick = available.find((a) => norm(a) === norm(skill))
        ?? available.find((a) => norm(skill).includes(norm(a)) || norm(a).includes(norm(skill)))
        ?? (available.length === 1 ? available[0] : undefined)
      if (pick && SKILL_RE.test(pick)) {
        picked = pick
        r = await add(pick)
      }
    }
    const after = listSkills()
    const added = after.find((s) => !before.has(s.name))
    if (added) return added.name
    const existing = after.find((s) => s.name === picked || s.name === skill || s.name.toLowerCase() === slug)
    if (existing) return existing.name
    log.warn('skills add failed', id, r.out.slice(-800))
    throw new Error(`Couldn't download the skill ${id}.`)
  }
  const p = queue.then(run, run)
  queue = p.catch(() => {})
  return p
}

export function hasFindSkills(): boolean {
  return listSkills().some((s) => s.name === FIND_SKILLS && s.enabled)
}

/** Makes sure the Manager's find-skills skill is installed. Runs quietly in the background at startup. */
export async function ensureFindSkills() {
  if (listSkills().some((s) => s.name === FIND_SKILLS)) return
  try {
    await installFromCatalog(FIND_SKILLS_SOURCE)
    log.info('installed the find-skills skill')
  } catch (e) {
    log.warn('could not install find-skills', e)
  }
}
