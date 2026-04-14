import type { TerminalThemeDefinition, TerminalThemePatch, TerminalThemeState } from '../../shared/terminal-theme'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

interface ChatConversation {
  id: string
  projectId: string | null
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

interface ChatAPI {
  getConversation: (projectId: string | null) => Promise<ChatConversation>
  sendMessage: (projectId: string | null, content: string) => Promise<ChatConversation>
  getMessages: (projectId: string | null) => Promise<ChatMessage[]>
}

interface TerminalAPI {
  create: (projectId: string, cwd: string, shell?: string) => Promise<string>
  list: (projectId?: string) => Promise<
    Array<{
      id: string
      projectId: string
      cwd: string
      shell: string
    }>
  >
  write: (id: string, data: string) => void
  resize: (id: string, cols: number, rows: number) => void
  kill: (id: string) => void
  subscribe: (id: string) => void
  unsubscribe: (id: string) => void
  onData: (id: string, callback: (data: string) => void) => () => void
}

interface StoreAPI {
  getProjects: () => Promise<
    Array<{
      id: string
      name: string
      status: 'active' | 'planning' | 'done'
      path: string | null
      createdAt: number
    }>
  >
  addProject: (project: {
    id: string
    name: string
    status: 'active' | 'planning' | 'done'
    path?: string | null
    createdAt: number
  }) => Promise<
    Array<{
      id: string
      name: string
      status: 'active' | 'planning' | 'done'
      path: string | null
      createdAt: number
    }>
  >
  updateProject: (
    id: string,
    updates: Partial<{ name: string; status: 'active' | 'planning' | 'done'; path: string }>
  ) => Promise<
    Array<{
      id: string
      name: string
      status: 'active' | 'planning' | 'done'
      path: string | null
      createdAt: number
    }>
  >
  deleteProject: (id: string) => Promise<
    Array<{
      id: string
      name: string
      status: 'active' | 'planning' | 'done'
      path: string | null
      createdAt: number
    }>
  >
  getProjectData: (projectId: string) => Promise<{
    status: 'active' | 'planning' | 'done'
    createdAt: number
    goals: unknown[]
    settings: Record<string, unknown>
    repositories?: string[]
    notes?: string
  } | null>
  updateProjectData: (projectId: string, updates: Record<string, unknown>) => Promise<Record<string, unknown> | null>
}

interface FileEntry {
  name: string
  type: 'file' | 'directory'
  size: number
  modifiedAt: number
}

interface FileReadResult {
  content: string
  encoding: 'text' | 'image' | 'unsupported' | 'error'
  mimeType?: string
  truncated?: boolean
  errorCode?: 'permission-denied' | 'read-failed'
}

interface FsAPI {
  readDir: (dirPath: string) => Promise<FileEntry[]>
  readFile: (filePath: string) => Promise<FileReadResult>
  writeFile: (filePath: string, content: string) => Promise<void>
  openInSystem: (filePath: string) => Promise<string>
}

interface AgentStatusEvent {
  source: string
  cwd: string
  sessionId: string
  status: 'idle' | 'working' | 'waiting' | 'done' | 'error'
  hookName: string
  toolName?: string
  timestamp: number
}

interface HookRuntimeStatus {
  running: boolean
  installed: boolean
  port: number | null
  lastError: string | null
  lastEventAt: number | null
}

interface SessionRecord {
  id: string
  projectId: string
  cwd: string
  shell: string
  label: string
  createdAt: number
  updatedAt: number
  lifecycle: 'live' | 'closed' | 'exited' | 'crashed' | 'interrupted'
  lastStatus: 'idle' | 'working' | 'waiting' | 'done' | 'error'
  lastEventSummary: string
  source?: string | null
  lastHookName?: string | null
  lastToolName?: string | null
}

interface ElectronAPI {
  platform: string
  homeDir: string
  store: StoreAPI
  chat: ChatAPI
  fs: FsAPI
  hook: {
    getStatus: () => Promise<HookRuntimeStatus>
  }
  session: {
    list: (projectId?: string) => Promise<SessionRecord[]>
    rename: (sessionId: string, label: string) => Promise<SessionRecord | null>
    remove: (sessionId: string) => Promise<boolean>
    onRemoved: (callback: (sessionId: string) => void) => () => void
    onUpdated: (callback: (record: SessionRecord) => void) => () => void
  }
  terminal: TerminalAPI
  terminalTheme: {
    getState: () => Promise<TerminalThemeState>
    setActiveTheme: (themeId: string) => Promise<TerminalThemeState>
    createTheme: (input?: { basedOnThemeId?: string; name?: string }) => Promise<TerminalThemeDefinition>
    updateTheme: (themeId: string, patch: TerminalThemePatch) => Promise<TerminalThemeDefinition | null>
    deleteTheme: (themeId: string) => Promise<boolean>
    duplicateTheme: (themeId: string) => Promise<TerminalThemeDefinition | null>
    onDidChange: (callback: (state: TerminalThemeState) => void) => () => void
  }
  openFolder: () => Promise<string | null>
  cloneRepository: (cloneUrl: string, destinationParent: string) => Promise<{
    name: string
    path: string
    createdAt: number
  }>
  onShortcut: (callback: (action: string) => void) => () => void
  onAgentStatus: (callback: (status: AgentStatusEvent) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
