import { contextBridge, ipcRenderer } from 'electron'
import type { TerminalThemeDefinition, TerminalThemePatch, TerminalThemeState } from '../shared/terminal-theme'
import type { ToWorker, ToMain } from '../shared/agent-protocol'

interface AgentStatusEvent {
  source: string
  cwd: string
  status: 'idle' | 'working' | 'waiting' | 'done' | 'error'
  hookName: string
  toolName?: string
  timestamp: number
}

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  homeDir: process.env.HOME || process.env.USERPROFILE || '~',
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  cloneRepository: (cloneUrl: string, destinationParent: string) =>
    ipcRenderer.invoke('project:cloneRepository', cloneUrl, destinationParent),
  hook: {
    getStatus: () => ipcRenderer.invoke('hook:getStatus'),
  },
  session: {
    list: (projectId?: string) => ipcRenderer.invoke('session:list', projectId),
    rename: (sessionId: string, label: string) => ipcRenderer.invoke('session:rename', sessionId, label),
    remove: (sessionId: string) => ipcRenderer.invoke('session:remove', sessionId),
    onRemoved: (callback: (sessionId: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, sessionId: string) => callback(sessionId)
      ipcRenderer.on('session:removed', listener)
      return () => {
        ipcRenderer.removeListener('session:removed', listener)
      }
    },
    onUpdated: (callback: (record: SessionRecord) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, record: SessionRecord) => callback(record)
      ipcRenderer.on('session:updated', listener)
      return () => {
        ipcRenderer.removeListener('session:updated', listener)
      }
    },
  },
  store: {
    getProjects: () => ipcRenderer.invoke('store:getProjects'),
    addProject: (project: { id: string; name: string; status: string; path?: string | null; createdAt: number }) =>
      ipcRenderer.invoke('store:addProject', project),
    updateProject: (id: string, updates: Record<string, unknown>) =>
      ipcRenderer.invoke('store:updateProject', id, updates),
    deleteProject: (id: string) =>
      ipcRenderer.invoke('store:deleteProject', id),
    getProjectData: (projectId: string) =>
      ipcRenderer.invoke('store:getProjectData', projectId),
    updateProjectData: (projectId: string, updates: Record<string, unknown>) =>
      ipcRenderer.invoke('store:updateProjectData', projectId, updates),
  },
  fs: {
    readDir: (dirPath: string) => ipcRenderer.invoke('fs:readDir', dirPath),
    readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
    openInSystem: (filePath: string) => ipcRenderer.invoke('fs:openInSystem', filePath),
  },
  // =============================================================================
  // PHASE-5 TODO: legacy ProjectChat electronAPI.chat namespace kept alive
  // during Phases 1-4. ProjectChat still uses this; the Chief Agent routes
  // through electronAPI.chief below instead. Phase 5 migrates ProjectChat to
  // the agent worker and deletes this namespace along with the chat:* IPC
  // handlers in src/main/index.ts and src/main/conversation-store.ts.
  // Until then: leave it alone.
  // =============================================================================
  chat: {
    getConversation: (projectId: string | null) =>
      ipcRenderer.invoke('chat:getConversation', projectId),
    sendMessage: (projectId: string | null, content: string) =>
      ipcRenderer.invoke('chat:sendMessage', projectId, content),
    getMessages: (projectId: string | null) =>
      ipcRenderer.invoke('chat:getMessages', projectId),
  },
  chief: {
    send: (message: ToWorker) => ipcRenderer.invoke('chief:send', message),
    onEvent: (callback: (message: ToMain) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, message: ToMain) => callback(message)
      ipcRenderer.on('chief:event', listener)
      return () => {
        ipcRenderer.removeListener('chief:event', listener)
      }
    },
  },
  onShortcut: (callback: (action: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, action: string) => callback(action)
    ipcRenderer.on('shortcut', listener)
    return () => {
      ipcRenderer.removeListener('shortcut', listener)
    }
  },
  terminal: {
    create: (projectId: string, cwd: string, shell?: string) =>
      ipcRenderer.invoke('terminal:create', projectId, cwd, shell),
    list: (projectId?: string) =>
      ipcRenderer.invoke('terminal:list', projectId),
    write: (id: string, data: string) =>
      ipcRenderer.send('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.send('terminal:resize', id, cols, rows),
    kill: (id: string) =>
      ipcRenderer.send('terminal:kill', id),
    subscribe: (id: string) =>
      ipcRenderer.send('terminal:subscribe', id),
    unsubscribe: (id: string) =>
      ipcRenderer.send('terminal:unsubscribe', id),
    onData: (id: string, callback: (data: string) => void) => {
      const channel = `terminal:data:${id}`
      const listener = (_event: Electron.IpcRendererEvent, data: string) => callback(data)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    }
  },
  terminalTheme: {
    getState: () => ipcRenderer.invoke('terminalTheme:getState'),
    setActiveTheme: (themeId: string) => ipcRenderer.invoke('terminalTheme:setActiveTheme', themeId),
    createTheme: (input?: { basedOnThemeId?: string; name?: string }) =>
      ipcRenderer.invoke('terminalTheme:createTheme', input),
    updateTheme: (themeId: string, patch: TerminalThemePatch) =>
      ipcRenderer.invoke('terminalTheme:updateTheme', themeId, patch),
    deleteTheme: (themeId: string) =>
      ipcRenderer.invoke('terminalTheme:deleteTheme', themeId),
    duplicateTheme: (themeId: string) =>
      ipcRenderer.invoke('terminalTheme:duplicateTheme', themeId),
    onDidChange: (callback: (state: TerminalThemeState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: TerminalThemeState) => callback(state)
      ipcRenderer.on('terminalTheme:changed', listener)
      return () => {
        ipcRenderer.removeListener('terminalTheme:changed', listener)
      }
    },
  },
  onAgentStatus: (callback: (status: AgentStatusEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: AgentStatusEvent) => callback(data)
    ipcRenderer.on('agent:status', listener)
    return () => {
      ipcRenderer.removeListener('agent:status', listener)
    }
  }
})
