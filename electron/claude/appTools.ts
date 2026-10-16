// In-process MCP tools that let the Manager (and agents) control the app.
import { z } from 'zod'
import type * as SDK from '@anthropic-ai/claude-agent-sdk'
import type { Capability, ModelChoice } from '@shared/types'
import { agentsRepo, convRepo, tasksRepo } from '../db/repos'
import { emit, toast } from '../events'
import { askUser } from './interactions'
import { listSkills } from './config'
import { loadSdk } from './sdk'
import { cancelTask, isTaskRunning, startTask } from './agentRunner'

export const APP_SERVER = 'agentcloud'

const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], ...(isError ? { isError: true } : {}) })

const PALETTE = ['#F7A51C', '#F97316', '#EAB308', '#F59E0B', '#FB923C', '#FBBF24']
const CAPS: [Capability, ...Capability[]] = ['read', 'write', 'commands', 'web_search', 'web_fetch', 'browser', 'skills', 'helpers']

function describeAgent(id: string | null) {
  if (!id) return 'unassigned'
  const a = agentsRepo.get(id)
  return a ? `${a.name} (${a.id})` : 'unknown agent'
}

export interface ToolContext {
  conversationId: string
  /** Name shown on question cards. */
  from: string
  /** Set when the tools run inside a task's session. */
  taskId?: string
}

/** Full toolset for the Manager. */
export async function managerServer(ctx: ToolContext): Promise<SDK.McpSdkServerConfigWithInstance> {
  const { createSdkMcpServer, tool } = await loadSdk()
  return createSdkMcpServer({
    name: APP_SERVER,
    version: '1.0.0',
    alwaysLoad: true,
    tools: [
      tool(
        'hire_agent',
        'Hire a new specialist agent for the team. Use when no existing agent fits the work. Returns the new agent id.',
        {
          name: z.string().describe('Short friendly name, e.g. "Research Agent"'),
          role: z.string().describe('One-line role, e.g. "Finds and compares information online"'),
          instructions: z.string().describe('Detailed system instructions describing how this agent should work'),
          tools: z.array(z.enum(CAPS)).optional().describe('Abilities: read, write, commands, web_search, web_fetch, browser (the user’s own Chrome), skills, helpers'),
          skills: z.array(z.string()).optional().describe('1–6 skill names returned by find_skills that fit this job'),
          model: z.enum(['smartest', 'balanced', 'fastest']).optional().describe('Default balanced')
        },
        async (a) => {
          const existing = agentsRepo.findByName(a.name)
          if (existing) return text(`An agent named "${a.name}" already exists with id ${existing.id}. Reuse it instead of hiring again.`)
          const count = agentsRepo.list().length
          const installed = new Set(listSkills().filter((s) => s.enabled).map((s) => s.name))
          const skills = (a.skills ?? []).filter((n) => installed.has(n)).slice(0, 6)
          const unknown = (a.skills ?? []).filter((n) => !installed.has(n))
          const tools = new Set<Capability>((a.tools as Capability[] | undefined) ?? ['read', 'write', 'commands', 'web_search', 'web_fetch', 'browser', 'skills'])
          if (skills.length) tools.add('skills')
          const agent = agentsRepo.save({
            name: a.name, role: a.role, instructions: a.instructions, skills,
            tools: [...tools],
            model: (a.model as ModelChoice | undefined) ?? 'balanced',
            color: PALETTE[count % PALETTE.length], avatar: 'blob'
          })
          convRepo.create(agent.id, agent.name)
          emit({ type: 'agents:changed', hiredId: agent.id })
          emit({ type: 'conversations:changed' })
          toast('success', `${agent.name} joined your team`)
          return text(`Hired ${agent.name}. id: ${agent.id}${skills.length ? `. Skills: ${skills.join(', ')}` : ''}${unknown.length ? `. Not installed, so skipped: ${unknown.join(', ')}` : ''}`)
        }
      ),
      tool(
        'find_skills',
        'Search the skills (special know-how packs) installed on this computer. Use before hire_agent to pick the right skills for the job.',
        { query: z.string().describe('A few keywords about the job, e.g. "excel spreadsheet charts" or "seo blog writing"') },
        async ({ query }) => {
          const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)
          const scored = listSkills()
            .filter((s) => s.enabled)
            .map((s) => {
              const name = s.name.toLowerCase()
              const desc = s.description.toLowerCase()
              const score = words.reduce((n, w) => n + (name.includes(w) ? 3 : 0) + (desc.includes(w) ? 1 : 0), 0)
              return { s, score }
            })
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 12)
          if (!scored.length) return text('No installed skills match. Hire the agent without skills — it can still do the job.')
          return text(scored.map(({ s }) => `- ${s.name}: ${s.description.slice(0, 160)}`).join('\n'))
        }
      ),
      tool('list_agents', 'List the agents on the team, with ids, roles and whether they are busy.', {}, async () => {
        const agents = agentsRepo.list().filter((a) => !a.isManager)
        if (!agents.length) return text('The team is empty. Hire an agent with hire_agent.')
        const running = tasksRepo.list().filter((t) => t.status === 'in_progress' || t.status === 'needs_input')
        return text(
          agents
            .map((a) => {
              const busy = running.filter((t) => t.agentId === a.id).length
              return `- ${a.name} (id: ${a.id}) — ${a.role}. ${busy ? `Working on ${busy} task(s).` : 'Idle.'} Tasks done: ${a.tasksDone ?? 0}`
            })
            .join('\n')
        )
      }),
      tool('fire_agent', 'Remove an agent from the team.', { id: z.string() }, async ({ id }) => {
        const a = agentsRepo.get(id)
        if (!a || a.isManager) return text('No such agent.', true)
        for (const t of tasksRepo.list()) if (t.agentId === id && isTaskRunning(t.id)) cancelTask(t.id)
        agentsRepo.delete(id)
        convRepo.deleteForAgent(id)
        emit({ type: 'agents:changed' })
        emit({ type: 'conversations:changed' })
        return text(`${a.name} has left the team.`)
      }),
      tool(
        'create_task',
        'Create a task with a clear, detailed brief and assign it to an agent. Call start_task afterwards to begin.',
        {
          title: z.string().describe('Short task title'),
          description: z.string().describe('Full brief: goal, deliverables (with file names), constraints, and what done looks like'),
          agent_id: z.string().describe('Id of the agent who will do it'),
          priority: z.enum(['low', 'normal', 'high']).optional()
        },
        async (a) => {
          const agent = agentsRepo.get(a.agent_id) ?? agentsRepo.findByName(a.agent_id)
          if (!agent || agent.isManager) return text(`No agent with id ${a.agent_id}. Use list_agents or hire_agent first.`, true)
          const task = tasksRepo.create({ title: a.title, description: a.description, agentId: agent.id, conversationId: ctx.conversationId, priority: a.priority })
          tasksRepo.addEvent(task.id, 'status', { status: 'todo', text: `Created by ${ctx.from} and assigned to ${agent.name}` })
          emit({ type: 'task:update', task })
          return text(`Created task "${task.title}" (id: ${task.id}) for ${agent.name}. Start it with start_task.`)
        }
      ),
      tool('start_task', 'Start a task. The agent works on it in the background; you get a report when it finishes.', { task_id: z.string() }, async ({ task_id }) => {
        const r = await startTask(task_id)
        return r.ok ? text(`Task started. ${describeAgent(tasksRepo.get(task_id)?.agentId ?? null)} is working on it. You will receive an [agentCloud update] message with the report when it is done.`) : text(r.error, true)
      }),
      tool('cancel_task', 'Cancel a running task.', { task_id: z.string() }, async ({ task_id }) => {
        const t = tasksRepo.get(task_id)
        if (!t) return text('No such task.', true)
        cancelTask(task_id)
        return text(`Cancelled "${t.title}".`)
      }),
      tool('get_task_status', 'Get the status, latest activity and report of a task.', { task_id: z.string() }, async ({ task_id }) => {
        const t = tasksRepo.get(task_id)
        if (!t) return text('No such task.', true)
        return text(
          [
            `Task: ${t.title} (id: ${t.id})`,
            `Assigned to: ${describeAgent(t.agentId)}`,
            `Status: ${t.status}`,
            t.lastActivity ? `Latest activity: ${t.lastActivity}` : '',
            t.filesChanged.length ? `Files changed: ${t.filesChanged.join(', ')}` : '',
            t.error ? `Error: ${t.error}` : '',
            t.report ? `Report:\n${t.report}` : ''
          ].filter(Boolean).join('\n')
        )
      }),
      askUserTool(tool, ctx),
      notifyTool(tool)
    ]
  })
}

/** Small toolset for agents (in tasks and direct chats). */
export async function agentServer(ctx: ToolContext): Promise<SDK.McpSdkServerConfigWithInstance> {
  const { createSdkMcpServer, tool } = await loadSdk()
  return createSdkMcpServer({ name: APP_SERVER, version: '1.0.0', alwaysLoad: true, tools: [askUserTool(tool, ctx), notifyTool(tool)] })
}

type ToolFn = typeof SDK.tool

function askUserTool(tool: ToolFn, ctx: ToolContext) {
  return tool(
    'ask_user',
    'Ask the user a multiple-choice question in the app and wait for the answer. Use 2–4 short options. Only ask when you truly need a decision.',
    {
      question: z.string(),
      options: z.array(z.string()).max(4).describe('2 to 4 short answer options'),
      allow_custom: z.boolean().optional().describe('Let the user type their own answer (default true)')
    },
    async (a, extra) => {
      const signal = (extra as { signal?: AbortSignal } | undefined)?.signal
      const answer = await askUser({
        conversationId: ctx.conversationId, question: a.question, options: a.options, allowCustom: a.allow_custom ?? true,
        from: ctx.from, taskId: ctx.taskId, signal
      })
      return text(answer === null ? 'The user closed the question without answering. Continue with your best judgement or ask differently.' : `The user answered: ${answer}`)
    }
  )
}

function notifyTool(tool: ToolFn) {
  return tool(
    'notify_user',
    'Show a short pop-up notification (toast) to the user.',
    { message: z.string(), level: z.enum(['info', 'success', 'warning', 'error']).optional() },
    async (a) => {
      toast(a.level ?? 'info', a.message)
      return text('Shown.')
    }
  )
}

/** Friendly labels for the activity line under the thinking dots. */
export function activityFor(toolName: string, input: Record<string, unknown>, who: string): string {
  const short = toolName.replace(`mcp__${APP_SERVER}__`, '')
  const agentName = (id: unknown) => (typeof id === 'string' ? agentsRepo.get(id)?.name : undefined)
  switch (short) {
    case 'hire_agent': return `${who} is hiring ${String(input.name ?? 'a new agent')}…`
    case 'create_task': return `${who} is assigning this to ${agentName(input.agent_id) ?? 'an agent'}…`
    case 'start_task': return `${who} is getting the work started…`
    case 'list_agents': return `${who} is checking the team…`
    case 'ask_user': return `${who} has a question for you`
    case 'get_task_status': return `${who} is checking on a task…`
    case 'WebSearch': return `${who} is searching the web…`
    case 'WebFetch': return `${who} is reading a web page…`
    case 'find_skills': return `${who} is picking the right skills…`
    case 'Read': case 'Glob': case 'Grep': return `${who} is looking through files…`
    case 'Write': case 'Edit': return `${who} is writing…`
    case 'Bash': case 'PowerShell': return `${who} is running a command…`
    default: return short.startsWith('mcp__claude-in-chrome__') ? `${who} is working in your Chrome…` : `${who} is working…`
  }
}
