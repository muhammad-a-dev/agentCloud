import '@xyflow/react/dist/style.css'
import {
  Background, BaseEdge, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider, addEdge, applyEdgeChanges, applyNodeChanges,
  getBezierPath, useReactFlow, type Connection, type Edge, type EdgeChange, type EdgeProps, type Node, type NodeChange, type NodeProps
} from '@xyflow/react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft, Bot, CalendarClock, PanelRightClose, PanelRightOpen, Check, CircleX, ExternalLink, Flag, LayoutDashboard, LoaderCircle, Play, Plus, Send, Sparkles, Square, Trash2, Workflow as WorkflowIcon
} from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import type { Agent, StepStatus, Workflow, WorkflowEdge, WorkflowNode, WorkflowTemplate } from '@shared/types'
import { AgentAvatar, AgentBlob } from '@/components/Avatars'
import { Markdown } from '@/components/Markdown'
import { Button, Confirm, Field, Pill, inputCls } from '@/components/ui'
import { cx, timeLabel } from '@/lib/format'
import { api } from '@/lib/ipc'
import { useApp } from '@/stores/app'
import { ScheduleModal } from './Schedule'

// ---------------------------------------------------------------- helpers

type StepNode = Node<{ step: WorkflowNode }, WorkflowNode['kind']>

const toFlow = (wf: Workflow): { nodes: StepNode[]; edges: Edge[] } => ({
  nodes: wf.nodes.map((n) => ({ id: n.id, type: n.kind, position: { x: n.x, y: n.y }, data: { step: n }, deletable: n.kind !== 'start' })),
  edges: wf.edges.map((e) => ({ id: e.id, source: e.from, target: e.to }))
})

const fromFlow = (nodes: StepNode[], edges: Edge[]): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } => ({
  nodes: nodes.map((n) => ({ ...n.data.step, x: Math.round(n.position.x), y: Math.round(n.position.y) })),
  edges: edges.map((e) => ({ id: e.id, from: e.source, to: e.target }))
})

const newId = () => `s${Math.random().toString(36).slice(2, 7)}`

/** Step numbers in the order work flows: by distance from the start, then top to bottom. */
function stepNumbers(nodes: StepNode[], edges: Edge[]): Map<string, number> {
  const depth = new Map<string, number>()
  const incoming = new Map<string, string[]>()
  for (const e of edges) incoming.set(e.target, [...(incoming.get(e.target) ?? []), e.source])
  const visit = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!
    if (seen.has(id)) return 0
    seen.add(id)
    const ins = incoming.get(id) ?? []
    const d = ins.length ? Math.max(...ins.map((p) => visit(p, seen) + 1)) : 0
    depth.set(id, d)
    return d
  }
  const agents = nodes.filter((n) => n.type === 'agent')
  for (const n of agents) visit(n.id, new Set())
  agents.sort((a, b) => depth.get(a.id)! - depth.get(b.id)! || a.position.y - b.position.y)
  return new Map(agents.map((n, i) => [n.id, i + 1]))
}

const STATUS_LABEL: Record<StepStatus, string> = { waiting: 'Waiting', running: 'Working…', done: 'Done', failed: "Didn't finish", skipped: 'Skipped' }

// ---------------------------------------------------------------- canvas context

interface Ctx {
  agentsById: Map<string, Agent>
  statusOf: (id: string) => StepStatus | undefined
  numberOf: (id: string) => number | undefined
  addAfter: (id: string) => void
  running: boolean
}
const CanvasCtx = createContext<Ctx>(null as unknown as Ctx)

function StatusBadge({ status }: { status?: StepStatus }) {
  if (!status) return null
  const tone = status === 'done' ? 'text-success bg-success-soft' : status === 'failed' ? 'text-danger bg-danger-soft' : status === 'running' ? 'text-accent bg-accent-soft' : 'text-muted bg-card'
  return (
    <motion.span key={status} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={cx('inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-0.5 rounded-full', tone)}>
      {status === 'running' && <LoaderCircle size={11} className="animate-spin" />}
      {status === 'done' && <Check size={11} strokeWidth={3} />}
      {status === 'failed' && <CircleX size={11} />}
      {STATUS_LABEL[status]}
    </motion.span>
  )
}

function AgentStepNode({ id, data, selected }: NodeProps<StepNode>) {
  const { agentsById, statusOf, numberOf, addAfter } = useContext(CanvasCtx)
  const step = data.step
  const agent = step.agentId ? agentsById.get(step.agentId) : undefined
  const status = statusOf(id)
  return (
    <motion.div
      initial={{ scale: 0.7, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 24 }}
      className={cx(
        'group relative w-[260px] rounded-2xl border bg-card-2 px-3.5 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.35)] transition-colors',
        selected ? 'border-accent' : 'border-line hover:border-line-strong',
        status === 'running' && 'wf-running',
        status === 'done' && 'border-success/60',
        status === 'failed' && 'border-danger/60'
      )}
    >
      <Handle type="target" position={Position.Top} className="wf-handle" />
      <span className="absolute -top-2.5 -left-2.5 w-6 h-6 rounded-full bg-accent text-accent-text text-[12px] font-bold flex items-center justify-center shadow">{numberOf(id) ?? '•'}</span>
      <div className="flex items-center gap-2.5">
        {agent ? <AgentAvatar avatar={agent.avatar} color={agent.color} size={36} /> : <AgentBlob size={36} />}
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[14.5px] leading-tight truncate">{step.title || 'Untitled step'}</div>
          <div className="text-[12px] text-fg-2 truncate">{agent ? agent.name : 'New specialist, hired when it runs'}</div>
        </div>
      </div>
      {step.instructions && <div className="mt-2 text-[12.5px] leading-snug text-fg-2 line-clamp-2">{step.instructions}</div>}
      {status && <div className="mt-2"><StatusBadge status={status} /></div>}
      <Handle type="source" position={Position.Bottom} className="wf-handle" />
      <button
        title="Add the next step"
        onClick={(e) => { e.stopPropagation(); addAfter(id) }}
        className="nodrag absolute left-1/2 -bottom-12 -translate-x-1/2 w-7 h-7 rounded-full bg-accent text-accent-text flex items-center justify-center opacity-0 group-hover:opacity-100 transition hover:scale-110 shadow"
      >
        <Plus size={15} strokeWidth={2.6} />
      </button>
    </motion.div>
  )
}

function StartNode({ selected, id }: NodeProps<StepNode>) {
  const { addAfter, running } = useContext(CanvasCtx)
  return (
    <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={cx('group relative h-12 pl-3 pr-5 rounded-full border flex items-center gap-2 font-semibold text-[14px] bg-card-2', selected ? 'border-accent' : 'border-line', running && 'wf-running')}>
      <span className="w-7 h-7 rounded-full bg-accent text-accent-text flex items-center justify-center"><Play size={13} fill="currentColor" /></span>
      Start
      <Handle type="source" position={Position.Bottom} className="wf-handle" />
      <button title="Add the first step" onClick={(e) => { e.stopPropagation(); addAfter(id) }} className="nodrag absolute left-1/2 -bottom-12 -translate-x-1/2 w-7 h-7 rounded-full bg-accent text-accent-text flex items-center justify-center opacity-0 group-hover:opacity-100 transition hover:scale-110 shadow">
        <Plus size={15} strokeWidth={2.6} />
      </button>
    </motion.div>
  )
}

function EndNode({ id, data, selected }: NodeProps<StepNode>) {
  const { statusOf } = useContext(CanvasCtx)
  const done = statusOf(id) === 'done'
  return (
    <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={cx('relative h-12 pl-3 pr-5 rounded-full border flex items-center gap-2 font-semibold text-[14px] bg-card-2', selected ? 'border-accent' : done ? 'border-success/70' : 'border-line')}>
      <Handle type="target" position={Position.Top} className="wf-handle" />
      <motion.span animate={done ? { scale: [1, 1.3, 1] } : {}} className={cx('w-7 h-7 rounded-full flex items-center justify-center', done ? 'bg-success text-white' : 'bg-card-hover text-fg-2')}>
        {done ? <Check size={14} strokeWidth={3} /> : <Flag size={13} />}
      </motion.span>
      {data.step.title || 'Done'}
    </motion.div>
  )
}

function FlowEdge({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected }: EdgeProps) {
  const { statusOf } = useContext(CanvasCtx)
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const s = statusOf(source)
  const t = statusOf(target)
  const active = s === 'done' && t === 'running'
  const done = s === 'done' && t === 'done'
  const color = active || done ? 'var(--accent)' : selected ? 'var(--text)' : 'var(--muted)'
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={24}
        style={{ stroke: color, strokeWidth: active ? 3 : 2.2, strokeDasharray: done || active ? undefined : '7 6', animation: done || active ? undefined : 'wfdash 1.1s linear infinite' }}
      />
      {!done && (
        <circle r={active ? 5.5 : 3.5} fill="var(--accent)" opacity={active ? 1 : 0.75}>
          <animateMotion dur={active ? '1.1s' : '2.8s'} repeatCount="indefinite" path={path} />
        </circle>
      )}
    </>
  )
}

const nodeTypes = { agent: AgentStepNode, start: StartNode, end: EndNode }
const edgeTypes = { flow: FlowEdge }

// ---------------------------------------------------------------- page

export function WorkflowsPage() {
  const activeId = useApp((s) => s.activeWorkflowId)
  const workflow = useApp((s) => s.workflows.find((w) => w.id === s.activeWorkflowId))
  if (activeId && workflow) {
    return (
      <ReactFlowProvider key={workflow.id}>
        <Editor workflow={workflow} />
      </ReactFlowProvider>
    )
  }
  return <Gallery />
}

// ---------------------------------------------------------------- gallery

const TEMPLATE_ICONS: Record<string, string> = { blank: '✨', leads: '🎯', content: '✍️', social: '📣' }

function Gallery() {
  const { workflows, agents, openWorkflow, toast } = useApp()
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [deleting, setDeleting] = useState<Workflow | null>(null)
  const [creating, setCreating] = useState(false)
  useEffect(() => {
    void api.workflowTemplates().then(setTemplates)
  }, [])
  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])

  const create = async (template: string) => {
    if (creating) return
    setCreating(true)
    try {
      const wf = await api.workflowsCreate({ template })
      await useApp.getState().refreshWorkflows()
      openWorkflow(wf.id)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-10">
      <div className="max-w-[1100px] mx-auto">
        <div className="flex items-end justify-between gap-4 mt-2 mb-6">
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight">Design a workflow</h1>
            <p className="text-fg-2 mt-1 max-w-[620px]">Lay out a process step by step — like “Lead Scraper finds 100 leads, then the Outbound Agent emails them”. Drag steps around, or just tell the AI what you want.</p>
          </div>
          <Button variant="primary" onClick={() => create('blank')} disabled={creating}><Plus size={15} /> New workflow</Button>
        </div>

        {workflows.length > 0 && (
          <>
            <div className="text-[12px] uppercase tracking-wide text-muted font-medium mb-2">Your workflows</div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3 mb-8">
              {workflows.map((w, i) => {
                const steps = w.nodes.filter((n) => n.kind === 'agent')
                const run = w.lastRun
                return (
                  <motion.div
                    key={w.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    whileHover={{ y: -3 }}
                    onClick={() => openWorkflow(w.id)}
                    className="cursor-pointer rounded-2xl border border-line bg-card hover:border-line-strong p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-[15.5px] truncate">{w.name}</div>
                        <div className="text-[13px] text-fg-2 truncate">{w.description || `${steps.length} step${steps.length === 1 ? '' : 's'}`}</div>
                      </div>
                      {run && (
                        <Pill tone={run.status === 'running' ? 'accent' : run.status === 'done' ? 'success' : run.status === 'failed' ? 'danger' : 'neutral'}>
                          {run.status === 'running' ? 'Running' : run.status === 'done' ? 'Last run worked' : run.status === 'failed' ? 'Last run failed' : 'Stopped'}
                        </Pill>
                      )}
                    </div>
                    <div className="mt-3 flex items-center gap-1.5 overflow-hidden">
                      {steps.length === 0 && <span className="text-[13px] text-muted">No steps yet</span>}
                      {steps.slice(0, 5).map((s, j) => {
                        const a = s.agentId ? agentsById.get(s.agentId) : undefined
                        return (
                          <span key={s.id} className="flex items-center gap-1.5 shrink-0">
                            {j > 0 && <span className="text-muted">→</span>}
                            <span className="flex items-center gap-1.5 rounded-full bg-card-2 border border-line pl-1 pr-2.5 h-7 text-[12.5px]">
                              {a ? <AgentAvatar avatar={a.avatar} color={a.color} size={20} /> : <AgentBlob size={20} />}
                              <span className="max-w-[110px] truncate">{s.title}</span>
                            </span>
                          </span>
                        )
                      })}
                      {steps.length > 5 && <span className="text-[12.5px] text-muted">+{steps.length - 5}</span>}
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[12px] text-muted">
                      <span>Edited {timeLabel(w.updatedAt)}</span>
                      <button
                        aria-label="Delete workflow"
                        onClick={(e) => { e.stopPropagation(); setDeleting(w) }}
                        className="p-1 rounded hover:text-danger hover:bg-danger-soft"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </>
        )}

        <div className="text-[12px] uppercase tracking-wide text-muted font-medium mb-2">Start from a template</div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
          {templates.map((t) => (
            <motion.button
              key={t.key}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => create(t.key)}
              disabled={creating}
              className="text-left flex flex-col items-start justify-start rounded-2xl border border-dashed border-line-strong hover:border-accent/60 hover:bg-card p-4"
            >
              <div className="text-[26px] mb-1.5">{TEMPLATE_ICONS[t.key] ?? '🧩'}</div>
              <div className="font-semibold text-[15px]">{t.name}</div>
              <div className="text-[13px] text-fg-2 mt-0.5">{t.description}</div>
              {t.steps > 0 && <div className="text-[12px] text-muted mt-2">{t.steps} steps</div>}
            </motion.button>
          ))}
        </div>
      </div>
      <Confirm
        open={!!deleting}
        title="Delete this workflow?"
        message={`“${deleting?.name}” and its schedules will be removed. Your agents, files and past tasks stay.`}
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          if (!deleting) return
          await api.workflowsDelete(deleting.id)
          toast('info', 'Workflow deleted.')
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}

// ---------------------------------------------------------------- editor

function Editor({ workflow }: { workflow: Workflow }) {
  const { agents, openWorkflow, toast, openTask, settings, workflowPanelOpen, toggleWorkflowPanel } = useApp()
  const chatBusy = useApp((s) => !!s.workflowChatBusy[workflow.id])
  const flow = useReactFlow()
  const initial = useMemo(() => toFlow(workflow), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [nodes, setNodes] = useState<StepNode[]>(initial.nodes)
  const [edges, setEdges] = useState<Edge[]>(initial.edges)
  const [name, setName] = useState(workflow.name)
  const [description, setDescription] = useState(workflow.description)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<'chat' | 'step'>('chat')
  /** Show the step editor, reopening the side panel if it was hidden. */
  const openStepPanel = useCallback(() => {
    setTab('step')
    if (!useApp.getState().workflowPanelOpen) useApp.getState().toggleWorkflowPanel(true)
  }, [])
  const [scheduling, setScheduling] = useState(false)
  const [starting, setStarting] = useState(false)

  // Save shortly after the user stops editing; take in changes made elsewhere (the AI, a run) when nothing is pending.
  const version = useRef(workflow.updatedAt)
  const dirty = useRef(false)
  const timer = useRef<number>(0)
  const latest = useRef({ nodes, edges, name, description })
  latest.current = { nodes, edges, name, description }

  const save = useCallback(async () => {
    window.clearTimeout(timer.current)
    const { nodes: n, edges: e, name: nm, description: d } = latest.current
    const saved = await api.workflowsSave({ ...workflow, ...fromFlow(n, e), name: nm.trim() || 'Untitled workflow', description: d })
    version.current = saved.updatedAt
    dirty.current = false
  }, [workflow])

  const queueSave = useCallback(() => {
    dirty.current = true
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void save(), 600)
  }, [save])

  useEffect(() => () => {
    if (dirty.current) void save()
  }, [save])

  useEffect(() => {
    if (dirty.current) return
    if (workflow.updatedAt <= version.current) {
      // A run hires agents for steps without changing the version: show who does each step now.
      const hired = new Map(workflow.nodes.filter((n) => n.agentId).map((n) => [n.id, n.agentId]))
      setNodes((cur) => cur.some((n) => !n.data.step.agentId && hired.has(n.id))
        ? cur.map((n) => (!n.data.step.agentId && hired.has(n.id) ? { ...n, data: { step: { ...n.data.step, agentId: hired.get(n.id)! } } } : n))
        : cur)
      return
    }
    version.current = workflow.updatedAt
    const f = toFlow(workflow)
    setNodes((cur) => f.nodes.map((n) => ({ ...n, selected: cur.find((c) => c.id === n.id)?.selected })))
    setEdges(f.edges)
    setName(workflow.name)
    setDescription(workflow.description)
    window.setTimeout(() => flow.fitView({ padding: 0.25, maxZoom: 1, duration: 500 }), 80)
  }, [workflow, flow])

  // Re-centre the flow once a sidebar has finished opening or closing.
  const sidebarOpen = useApp((s) => s.sidebarOpen)
  const firstLayout = useRef(true)
  useEffect(() => {
    if (firstLayout.current) {
      firstLayout.current = false
      return
    }
    const t = window.setTimeout(() => flow.fitView({ padding: 0.25, maxZoom: 1, duration: 400 }), 260)
    return () => window.clearTimeout(t)
  }, [workflowPanelOpen, sidebarOpen, flow])

  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])
  const team = agents.filter((a) => !a.isManager)
  const run = workflow.lastRun
  const running = run?.status === 'running'
  const numbers = useMemo(() => stepNumbers(nodes, edges), [nodes, edges])

  const onNodesChange = useCallback((changes: NodeChange<StepNode>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns))
    for (const c of changes) {
      if (c.type === 'select' && c.selected) {
        setSelectedId(c.id)
        openStepPanel()
      }
      if (c.type === 'remove') setSelectedId((s) => (s === c.id ? null : s))
    }
    if (changes.some((c) => c.type === 'remove' || (c.type === 'position' && !c.dragging))) queueSave()
  }, [queueSave])

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((es) => applyEdgeChanges(changes, es))
    if (changes.some((c) => c.type === 'remove')) queueSave()
  }, [queueSave])

  const onConnect = useCallback((c: Connection) => {
    setEdges((es) => addEdge({ ...c, id: `${c.source}->${c.target}` }, es))
    queueSave()
  }, [queueSave])

  const updateStep = (id: string, patch: Partial<WorkflowNode>) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { step: { ...n.data.step, ...patch } } } : n)))
    queueSave()
  }

  const makeStep = (pos: { x: number; y: number }, agent?: Agent | null, kind: WorkflowNode['kind'] = 'agent'): StepNode => {
    const step: WorkflowNode = {
      id: newId(), kind, x: pos.x, y: pos.y,
      title: kind === 'end' ? 'Done' : agent?.name ?? 'New step', instructions: '', agentId: agent?.id ?? null, role: agent?.role ?? ''
    }
    return { id: step.id, type: kind, position: pos, data: { step }, selected: true, deletable: true }
  }

  const addAfter = useCallback((id: string) => {
    const from = latest.current.nodes.find((n) => n.id === id)
    if (!from) return
    const added = makeStep({ x: from.position.x + (from.type === 'agent' ? 0 : -70), y: from.position.y + (from.type === 'agent' ? 175 : 110) })
    // Insert between this step and what came after it.
    setEdges((es) => [
      ...es.filter((e) => e.source !== id),
      { id: `${id}->${added.id}`, source: id, target: added.id },
      ...es.filter((e) => e.source === id).map((e) => ({ id: `${added.id}->${e.target}`, source: added.id, target: e.target }))
    ])
    // Make room: push everything below the new step further down.
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false, position: n.position.y > from.position.y + 10 ? { ...n.position, y: n.position.y + 175 } : n.position })), added])
    setSelectedId(added.id)
    openStepPanel()
    queueSave()
  }, [queueSave]) // eslint-disable-line react-hooks/exhaustive-deps

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    const raw = e.dataTransfer.getData('application/agentcloud-step')
    if (!raw) return
    const { kind, agentId } = JSON.parse(raw) as { kind: WorkflowNode['kind']; agentId?: string }
    const pos = flow.screenToFlowPosition({ x: e.clientX - 130, y: e.clientY - 40 })
    const node = makeStep(pos, agentId ? agentsById.get(agentId) : null, kind)
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), node])
    setSelectedId(node.id)
    openStepPanel()
    queueSave()
  }

  const ctx: Ctx = useMemo(() => ({
    agentsById,
    statusOf: (id: string) => run?.steps[id]?.status,
    numberOf: (id: string) => numbers.get(id),
    addAfter,
    running: run?.status === 'running'
  }), [agentsById, run, numbers, addAfter])

  const shownEdges = useMemo(() => edges.map((e) => {
    const lit = run?.steps[e.source]?.status === 'done' && ['running', 'done'].includes(run?.steps[e.target]?.status ?? '')
    return { ...e, type: 'flow', markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: lit ? '#f7a51c' : '#7a7a7a' } }
  }), [edges, run])

  const startRun = async () => {
    setStarting(true)
    try {
      if (dirty.current) await save()
      const r = await api.workflowsRun(workflow.id)
      if (!r.ok) toast('error', r.error)
      else toast('success', 'Workflow started. Watch it work!')
    } finally {
      setStarting(false)
    }
  }

  const steps = nodes.filter((n) => n.type === 'agent')
  const doneCount = run ? steps.filter((n) => run.steps[n.id]?.status === 'done').length : 0
  const selected = nodes.find((n) => n.id === selectedId)

  return (
    <CanvasCtx.Provider value={ctx}>
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 flex flex-col">
          {/* toolbar */}
          <div className="h-[56px] shrink-0 flex items-center gap-2 px-4 border-b border-divider">
            <Button size="sm" variant="ghost" title="All workflows" aria-label="All workflows" onClick={async () => { if (dirty.current) await save(); openWorkflow(null) }}><ArrowLeft size={15} /></Button>
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); queueSave() }}
              className="min-w-[150px] flex-1 max-w-[340px] h-9 px-2.5 rounded-lg bg-transparent hover:bg-card focus:bg-card border border-transparent focus:border-line outline-none font-semibold text-[15.5px]"
              aria-label="Workflow name"
            />
            {run && (
              <div className="flex items-center gap-2 text-[12.5px] text-fg-2">
                {running ? (
                  <>
                    <LoaderCircle size={14} className="animate-spin text-accent" />
                    <span>Step {Math.min(doneCount + 1, steps.length)} of {steps.length}</span>
                    <span className="w-16 h-1.5 rounded-full bg-card overflow-hidden"><motion.span className="block h-full bg-accent" animate={{ width: `${(doneCount / Math.max(steps.length, 1)) * 100}%` }} /></span>
                  </>
                ) : (
                  <Pill tone={run.status === 'done' ? 'success' : run.status === 'failed' ? 'danger' : 'neutral'}>
                    {run.status === 'done' ? `Finished ${timeLabel(run.finishedAt ?? run.startedAt)}` : run.status === 'failed' ? 'Last run failed' : 'Last run stopped'}
                  </Pill>
                )}
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="ghost" title="Tidy up the layout" aria-label="Arrange" onClick={async () => { if (dirty.current) await save(); await api.workflowsLayout(workflow.id) }}><LayoutDashboard size={14} /></Button>
              <Button size="sm" onClick={async () => { if (dirty.current) await save(); setScheduling(true) }}><CalendarClock size={14} /> Schedule</Button>
              <Button
                size="sm"
                variant="ghost"
                title={workflowPanelOpen ? 'Hide the side panel' : 'Show the AI designer and step editor'}
                aria-label={workflowPanelOpen ? 'Hide side panel' : 'Show side panel'}
                onClick={() => toggleWorkflowPanel()}
              >
                {workflowPanelOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
              </Button>
              {running ? (
                <Button size="sm" variant="danger" onClick={() => api.workflowsStop(workflow.id)}><Square size={12} fill="currentColor" /> Stop</Button>
              ) : (
                <Button size="sm" variant="accent" disabled={starting || !steps.length} onClick={startRun}><Play size={13} fill="currentColor" /> Run</Button>
              )}
            </div>
          </div>

          {/* canvas */}
          <div className="flex-1 min-h-0 relative" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }} onDrop={onDrop}>
            <ReactFlow
              nodes={nodes}
              edges={shownEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onPaneClick={() => setSelectedId(null)}
              isValidConnection={(c) => c.source !== c.target && !edges.some((e) => e.source === c.source && e.target === c.target)}
              colorMode={settings?.theme === 'light' ? 'light' : 'dark'}
              fitView
              fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
              minZoom={0.3}
              maxZoom={1.6}
              deleteKeyCode={['Backspace', 'Delete']}
              proOptions={{ hideAttribution: true }}
              className="wf-canvas"
            >
              <Background gap={22} size={1.4} color="var(--border-strong)" />
              <Controls showInteractive={false} position="bottom-left" />
              <MiniMap pannable zoomable position="bottom-right" style={{ width: 150, height: 100 }} nodeColor={(n) => (n.type === 'agent' ? '#f7a51c' : '#555')} maskColor="rgba(0,0,0,0.55)" />
            </ReactFlow>
            <Palette team={team} />
            {steps.length === 0 && (
              <div className="pointer-events-none absolute inset-x-0 top-[38%] flex justify-center">
                <div className="text-center text-fg-2 text-[14px] bg-card/80 border border-line rounded-2xl px-5 py-3 backdrop-blur">
                  Drag a step from the left, hover <b>Start</b> and press <b className="text-accent">+</b> below it, or ask the AI on the right.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* side panel */}
        <AnimatePresence initial={false}>
        {workflowPanelOpen && (
        <motion.aside
          key="wf-panel"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 350, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="shrink-0 border-l border-divider bg-sidebar flex flex-col min-h-0 overflow-hidden"
        >
          <div className="w-[350px] flex-1 min-h-0 flex flex-col">
          <div className="h-[56px] shrink-0 flex items-center gap-1 px-3 border-b border-divider">
            {(['chat', 'step'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cx('h-9 px-3.5 rounded-full text-[13.5px] font-medium flex items-center gap-1.5 transition', tab === t ? 'bg-card-hover text-fg' : 'text-fg-2 hover:text-fg')}>
                {t === 'chat' ? <><Sparkles size={14} className="text-accent" /> AI designer</> : <><WorkflowIcon size={14} /> {selected ? 'Step' : 'Details'}</>}
              </button>
            ))}
          </div>
          {tab === 'chat' ? (
            <DesignerChat workflow={workflow} busy={chatBusy} beforeSend={async () => { if (dirty.current) await save() }} />
          ) : selected ? (
            <StepEditor
              key={selected.id}
              step={selected.data.step}
              team={team}
              runInfo={run?.steps[selected.id]}
              onChange={(patch) => updateStep(selected.id, patch)}
              onDelete={() => { setNodes((ns) => ns.filter((n) => n.id !== selected.id)); setEdges((es) => es.filter((e) => e.source !== selected.id && e.target !== selected.id)); setSelectedId(null); queueSave() }}
              onOpenTask={(id) => openTask(id)}
            />
          ) : (
            <div className="p-4 overflow-y-auto">
              <Field label="What is this workflow for?" hint="A short goal helps every step do better work.">
                <textarea className={cx(inputCls, 'min-h-[90px] resize-y')} value={description} onChange={(e) => { setDescription(e.target.value); queueSave() }} placeholder="e.g. Find new customers for our design agency and reach out to them" />
              </Field>
              <div className="rounded-xl border border-line bg-card p-3 text-[13px] text-fg-2 space-y-1.5">
                <div className="font-medium text-fg">How it works</div>
                <div>• Each box is a step done by one agent. Numbers show the order.</div>
                <div>• Arrows show where results go next. Drag from the dot at the bottom of a box to another box to link them.</div>
                <div>• Click a box to edit it. Press Delete to remove it.</div>
                <div>• Press <b>Run</b> to start, or <b>Schedule</b> to run it automatically.</div>
              </div>
            </div>
          )}
          </div>
        </motion.aside>
        )}
        </AnimatePresence>
      </div>
      <ScheduleModal open={scheduling} onClose={() => setScheduling(false)} preset={{ kind: 'workflow', workflowId: workflow.id, title: workflow.name }} />
    </CanvasCtx.Provider>
  )
}

function Palette({ team }: { team: Agent[] }) {
  const [open, setOpen] = useState(true)
  const drag = (e: DragEvent, payload: { kind: WorkflowNode['kind']; agentId?: string }) => {
    e.dataTransfer.setData('application/agentcloud-step', JSON.stringify(payload))
    e.dataTransfer.effectAllowed = 'copy'
  }
  const item = 'flex items-center gap-2 h-10 px-2 rounded-xl border border-line bg-card-2 hover:border-accent/60 cursor-grab active:cursor-grabbing text-[13px] select-none'
  return (
    <div className="absolute left-3 top-3 z-10 w-[200px] rounded-2xl border border-line bg-sidebar/95 backdrop-blur shadow-[var(--shadow)]">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-3 h-9 text-[12px] uppercase tracking-wide text-muted font-medium">
        Drag onto the canvas <span>{open ? '–' : '+'}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="px-2.5 pb-2.5 space-y-1.5 max-h-[340px] overflow-y-auto">
              <div draggable onDragStart={(e) => drag(e, { kind: 'agent' })} className={item}><AgentBlob size={24} /> New agent step</div>
              {team.map((a) => (
                <div key={a.id} draggable onDragStart={(e) => drag(e, { kind: 'agent', agentId: a.id })} className={item} title={a.role}>
                  <AgentAvatar avatar={a.avatar} color={a.color} size={24} /><span className="truncate">{a.name}</span>
                </div>
              ))}
              <div draggable onDragStart={(e) => drag(e, { kind: 'end' })} className={item}>
                <span className="w-6 h-6 rounded-full bg-card-hover flex items-center justify-center"><Flag size={12} /></span> Finish
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function StepEditor({ step, team, runInfo, onChange, onDelete, onOpenTask }: {
  step: WorkflowNode
  team: Agent[]
  runInfo?: { status: StepStatus; taskId?: string; error?: string }
  onChange: (patch: Partial<WorkflowNode>) => void
  onDelete: () => void
  onOpenTask: (id: string) => void
}) {
  if (step.kind !== 'agent') {
    return (
      <div className="p-4 text-[13.5px] text-fg-2">
        {step.kind === 'start'
          ? 'This is where the workflow begins. Hover it and press + to add the first step, or drag from its bottom dot to a step.'
          : (
            <>
              <Field label="Finish label"><input className={inputCls} value={step.title} onChange={(e) => onChange({ title: e.target.value })} /></Field>
              <div>The workflow is done when every arrow reaches here.</div>
              <Button size="sm" variant="ghost" className="mt-3 text-danger" onClick={onDelete}><Trash2 size={13} /> Remove</Button>
            </>
          )}
      </div>
    )
  }
  return (
    <div className="p-4 overflow-y-auto">
      <Field label="Step name"><input className={inputCls} value={step.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="e.g. Lead Scraper" /></Field>
      <Field label="Who does this step?">
        <select className={inputCls} value={step.agentId ?? ''} onChange={(e) => onChange({ agentId: e.target.value || null })}>
          <option value="">A new specialist (hired automatically)</option>
          {team.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.role}</option>)}
        </select>
      </Field>
      {!step.agentId && (
        <Field label="What kind of specialist?" hint="One line, e.g. “Finds sales leads on the web”.">
          <input className={inputCls} value={step.role} onChange={(e) => onChange({ role: e.target.value })} />
        </Field>
      )}
      <Field label="What should this step do?" hint="Be specific: how much, and which file to save results in.">
        <textarea className={cx(inputCls, 'min-h-[150px] resize-y')} value={step.instructions} onChange={(e) => onChange({ instructions: e.target.value })} placeholder="e.g. Find 100 leads that match our ideal customer and save them to leads.csv" />
      </Field>
      {runInfo && runInfo.status !== 'waiting' && (
        <div className="rounded-xl border border-line bg-card p-3 mb-4 text-[13px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-fg-2">Last run</span>
            <StatusBadge status={runInfo.status} />
          </div>
          {runInfo.error && <div className="text-danger mt-1.5">{runInfo.error}</div>}
          {runInfo.taskId && <Button size="sm" className="mt-2" onClick={() => onOpenTask(runInfo.taskId!)}><ExternalLink size={13} /> See what it did</Button>}
        </div>
      )}
      <Button size="sm" variant="ghost" className="text-danger" onClick={onDelete}><Trash2 size={13} /> Remove step</Button>
    </div>
  )
}

const SUGGESTIONS = [
  'Build a flow: scrape 100 leads, check them, then write outreach emails',
  'Add a step that checks the emails before they are sent',
  'Explain this workflow in simple words'
]

function DesignerChat({ workflow, busy, beforeSend }: { workflow: Workflow; busy: boolean; beforeSend: () => Promise<void> }) {
  const [text, setText] = useState('')
  const toast = useApp((s) => s.toast)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Newer Chromium returns a promise here; never hand it back to React as a cleanup.
    void end.current?.scrollIntoView({ behavior: 'smooth' })
  }, [workflow.chat.length, busy])
  const send = async (t: string) => {
    const msg = t.trim()
    if (!msg || busy) return
    setText('')
    await beforeSend()
    const r = await api.workflowsChat(workflow.id, msg)
    if (!r.ok) toast('error', r.error)
  }
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {workflow.chat.length === 0 && (
          <div className="text-center px-2 pt-4">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-accent-soft text-accent flex items-center justify-center mb-2"><Bot size={22} /></div>
            <div className="font-semibold">Describe your process</div>
            <div className="text-[13px] text-fg-2 mt-1 mb-4">Tell me what should happen, step by step, and I’ll draw it for you. You can keep changing it by chatting.</div>
            <div className="space-y-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="w-full text-left text-[13px] rounded-xl border border-line bg-card hover:border-accent/50 px-3 py-2">{s}</button>
              ))}
            </div>
          </div>
        )}
        <AnimatePresence initial={false}>
          {workflow.chat.map((m) => (
            <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cx('flex', m.role === 'user' && 'justify-end')}>
              <div className={cx('max-w-[290px] rounded-2xl px-3 py-2 text-[13.5px] leading-[1.55] break-words', m.role === 'user' ? 'bg-user whitespace-pre-wrap' : 'bg-card')}>
                {m.role === 'user' ? m.text : <Markdown text={m.text} />}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {busy && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 text-[13px] text-muted">
            <span className="bg-card rounded-2xl px-3 h-8 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-fg-2 dot-pulse" />
              <span className="w-1.5 h-1.5 rounded-full bg-fg-2 dot-pulse" style={{ animationDelay: '0.15s' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-fg-2 dot-pulse" style={{ animationDelay: '0.3s' }} />
            </span>
            Designing your workflow…
          </motion.div>
        )}
        <div ref={end} />
      </div>
      <form className="p-3 border-t border-divider" onSubmit={(e) => { e.preventDefault(); void send(text) }}>
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-input px-3 py-2 focus-within:border-accent/60">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text) } }}
            rows={2}
            placeholder="e.g. After the scraper, add an agent that finds each lead’s email"
            className="flex-1 resize-none bg-transparent outline-none text-[13.5px] max-h-[140px]"
          />
          <button type="submit" disabled={!text.trim() || busy} aria-label="Send" className="w-8 h-8 rounded-full bg-accent text-accent-text flex items-center justify-center disabled:opacity-40">
            <Send size={14} />
          </button>
        </div>
      </form>
    </div>
  )
}
