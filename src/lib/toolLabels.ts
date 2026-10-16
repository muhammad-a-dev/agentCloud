import type { LucideIcon } from 'lucide-react'
import { Bot, ClipboardList, FilePen, FilePlus2, FileText, Globe, ListChecks, Play, Search, Sparkles, SquareTerminal, UserPlus, UserMinus, Wrench, FolderSearch, CircleSlash } from 'lucide-react'

const base = (p: unknown) => (typeof p === 'string' ? p.split(/[\/]/).pop() ?? p : '')
const host = (u: unknown) => {
  try {
    return new URL(String(u)).hostname.replace(/^www\./, '')
  } catch {
    return 'a web page'
  }
}

export interface ToolLabel {
  icon: LucideIcon
  verb: string
  target?: string
  technical: string
}

export function toolLabel(name: string, input: Record<string, unknown>): ToolLabel {
  const short = name.replace(/^mcp__agentcloud__/, '')
  switch (short) {
    case 'Write': return { icon: FilePlus2, verb: 'Created', target: base(input.file_path), technical: name }
    case 'Edit':
    case 'NotebookEdit': return { icon: FilePen, verb: 'Edited', target: base(input.file_path ?? input.notebook_path), technical: name }
    case 'Read': return { icon: FileText, verb: 'Read', target: base(input.file_path), technical: name }
    case 'Glob':
    case 'Grep': return { icon: FolderSearch, verb: 'Looked through files', target: String(input.pattern ?? ''), technical: name }
    case 'WebSearch': return { icon: Search, verb: 'Searched the web for', target: `“${String(input.query ?? '')}”`, technical: name }
    case 'WebFetch': return { icon: Globe, verb: 'Opened', target: host(input.url), technical: name }
    case 'Bash':
    case 'PowerShell': return { icon: SquareTerminal, verb: 'Ran a command', target: input.description ? String(input.description) : undefined, technical: name }
    case 'Task': return { icon: Bot, verb: 'Asked a helper to', target: String(input.description ?? 'help'), technical: name }
    case 'Skill': return { icon: Sparkles, verb: 'Used the skill', target: String(input.skill ?? input.command ?? ''), technical: name }
    case 'TodoWrite': return { icon: ListChecks, verb: 'Updated the plan', technical: name }
    case 'hire_agent': return { icon: UserPlus, verb: 'Hired', target: String(input.name ?? 'a new agent'), technical: 'hire_agent' }
    case 'fire_agent': return { icon: UserMinus, verb: 'Removed an agent from the team', technical: 'fire_agent' }
    case 'list_agents': return { icon: Bot, verb: 'Checked the team', technical: 'list_agents' }
    case 'create_task': return { icon: ClipboardList, verb: 'Created the task', target: String(input.title ?? ''), technical: 'create_task' }
    case 'start_task': return { icon: Play, verb: 'Started the task', technical: 'start_task' }
    case 'cancel_task': return { icon: CircleSlash, verb: 'Cancelled a task', technical: 'cancel_task' }
    case 'get_task_status': return { icon: ClipboardList, verb: 'Checked on a task', technical: 'get_task_status' }
    case 'find_skills': return { icon: Sparkles, verb: 'Looked for skills about', target: String(input.query ?? ''), technical: 'find_skills' }
    default: {
      if (name.startsWith('mcp__claude-in-chrome__')) {
        const action = name.split('__')[2] ?? ''
        const url = typeof input.url === 'string' ? host(input.url) : undefined
        const what: Record<string, string> = {
          navigate: 'Opened in your Chrome', tabs_context_mcp: 'Checked your Chrome tabs', tabs_create_mcp: 'Opened a new Chrome tab',
          read_page: 'Read the page in Chrome', get_page_text: 'Read the page in Chrome', find: 'Looked for something on the page',
          computer: 'Clicked and typed in Chrome', form_input: 'Filled in a form in Chrome', browser_batch: 'Did a few steps in Chrome'
        }
        const shot = action === 'computer' && input.action === 'screenshot'
        return { icon: Globe, verb: shot ? 'Took a screenshot in Chrome' : what[action] ?? 'Worked in your Chrome', target: action === 'navigate' ? url : undefined, technical: name }
      }
      if (name.startsWith('mcp__')) {
        const [, server, tool] = name.split('__')
        return { icon: Wrench, verb: `Used ${server.replace(/^claude_ai_/, '').replace(/_/g, ' ')}`, target: tool?.replace(/_/g, ' '), technical: name }
      }
      return { icon: Wrench, verb: `Used ${name}`, technical: name }
    }
  }
}
