import type {
  Agent, AgentTemplate, AppEvent, AuthStatus, ChromeStatus, TelegramStatus, ChatItem, Conversation, McpServerEntry, PluginEntry,
  SearchResult, Settings, SkillEntry, Task, TaskEvent, UsageSummary
} from './types'

/** Result wrapper so the renderer never receives raw exceptions. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

export interface AgentCloudApi {
  // window & app
  windowMinimize(): Promise<void>
  windowToggleMaximize(): Promise<boolean>
  windowClose(): Promise<void>
  windowIsMaximized(): Promise<boolean>
  appInfo(): Promise<{ version: string; platform: string; dataPath: string; logsPath: string }>
  openPath(p: string): Promise<void>
  showInFolder(p: string): Promise<void>
  openExternal(url: string): Promise<void>
  pickFolder(): Promise<string | null>
  pickFiles(): Promise<string[]>
  pickFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null>
  copyDiagnostics(): Promise<void>
  resetApp(): Promise<void>
  openLogsFolder(): Promise<void>
  workspaceExists(): Promise<boolean>
  createDefaultWorkspace(): Promise<string>

  // auth
  authCheck(): Promise<AuthStatus>
  authSaveApiKey(key: string): Promise<Result<AuthStatus>>
  authClearApiKey(): Promise<void>
  authOpenSignIn(): Promise<void>

  // settings
  settingsGet(): Promise<Settings>
  settingsSet(patch: Partial<Settings>): Promise<Settings>

  // agents
  agentsList(): Promise<Agent[]>
  agentsSave(agent: Partial<Agent> & { name: string }): Promise<Agent>
  agentsDelete(id: string): Promise<void>
  agentsDuplicate(id: string): Promise<Agent>
  agentsTemplates(): Promise<AgentTemplate[]>
  agentsExport(id: string): Promise<string | null>
  agentsImport(): Promise<Result<Agent[]>>

  // conversations & chat
  conversationsList(): Promise<Conversation[]>
  conversationsCreate(agentId?: string): Promise<Conversation>
  conversationsOpenForAgent(agentId: string): Promise<Conversation>
  conversationsRename(id: string, title: string): Promise<void>
  conversationsDelete(id: string): Promise<void>
  chatItems(conversationId: string): Promise<ChatItem[]>
  chatSend(conversationId: string, text: string, attachments?: string[]): Promise<Result<void>>
  chatStop(conversationId: string): Promise<void>
  chatRetry(conversationId: string): Promise<void>
  chatBusy(): Promise<Record<string, string | null>>
  answerQuestion(itemId: string, answer: string | null): Promise<void>
  answerPermission(itemId: string, allow: boolean): Promise<void>
  importAttachments(paths: string[]): Promise<Result<string[]>>

  // tasks
  tasksList(): Promise<Task[]>
  tasksEvents(taskId: string): Promise<TaskEvent[]>
  tasksCreate(input: { title: string; description: string; agentId: string | null; priority?: Task['priority']; start?: boolean }): Promise<Task | null>
  tasksStart(id: string): Promise<Result<void>>
  tasksCancel(id: string): Promise<void>
  tasksRetry(id: string): Promise<Result<void>>
  tasksResume(id: string): Promise<Result<void>>
  tasksReassign(id: string, agentId: string): Promise<Task>
  tasksMoveToTodo(id: string): Promise<void>
  tasksAskManagerToFix(id: string): Promise<Result<string>>
  tasksDelete(id: string): Promise<void>
  stopAll(): Promise<number>

  // connections (MCP)
  mcpList(): Promise<McpServerEntry[]>
  mcpSave(name: string, config: Record<string, unknown>, scope: 'user' | 'project'): Promise<Result<void>>
  mcpRemove(name: string, scope: 'user' | 'project'): Promise<Result<void>>
  mcpTest(name: string, config: Record<string, unknown>): Promise<{ ok: boolean; message: string; details?: string }>

  // skills
  skillsList(): Promise<SkillEntry[]>
  skillsAdd(source: string, scope: 'user' | 'project'): Promise<Result<void>>
  skillsToggle(name: string, enabled: boolean): Promise<void>
  skillsRemove(path: string): Promise<Result<void>>

  // plugins
  pluginsList(): Promise<PluginEntry[]>
  pluginsToggle(id: string, enabled: boolean): Promise<Result<void>>
  pluginsInstallLocal(path: string): Promise<Result<void>>
  pluginsInstallMarketplace(source: string, plugin?: string): Promise<Result<string>>
  pluginsRemove(id: string): Promise<Result<void>>

  // Chrome & Telegram
  chromeStatus(): Promise<ChromeStatus>
  telegramStatus(): Promise<TelegramStatus>
  telegramConnect(token: string): Promise<Result<TelegramStatus>>
  telegramDisconnect(): Promise<void>
  telegramUnlink(chatId: number): Promise<TelegramStatus>
  telegramNewCode(): Promise<TelegramStatus>

  // misc
  usageSummary(): Promise<UsageSummary>
  search(q: string): Promise<SearchResult[]>
}

export const API_METHODS: (keyof AgentCloudApi)[] = [
  'windowMinimize', 'windowToggleMaximize', 'windowClose', 'windowIsMaximized', 'appInfo', 'openPath', 'showInFolder',
  'openExternal', 'pickFolder', 'pickFiles', 'pickFile', 'copyDiagnostics', 'resetApp', 'openLogsFolder', 'workspaceExists', 'createDefaultWorkspace',
  'authCheck', 'authSaveApiKey', 'authClearApiKey', 'authOpenSignIn',
  'settingsGet', 'settingsSet',
  'agentsList', 'agentsSave', 'agentsDelete', 'agentsDuplicate', 'agentsTemplates', 'agentsExport', 'agentsImport',
  'conversationsList', 'conversationsCreate', 'conversationsOpenForAgent', 'conversationsRename', 'conversationsDelete',
  'chatItems', 'chatSend', 'chatStop', 'chatRetry', 'chatBusy', 'answerQuestion', 'answerPermission', 'importAttachments',
  'tasksList', 'tasksEvents', 'tasksCreate', 'tasksStart', 'tasksCancel', 'tasksRetry', 'tasksResume', 'tasksReassign',
  'tasksMoveToTodo', 'tasksAskManagerToFix', 'tasksDelete', 'stopAll',
  'mcpList', 'mcpSave', 'mcpRemove', 'mcpTest',
  'skillsList', 'skillsAdd', 'skillsToggle', 'skillsRemove',
  'pluginsList', 'pluginsToggle', 'pluginsInstallLocal', 'pluginsInstallMarketplace', 'pluginsRemove',
  'chromeStatus', 'telegramStatus', 'telegramConnect', 'telegramDisconnect', 'telegramUnlink', 'telegramNewCode',
  'usageSummary', 'search'
]

export interface PreloadBridge extends AgentCloudApi {
  onEvent(listener: (e: AppEvent) => void): () => void
  getPathForFile(file: File): string
}
