// Visual workflows: steps done by agents, one after another (or side by side), designed by drag and drop or by chat.
import { app } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'fs'
import { z } from 'zod'
import type * as SDK from '@anthropic-ai/claude-agent-sdk'
import type { Agent, Workflow, WorkflowEdge, WorkflowNode, WorkflowRun, WorkflowTemplate } from '@shared/types'
import { getDb } from './db'
import { agentsRepo, convRepo, settingsRepo, tasksRepo } from './db/repos'
import { emit, toast } from './events'
import { log } from './logging'
import { cancelTask, startTask } from './claude/agentRunner'
import { notifyDesktop, pushItem } from './claude/interactions'
import { managerConversationFor } from './claude/manager'
import { claudeExecutable, loadSdk, sessionEnv } from './claude/sdk'

/** Tasks created by a workflow carry this conversation id, so their reports don't go to the Manager one by one. */
export const WORKFLOW_CONV_PREFIX = 'workflow:'
export const isWorkflowConversation = (id: string | null | undefined) => !!id?.startsWith(WORKFLOW_CONV_PREFIX)

// ---------------------------------------------------------------- storage

const parse = (s: string): Workflow | null => {
  try {
    return JSON.parse(s) as Workflow
  } catch {
    return null
  }
}

export const workflowsRepo = {
  list(): Workflow[] {
    const rows = getDb().prepare('SELECT data_json FROM workflows ORDER BY updated_at DESC').all() as { data_json: string }[]
    return rows.map((r) => parse(r.data_json)).filter(Boolean) as Workflow[]
  },
  get(id: string): Workflow | null {
    const r = getDb().prepare('SELECT data_json FROM workflows WHERE id = ?').get(id) as { data_json: string } | undefined
    return r ? parse(r.data_json) : null
  },
  save(wf: Workflow, touch = true): Workflow {
    if (touch) wf.updatedAt = Date.now()
    getDb()
      .prepare('INSERT INTO workflows (id, data_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at')
      .run(wf.id, JSON.stringify(wf), wf.updatedAt)
    return wf
  },
  delete(id: string) {
    getDb().prepare('DELETE FROM workflows WHERE id = ?').run(id)
  }
}

function changed(wf: Workflow) {
  emit({ type: 'workflow:update', workflow: wf })
}

// ---------------------------------------------------------------- layout

const COL = 310
const ROW = 175
const WIDTH = { agent: 260, start: 120, end: 120 } as const

/** Top-to-bottom layers: each step sits one row below the step that feeds it; side-by-side steps share a row. */
function layoutPositions(nodes: WorkflowNode[], edges: WorkflowEdge[]): Map<string, { x: number; y: number }> {
  const incoming = new Map<string, string[]>()
  for (const e of edges) incoming.set(e.to, [...(incoming.get(e.to) ?? []), e.from])
  const depth = new Map<string, number>()
  const visit = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!
    if (seen.has(id)) return 0
    seen.add(id)
    const ins = incoming.get(id) ?? []
    const d = ins.length ? Math.max(...ins.map((p) => visit(p, seen) + 1)) : 0
    depth.set(id, d)
    return d
  }
  for (const n of nodes) visit(n.id, new Set())
  const byDepth = new Map<number, WorkflowNode[]>()
  for (const n of nodes) byDepth.set(depth.get(n.id)!, [...(byDepth.get(depth.get(n.id)!) ?? []), n])
  const out = new Map<string, { x: number; y: number }>()
  for (const [d, list] of byDepth) {
    list.forEach((n, i) => out.set(n.id, { x: Math.round(400 + (i - (list.length - 1) / 2) * COL - WIDTH[n.kind] / 2), y: 40 + d * ROW }))
  }
  return out
}

export function autoLayout(wf: Workflow): Workflow {
  const pos = layoutPositions(wf.nodes, wf.edges)
  wf.nodes = wf.nodes.map((n) => ({ ...n, ...pos.get(n.id)! }))
  return wf
}

// ---------------------------------------------------------------- templates

type StepSpec = { kind: WorkflowNode['kind']; title: string; role?: string; instructions?: string }

const TEMPLATES: (WorkflowTemplate & { specs: StepSpec[] })[] = [
  {
    key: 'blank', name: 'Blank workflow', description: 'Start from scratch.', steps: 0,
    specs: [{ kind: 'start', title: 'Start' }, { kind: 'end', title: 'Done' }]
  },
  {
    key: 'leads', name: 'Find leads and reach out', description: 'Scrape leads, check them, then write outreach emails.', steps: 3,
    specs: [
      { kind: 'start', title: 'Start' },
      { kind: 'agent', title: 'Lead Scraper', role: 'Finds and collects sales leads from the web', instructions: 'Find 100 leads that match our ideal customer. For each lead collect: name, company, job title, email (if public), website and LinkedIn. Save them to leads.csv in the workspace.' },
      { kind: 'agent', title: 'Lead Checker', role: 'Cleans and qualifies sales leads', instructions: 'Open leads.csv. Remove duplicates and leads without a way to contact them. Add a short note on why each lead is a good fit. Save the result to leads-qualified.csv.' },
      { kind: 'agent', title: 'Outbound Agent', role: 'Writes and sends friendly outreach emails', instructions: 'Write a short, personal cold email for every lead in leads-qualified.csv and save them to outreach-emails.md. Only send the emails if an email connection is set up and the user asked for sending; otherwise leave them ready to send.' },
      { kind: 'end', title: 'Report' }
    ]
  },
  {
    key: 'content', name: 'Blog post pipeline', description: 'Research a topic, write a post, then polish it.', steps: 3,
    specs: [
      { kind: 'start', title: 'Start' },
      { kind: 'agent', title: 'Researcher', role: 'Researches topics online and gathers facts with sources', instructions: 'Research the topic of the blog post. Collect the key facts, numbers and sources. Save notes to research-notes.md.' },
      { kind: 'agent', title: 'Writer', role: 'Writes clear, friendly blog posts', instructions: 'Use research-notes.md to write a 1,000-word blog post with a strong hook and clear headings. Save it as blog-post.md.' },
      { kind: 'agent', title: 'Editor', role: 'Edits writing for clarity, tone and SEO', instructions: 'Edit blog-post.md: fix mistakes, make it easy to read, add an SEO title and meta description. Save the final version as blog-post-final.md.' },
      { kind: 'end', title: 'Done' }
    ]
  },
  {
    key: 'social', name: 'Weekly social posts', description: 'Find trending ideas and turn them into posts.', steps: 2,
    specs: [
      { kind: 'start', title: 'Start' },
      { kind: 'agent', title: 'Trend Finder', role: 'Spots trending topics in an industry', instructions: 'Find 5 trending topics in our industry this week, with a link for each. Save them to trends.md.' },
      { kind: 'agent', title: 'Post Writer', role: 'Writes engaging social media posts', instructions: 'Turn each topic in trends.md into a LinkedIn post and an X post. Save them to social-posts.md.' },
      { kind: 'end', title: 'Done' }
    ]
  }
]

export function workflowTemplates(): WorkflowTemplate[] {
  return TEMPLATES.map(({ specs: _s, ...t }) => t)
}

function fromSpecs(specs: StepSpec[]): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const nodes: WorkflowNode[] = specs.map((s) => ({
    id: randomUUID().slice(0, 8), kind: s.kind, x: 0, y: 0, title: s.title,
    instructions: s.instructions ?? '', agentId: null, role: s.role ?? ''
  }))
  const edges: WorkflowEdge[] = nodes.slice(1).map((n, i) => ({ id: `${nodes[i].id}->${n.id}`, from: nodes[i].id, to: n.id }))
  return { nodes, edges }
}

export function createWorkflow(input: { name?: string; template?: string }): Workflow {
  const tpl = TEMPLATES.find((t) => t.key === input.template) ?? TEMPLATES[0]
  const t = Date.now()
  const wf: Workflow = {
    id: randomUUID(), name: input.name?.trim() || (tpl.key === 'blank' ? 'New workflow' : tpl.name), description: tpl.key === 'blank' ? '' : tpl.description,
    ...fromSpecs(tpl.specs), chat: [], lastRun: null, createdAt: t, updatedAt: t
  }
  // Reuse team members whose name matches a step.
  for (const n of wf.nodes) if (n.kind === 'agent') n.agentId = agentsRepo.findByName(n.title)?.id ?? null
  workflowsRepo.save(autoLayout(wf))
  emit({ type: 'workflows:changed' })
  return wf
}

// ---------------------------------------------------------------- running

interface Active { cancelled: boolean }
const active = new Map<string, Active>()
export const isWorkflowRunning = (id: string) => active.has(id)

const PALETTE = ['#F7A51C', '#F97316', '#EAB308', '#F59E0B', '#FB923C', '#FBBF24']

/** The team member for a step: the chosen one, one with the same name, or a newly hired specialist. */
function agentForStep(wf: Workflow, node: WorkflowNode): Agent {
  const chosen = node.agentId ? agentsRepo.get(node.agentId) : null
  if (chosen) return chosen
  const existing = agentsRepo.findByName(node.title)
  if (existing) return existing
  const count = agentsRepo.list().length
  const agent = agentsRepo.save({
    name: node.title,
    role: node.role || `Handles the "${node.title}" step of the ${wf.name} workflow`,
    instructions: `You are ${node.title}${node.role ? `, who ${node.role.charAt(0).toLowerCase()}${node.role.slice(1)}` : ''}. You work as one step in the "${wf.name}" workflow: do your step well, save your results as files in the workspace, and say clearly what you produced so the next step can use it.`,
    tools: ['read', 'write', 'commands', 'web_search', 'web_fetch', 'browser', 'skills'],
    model: 'balanced', color: PALETTE[count % PALETTE.length], avatar: 'blob'
  })
  convRepo.create(agent.id, agent.name)
  emit({ type: 'agents:changed', hiredId: agent.id })
  emit({ type: 'conversations:changed' })
  return agent
}

function briefFor(wf: Workflow, node: WorkflowNode, upstream: WorkflowNode[], run: WorkflowRun): string {
  const parts = [
    `This is the "${node.title}" step of the workflow "${wf.name}".${wf.description ? ` Workflow goal: ${wf.description}` : ''}`,
    '',
    '## Your step',
    node.instructions || `Do the "${node.title}" step.`
  ]
  const before = upstream
    .map((u) => {
      const task = run.steps[u.id]?.taskId ? tasksRepo.get(run.steps[u.id].taskId!) : null
      if (!task) return ''
      return `### ${u.title}\n${task.report ?? '(no report)'}\nFiles: ${task.filesChanged.length ? task.filesChanged.join(', ') : 'none'}`
    })
    .filter(Boolean)
  if (before.length) parts.push('', '## What the previous steps produced', ...before)
  parts.push('', 'Save everything you make in the workspace, and list the files in your report so the next step can pick them up.')
  return parts.join('\n')
}

export async function runWorkflow(id: string, source: 'user' | 'schedule' = 'user'): Promise<{ ok: true } | { ok: false; error: string }> {
  const wf = workflowsRepo.get(id)
  if (!wf) return { ok: false, error: "That workflow doesn't exist anymore." }
  if (active.has(id)) return { ok: false, error: 'This workflow is already running.' }
  const steps = wf.nodes.filter((n) => n.kind === 'agent')
  if (!steps.length) return { ok: false, error: 'Add at least one agent step before running.' }
  const ws = settingsRepo.getAll().workspace
  if (!ws || !fs.existsSync(ws)) return { ok: false, error: "The workspace folder can't be found. Choose a new one in Settings." }

  const run: WorkflowRun = { id: randomUUID(), status: 'running', startedAt: Date.now(), finishedAt: null, steps: {} }
  for (const n of wf.nodes) run.steps[n.id] = { status: n.kind === 'start' ? 'done' : 'waiting' }
  wf.lastRun = run
  workflowsRepo.save(wf, false)
  changed(wf)
  const state: Active = { cancelled: false }
  active.set(id, state)
  void drive(wf.id, state, source).catch((e) => {
    log.error('workflow run crashed', e)
    finish(wf.id, 'failed', e instanceof Error ? e.message : String(e))
  })
  return { ok: true }
}

function finish(id: string, status: WorkflowRun['status'], error?: string) {
  active.delete(id)
  const wf = workflowsRepo.get(id)
  if (!wf?.lastRun) return
  wf.lastRun.status = status
  wf.lastRun.finishedAt = Date.now()
  for (const [nid, st] of Object.entries(wf.lastRun.steps)) {
    const node = wf.nodes.find((n) => n.id === nid)
    if (node?.kind === 'end') st.status = status === 'done' ? 'done' : 'skipped'
    else if (st.status === 'waiting' || st.status === 'running') st.status = 'skipped'
  }
  workflowsRepo.save(wf, false)
  changed(wf)
  const convId = managerConversationFor(null)
  const text = status === 'done' ? `Workflow “${wf.name}” finished` : status === 'cancelled' ? `Workflow “${wf.name}” was stopped` : `Workflow “${wf.name}” didn't finish${error ? `: ${error}` : ''}`
  if (convId) pushItem(convId, { kind: 'notice', id: randomUUID(), level: status === 'done' ? 'success' : status === 'cancelled' ? 'info' : 'error', text, createdAt: Date.now() })
  toast(status === 'done' ? 'success' : status === 'cancelled' ? 'info' : 'error', text)
  if (status !== 'cancelled') notifyDesktop(text, 'Open agentCloud to see the results.')
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function drive(id: string, state: Active, source: 'user' | 'schedule') {
  log.info(`workflow ${id} started (${source})`)
  for (;;) {
    if (state.cancelled) return
    const wf = workflowsRepo.get(id)
    if (!wf?.lastRun) return finish(id, 'failed', 'The workflow was deleted.')
    const run = wf.lastRun
    const preds = (nid: string) => wf.edges.filter((e) => e.to === nid).map((e) => wf.nodes.find((n) => n.id === e.from)).filter(Boolean) as WorkflowNode[]
    let dirty = false

    // Follow running steps.
    for (const n of wf.nodes) {
      const st = run.steps[n.id]
      if (st?.status !== 'running' || !st.taskId) continue
      const t = tasksRepo.get(st.taskId)
      if (!t || t.status === 'done') {
        st.status = t ? 'done' : 'failed'
        dirty = true
      } else if (t.status === 'failed' || t.status === 'cancelled' || t.status === 'interrupted') {
        st.status = 'failed'
        st.error = t.error ?? `The step was ${t.status}.`
        dirty = true
      }
    }

    // Skip steps that can never run, then start the ones whose inputs are all done.
    for (const n of wf.nodes) {
      const st = run.steps[n.id]
      if (!st || st.status !== 'waiting' || n.kind === 'start') continue
      const p = preds(n.id)
      if (p.some((x) => ['failed', 'skipped'].includes(run.steps[x.id]?.status))) {
        st.status = 'skipped'
        dirty = true
        continue
      }
      if (!p.every((x) => run.steps[x.id]?.status === 'done')) continue
      if (n.kind === 'end') {
        st.status = 'done'
        dirty = true
        continue
      }
      const agent = agentForStep(wf, n)
      if (n.agentId !== agent.id) n.agentId = agent.id
      const upstream = p.filter((x) => x.kind === 'agent')
      const task = tasksRepo.create({ title: `${wf.name}: ${n.title}`, description: briefFor(wf, n, upstream, run), agentId: agent.id, conversationId: `${WORKFLOW_CONV_PREFIX}${wf.id}` })
      tasksRepo.addEvent(task.id, 'status', { status: 'todo', text: `Step of the workflow “${wf.name}”, assigned to ${agent.name}` })
      emit({ type: 'task:update', task })
      const r = await startTask(task.id)
      st.taskId = task.id
      st.status = r.ok ? 'running' : 'failed'
      if (!r.ok) st.error = r.error
      dirty = true
    }

    if (dirty) {
      workflowsRepo.save(wf, false)
      changed(wf)
    }
    const statuses = Object.values(run.steps).map((s) => s.status)
    if (!statuses.some((s) => s === 'running' || s === 'waiting')) {
      const ok = wf.nodes.filter((n) => n.kind === 'agent').every((n) => run.steps[n.id]?.status === 'done')
      return finish(id, ok ? 'done' : 'failed', ok ? undefined : Object.values(run.steps).find((s) => s.error)?.error)
    }
    if (!statuses.some((s) => s === 'running') && !dirty) {
      // Nothing running and nothing could start: the remaining steps aren't connected to the start.
      return finish(id, 'failed', 'Some steps are not connected. Link every step to the flow.')
    }
    await sleep(1500)
  }
}

export function stopWorkflow(id: string) {
  const state = active.get(id)
  if (!state) return
  state.cancelled = true
  const wf = workflowsRepo.get(id)
  for (const st of Object.values(wf?.lastRun?.steps ?? {})) if (st.status === 'running' && st.taskId) cancelTask(st.taskId)
  finish(id, 'cancelled')
}

/** After a restart nothing is running anymore. */
export function markInterruptedWorkflows() {
  for (const wf of workflowsRepo.list()) {
    if (wf.lastRun?.status !== 'running') continue
    wf.lastRun.status = 'cancelled'
    wf.lastRun.finishedAt = Date.now()
    for (const st of Object.values(wf.lastRun.steps)) if (st.status === 'running' || st.status === 'waiting') st.status = 'skipped'
    workflowsRepo.save(wf, false)
  }
}

// ---------------------------------------------------------------- AI designer chat

const chatting = new Set<string>()

const ASSISTANT_PROMPT = `You are the Workflow Designer inside agentCloud, a desktop app where a non-technical user runs a team of AI agents.
You help the user build a visual workflow: a chain of steps, where each step is done by one AI agent and passes its results to the next step.

Rules:
- Whenever the user asks for any change (or describes a process to build), call update_workflow ONCE with the COMPLETE new workflow.
- Keep the ids of steps that stay. New steps get short new ids like "s5".
- Always keep exactly one "start" step and one "end" step. Agent steps sit between them.
- Step titles are short agent names, like "Lead Scraper" or "Outbound Agent".
- Each agent step gets concrete instructions: what to do, how much, and which file to save the result in (e.g. leads.csv).
- For "agent", use the exact name of an existing team member when one fits; otherwise leave it empty and give a one-line "role" so a new specialist can be hired.
- Steps that can run at the same time may both link from the same step; a step that needs several inputs links from each of them.
- If the user only asks a question, just answer — don't call the tool.
- Your reply to the user: 1–3 short, friendly sentences in plain words. No tech words like JSON, node, edge or tool.`

function describeForAi(wf: Workflow): string {
  const name = (id: string | null) => (id ? agentsRepo.get(id)?.name ?? '' : '')
  return JSON.stringify({
    name: wf.name,
    description: wf.description,
    steps: wf.nodes.map((n) => ({ id: n.id, kind: n.kind, title: n.title, agent: name(n.agentId), role: n.role, instructions: n.instructions })),
    links: wf.edges.map((e) => ({ from: e.from, to: e.to }))
  })
}

const StepSchema = z.object({
  id: z.string(),
  kind: z.enum(['start', 'agent', 'end']),
  title: z.string(),
  instructions: z.string().optional(),
  agent: z.string().optional().describe('Exact name of an existing team member, or empty to hire a new specialist'),
  role: z.string().optional().describe('One line about what a newly hired specialist does')
})

function applyDesign(wf: Workflow, design: { name?: string; description?: string; steps: z.infer<typeof StepSchema>[]; links: { from: string; to: string }[] }) {
  const old = new Map(wf.nodes.map((n) => [n.id, n]))
  const nodes: WorkflowNode[] = design.steps.map((s) => {
    const prev = old.get(s.id)
    const named = s.agent?.trim() ? agentsRepo.findByName(s.agent.trim()) : null
    return {
      id: s.id, kind: s.kind, x: prev?.x ?? 0, y: prev?.y ?? 0, title: s.title,
      instructions: s.instructions ?? prev?.instructions ?? '',
      agentId: s.kind !== 'agent' ? null : named?.id ?? (s.agent?.trim() ? null : prev?.agentId ?? null),
      role: s.role ?? prev?.role ?? ''
    }
  })
  const ids = new Set(nodes.map((n) => n.id))
  const edges = design.links
    .filter((l) => ids.has(l.from) && ids.has(l.to) && l.from !== l.to)
    .map((l) => ({ id: `${l.from}->${l.to}`, from: l.from, to: l.to }))
  const sameShape = nodes.length === wf.nodes.length && nodes.every((n) => old.has(n.id)) &&
    edges.length === wf.edges.length && edges.every((e) => wf.edges.some((x) => x.from === e.from && x.to === e.to))
  const pos = layoutPositions(nodes, edges)
  wf.nodes = sameShape ? nodes : nodes.map((n) => ({ ...n, ...pos.get(n.id)! }))
  wf.edges = edges
  if (design.name?.trim()) wf.name = design.name.trim()
  if (design.description !== undefined) wf.description = design.description
}

export async function workflowChat(id: string, text: string): Promise<Workflow> {
  const wf = workflowsRepo.get(id)
  if (!wf) throw new Error("That workflow doesn't exist anymore.")
  if (chatting.has(id)) throw new Error('Still working on your last message.')
  wf.chat.push({ id: randomUUID(), role: 'user', text, createdAt: Date.now() })
  workflowsRepo.save(wf)
  changed(wf)
  chatting.add(id)
  emit({ type: 'workflow:chat', workflowId: id, busy: true })
  let reply = ''
  try {
    const { query, createSdkMcpServer, tool } = await loadSdk()
    const server = createSdkMcpServer({
      name: 'designer', version: '1.0.0',
      tools: [
        tool('update_workflow', 'Replace the workflow with this complete new version.', {
          name: z.string().optional().describe('Workflow name'),
          description: z.string().optional().describe('One line about what the workflow achieves'),
          steps: z.array(StepSchema),
          links: z.array(z.object({ from: z.string(), to: z.string() }))
        }, async (design) => {
          const cur = workflowsRepo.get(id)
          if (!cur) return { content: [{ type: 'text' as const, text: 'The workflow was deleted.' }], isError: true }
          applyDesign(cur, design)
          workflowsRepo.save(cur)
          changed(cur)
          return { content: [{ type: 'text' as const, text: 'Saved. The user can see it now.' }] }
        })
      ]
    })
    const team = agentsRepo.list().filter((a) => !a.isManager).map((a) => `- ${a.name}: ${a.role}`).join('\n') || '(nobody yet)'
    const history = wf.chat.slice(-9, -1).map((m) => `${m.role === 'user' ? 'User' : 'You'}: ${m.text}`).join('\n')
    const prompt = `Current workflow:\n${describeForAi(wf)}\n\nTeam members:\n${team}\n${history ? `\nEarlier in this chat:\n${history}\n` : ''}\nUser: ${text}`
    const ws = settingsRepo.getAll().workspace
    const options: SDK.Options = {
      cwd: ws && fs.existsSync(ws) ? ws : app.getPath('userData'),
      model: 'sonnet',
      systemPrompt: ASSISTANT_PROMPT,
      tools: [],
      mcpServers: { designer: server },
      settingSources: [],
      persistSession: false,
      maxTurns: 4,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      env: sessionEnv(),
      pathToClaudeCodeExecutable: claudeExecutable()
    }
    for await (const m of query({ prompt, options })) {
      if (m.type === 'assistant' && !m.parent_tool_use_id) {
        const t = (m.message.content as { type: string; text?: string }[]).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim()
        if (t) reply = t
      } else if (m.type === 'result') {
        if (m.subtype === 'success' && !m.is_error && m.result?.trim()) reply = m.result.trim()
        else if (m.is_error && !reply) reply = `Sorry, something went wrong: ${m.subtype === 'success' ? m.result : m.errors.join(' ')}`
      }
    }
  } catch (e) {
    log.error('workflow chat failed', e)
    reply = `Sorry, I couldn't do that: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    chatting.delete(id)
    emit({ type: 'workflow:chat', workflowId: id, busy: false })
  }
  const fresh = workflowsRepo.get(id)
  if (!fresh) throw new Error('The workflow was deleted.')
  fresh.chat.push({ id: randomUUID(), role: 'assistant', text: reply || 'Done.', createdAt: Date.now() })
  workflowsRepo.save(fresh)
  changed(fresh)
  return fresh
}

export const isWorkflowChatBusy = (id: string) => chatting.has(id)
