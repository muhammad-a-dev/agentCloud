// Types shared between the Electron main process and the renderer.

export type ModelChoice = 'smartest' | 'balanced' | 'fastest'

/** Friendly capability keys shown as checkboxes; mapped to SDK tool names in the main process. */
export type Capability = 'read' | 'write' | 'commands' | 'web_search' | 'web_fetch' | 'browser' | 'skills' | 'helpers'

export interface Agent {
  id: string
  name: string
  role: string
  avatar: string // emoji or avatar id
  color: string
  instructions: string
  tools: Capability[]
  model: ModelChoice
  mcp: string[] // names of connections this agent may use; empty = all
  skills: string[] // skill names; empty = all
  isManager: boolean
  createdAt: number
  updatedAt: number
  // computed
  status?: 'idle' | 'working' | 'error'
  tasksDone?: number
}

export interface Conversation {
  id: string
  agentId: string
  title: string
  sdkSessionId: string | null
  createdAt: number
  updatedAt: number
  preview?: string
}

/** A picture, video or document shown in the chat. */
export interface MediaRef {
  /** Absolute, or relative to the workspace. */
  path: string
  name: string
}

export type ChatItem =
  | { kind: 'text'; id: string; role: 'user' | 'assistant'; text: string; attachments?: string[]; createdAt: number; queued?: boolean; source?: 'telegram' }
  | { kind: 'tool'; id: string; toolUseId: string; name: string; input: Record<string, unknown>; result?: string; isError?: boolean; media?: MediaRef[]; status: 'running' | 'done' | 'error'; createdAt: number }
  | { kind: 'question'; id: string; question: string; options: string[]; allowCustom: boolean; from?: string; taskId?: string; answer?: string; dismissed?: boolean; createdAt: number }
  | { kind: 'permission'; id: string; toolName: string; input: Record<string, unknown>; from?: string; taskId?: string; decision?: 'allow' | 'deny'; createdAt: number }
  | { kind: 'notice'; id: string; level: 'info' | 'success' | 'warning' | 'error'; text: string; taskId?: string; createdAt: number }
  | { kind: 'error'; id: string; error: FriendlyError; createdAt: number }

export type ErrorKind = 'auth' | 'network' | 'rate_limit' | 'billing' | 'workspace' | 'aborted' | 'unknown'

export interface FriendlyError {
  kind: ErrorKind
  title: string
  reason: string
  action?: 'reconnect' | 'retry' | 'choose_workspace' | 'ask_manager' | 'none'
  details?: string
}

export type TaskStatus = 'todo' | 'in_progress' | 'needs_input' | 'done' | 'failed' | 'cancelled' | 'interrupted'

export interface Task {
  id: string
  title: string
  description: string
  agentId: string | null
  conversationId: string | null
  status: TaskStatus
  priority: 'low' | 'normal' | 'high'
  sdkSessionId: string | null
  report: string | null
  error: string | null
  costUsd: number
  tokens: number
  lastActivity: string | null
  filesChanged: string[]
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
}

export interface TaskEvent {
  id: string
  taskId: string
  type: 'status' | 'text' | 'tool' | 'tool_result' | 'file' | 'error' | 'report'
  payload: Record<string, unknown>
  createdAt: number
}

export interface Settings {
  onboarded: boolean
  tourDone: boolean
  workspace: string | null
  managerName: string
  managerRole: string
  managerAvatar: string
  managerPersona: string
  userName: string
  theme: 'dark' | 'light'
  launchOnStartup: boolean
  notifications: boolean
  permissionMode: 'full' | 'ask'
  allowedCommands: string[]
  blockedCommands: string[]
  disabledSkills: string[]
  localPlugins: string[]
  chromeEnabled: boolean
  telegramEnabled: boolean
}

export interface AuthStatus {
  ok: boolean
  method: 'claude' | 'api_key' | 'none'
  email?: string
  plan?: string
  hasStoredKey: boolean
  message?: string
}

export interface McpServerEntry {
  name: string
  scope: 'user' | 'project' | 'plugin'
  config: Record<string, unknown>
  status?: 'connected' | 'error' | 'unknown' | 'testing'
  error?: string
}

export interface SkillEntry {
  name: string
  description: string
  path: string
  scope: 'user' | 'project'
  enabled: boolean
}

export interface PluginEntry {
  id: string
  version?: string
  scope: string
  enabled: boolean
  installPath?: string
  local?: boolean
}

export interface ChromeStatus {
  enabled: boolean
  extensionInstalled: boolean
  paired: boolean
}

export interface TelegramStatus {
  connected: boolean
  running: boolean
  botUsername: string | null
  pairingCode: string | null
  chats: { id: number; name: string }[]
  error: string | null
}

export interface UsageSummary {
  totalCost: number
  totalTokens: number
  byDay: { day: string; cost: number; tokens: number }[]
  byAgent: { agentId: string; name: string; cost: number; tokens: number }[]
  byTask: { taskId: string; title: string; cost: number; tokens: number }[]
}

export interface SearchResult {
  type: 'conversation' | 'task' | 'agent' | 'message'
  id: string
  title: string
  subtitle: string
  conversationId?: string
}

/** Events pushed from main → renderer over a single channel. */
export type AppEvent =
  | { type: 'chat:item'; conversationId: string; item: ChatItem }
  | { type: 'chat:delta'; conversationId: string; text: string }
  | { type: 'chat:status'; conversationId: string; busy: boolean; activity?: string | null }
  | { type: 'chat:retry'; conversationId: string; seconds: number; attempt: number; maxAttempts: number }
  | { type: 'conversations:changed' }
  | { type: 'agents:changed'; hiredId?: string }
  | { type: 'task:update'; task: Task }
  | { type: 'task:event'; event: TaskEvent }
  | { type: 'task:celebrate'; taskId: string }
  | { type: 'toast'; level: 'info' | 'success' | 'warning' | 'error'; message: string }
  | { type: 'navigate'; to: 'task' | 'conversation'; id: string }
  | { type: 'window:maximized'; value: boolean }
  | { type: 'shortcut'; name: 'stop-all' }
  | { type: 'telegram:status'; status: TelegramStatus }

export interface AgentTemplate {
  key: string
  name: string
  role: string
  avatar: string
  color: string
  instructions: string
  tools: Capability[]
  model: ModelChoice
}
