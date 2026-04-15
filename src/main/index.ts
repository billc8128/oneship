import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron'
import { spawn } from 'child_process'
import { join, dirname } from 'path'
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { TerminalManager } from './terminal-manager'
import { getGlobalStateDir, loadConfig, saveConfig } from './config-store'
import { initProjectDir, loadProjectData, saveProjectData, type ProjectData } from './project-store'
// =============================================================================
// PHASE-5 TODO: legacy ProjectChat IPC kept alive during Phases 1-4.
//
// The Chief Agent (Phase 1+) does NOT use this — it routes through the
// agent worker via chief:send/chief:event below. ProjectChat (the in-project
// Project Lead chat) still uses the old simple {role, content} message model
// and the chat:* IPC, and Phase 1 deliberately does not touch it. Phase 5
// migrates ProjectChat to the agent worker and at that point everything in
// this block (the imports, the handlers, src/main/conversation-store.ts,
// the electronAPI.chat preload namespace, and the old Message type) gets
// deleted. Until then: leave it alone.
// =============================================================================
import {
  getOrCreateConversation,
  addMessage,
  saveConversation,
  type Conversation
} from './conversation-store'
import { HookServer, mapHookEventToStatus } from './hook-server'
import { installHooks } from './hook-installer'
import { resolveAvailablePort } from './hook-runtime'
import { planCloneProject } from './clone-flow'
import { getFileKind, getImageMimeType } from './file-type'
import { assertPathAllowed } from './path-guard'
import { linkProjectWorkspace } from './project-linking'
import { SessionStore, type SessionRecord } from './session-store'
import { TerminalThemeStore } from './terminal-theme-store'
import type { TerminalThemePatch } from '../shared/terminal-theme'
import { AgentHost } from './agent-host'
import type { ToWorker } from '../shared/agent-protocol'
import { installRuntimeUserDataPath, runtimePaths, shouldAutoInstallHooks } from './runtime-paths'

installRuntimeUserDataPath()

const MAX_TEXT_SIZE = 100 * 1024 // 100KB

const terminalManager = new TerminalManager()
const sessionStore = new SessionStore(join(getGlobalStateDir(), 'runtime'))
const terminalThemeStore = new TerminalThemeStore(getGlobalStateDir())
const agentHost = new AgentHost()
let isShuttingDown = false
const hookRuntimeStatus = {
  running: false,
  installed: false,
  port: null as number | null,
  lastError: null as string | null,
  lastEventAt: null as number | null,
}

const hookServer = new HookServer({
  onEvent: (event) => {
    hookRuntimeStatus.lastEventAt = event.timestamp
    if (event.terminalSessionId) {
      const previousStatus = sessionStore.get(event.terminalSessionId)?.lastStatus ?? null
      patchSession(event.terminalSessionId, {
        source: event.source,
        lastHookName: event.event?.hook_event_name ?? null,
        lastToolName: event.event?.tool_name ?? null,
        lastStatus: mapHookEventToStatus({
          hookName: event.event?.hook_event_name || '',
          notificationType: event.event?.notification_type ?? null,
          previousStatus,
        }),
        lastEventSummary: event.event?.tool_name
          ? `${event.event.hook_event_name || 'Hook'} · ${event.event.tool_name}`
          : event.event?.hook_event_name || 'Hook',
        updatedAt: event.timestamp,
      })
    }
  },
  onError: (error) => {
    hookRuntimeStatus.running = false
    hookRuntimeStatus.lastError = error.message
  }
})

function toProjectSummary(ref: { id: string; name: string; path: string | null; createdAt?: number }) {
  if (ref.path) {
    const data = loadProjectData(ref.path)
    return {
      id: ref.id,
      name: ref.name,
      path: ref.path,
      status: data?.status ?? 'active',
      createdAt: data?.createdAt ?? ref.createdAt ?? Date.now()
    }
  }

  return {
    id: ref.id,
    name: ref.name,
    path: null,
    status: 'planning' as const,
    createdAt: ref.createdAt ?? Date.now()
  }
}

function getAllowedProjectRoots(): string[] {
  return loadConfig().projects.flatMap((project) => (project.path ? [project.path] : []))
}

function createSessionLabel(projectId: string): string {
  return `Terminal ${sessionStore.nextTerminalNumber(projectId)}`
}

function broadcastSessionUpdated(record: SessionRecord | null): void {
  if (!record) {
    return
  }

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('session:updated', record)
    }
  }
}

function broadcastSessionRemoved(sessionId: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('session:removed', sessionId)
    }
  }
}

function patchSession(id: string, patch: Partial<SessionRecord>): SessionRecord | null {
  const record = sessionStore.patch(id, patch)
  broadcastSessionUpdated(record)
  return record
}

function upsertSession(record: SessionRecord): void {
  sessionStore.upsert(record)
  broadcastSessionUpdated(record)
}

function forgetSession(id: string): boolean {
  const removed = sessionStore.forget(id)
  if (removed) {
    broadcastSessionRemoved(id)
  }
  return removed
}

function broadcastTerminalThemeChanged(): void {
  const state = terminalThemeStore.getState()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('terminalTheme:changed', state)
    }
  }
}

async function runGitClone(cloneUrl: string, destinationParent: string) {
  const plan = planCloneProject({ cloneUrl, destinationParent })

  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', ['clone', plan.cloneUrl, plan.targetPath], {
      cwd: plan.destinationParent,
      env: process.env
    })

    let stderr = ''

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(stderr.trim() || `git clone failed with exit code ${code}`))
    })
  })

  return {
    repoName: plan.repoName,
    targetPath: plan.targetPath
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 768,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 14 },
    backgroundColor: '#FAF8F5',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

terminalManager.onSessionExit((session) => {
  const existing = sessionStore.get(session.id)
  if (!existing) {
    return
  }

  if (existing.lifecycle !== 'live') {
    return
  }

  if (isShuttingDown) {
    return
  }

  patchSession(session.id, {
    lifecycle: existing.lastStatus === 'error' ? 'crashed' : 'exited',
    updatedAt: Date.now(),
  })
})

// Terminal IPC handlers
ipcMain.handle('terminal:create', (_event, projectId: string, cwd: string, shell?: string) => {
  const resolvedShell = shell || process.env.SHELL || '/bin/zsh'
  const sessionId = terminalManager.create(projectId, cwd, shell)
  const now = Date.now()
  upsertSession({
    id: sessionId,
    projectId,
    cwd,
    shell: resolvedShell,
    label: createSessionLabel(projectId),
    createdAt: now,
    updatedAt: now,
    lifecycle: 'live',
    lastStatus: 'idle',
    lastEventSummary: '',
    source: null,
    lastHookName: null,
    lastToolName: null,
  })
  return sessionId
})

ipcMain.handle('terminal:list', (_event, projectId?: string) => {
  return terminalManager.listSessions(projectId)
})

ipcMain.handle('session:list', (_event, projectId?: string) => {
  return sessionStore.listByProject(projectId)
})

ipcMain.handle('session:rename', (_event, sessionId: string, label: string) => {
  return patchSession(sessionId, {
    label,
    updatedAt: Date.now(),
  })
})

ipcMain.handle('session:remove', (_event, sessionId: string) => {
  const existing = sessionStore.get(sessionId)
  if (!existing || existing.lifecycle === 'live') {
    return false
  }

  return forgetSession(sessionId)
})

ipcMain.on('terminal:write', (_event, id: string, data: string) => {
  terminalManager.write(id, data)
})

ipcMain.on('terminal:resize', (_event, id: string, cols: number, rows: number) => {
  terminalManager.resize(id, cols, rows)
})

ipcMain.on('terminal:kill', (_event, id: string) => {
  patchSession(id, {
    lifecycle: 'closed',
    updatedAt: Date.now(),
  })
  terminalManager.kill(id)
})

// Track active subscriptions per terminal session to prevent duplicates
const activeSubscriptions = new Map<string, () => void>()

ipcMain.on('terminal:subscribe', (event, id: string) => {
  // Clean up any existing subscription for this session to prevent duplicate listeners
  const existingUnsubscribe = activeSubscriptions.get(id)
  if (existingUnsubscribe) {
    existingUnsubscribe()
  }

  const unsubscribe = terminalManager.onData(id, (data: string) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(`terminal:data:${id}`, data)
    }
  })

  activeSubscriptions.set(id, unsubscribe)

  // Clean up when the renderer is destroyed
  event.sender.once('destroyed', () => {
    unsubscribe()
    activeSubscriptions.delete(id)
  })
})

ipcMain.on('terminal:unsubscribe', (_event, id: string) => {
  const unsubscribe = activeSubscriptions.get(id)
  if (unsubscribe) {
    unsubscribe()
    activeSubscriptions.delete(id)
  }
})

// Store IPC handlers
ipcMain.handle('store:getProjects', () => {
  const config = loadConfig()
  return config.projects.map(toProjectSummary)
})

ipcMain.handle('store:addProject', (_event, project: { id: string; name: string; status: 'active' | 'planning' | 'done'; path?: string; createdAt: number }) => {
  const config = loadConfig()
  const ref = { id: project.id, name: project.name, path: project.path ?? null, createdAt: project.createdAt }
  config.projects.push(ref)
  saveConfig(config)

  if (ref.path) {
    initProjectDir(ref.path)
    saveProjectData(ref.path, {
      status: project.status,
      createdAt: project.createdAt,
      goals: [],
      settings: {}
    })
  }

  // Return merged list for compatibility
  return config.projects.map(toProjectSummary)
})

ipcMain.handle('store:updateProject', (_event, id: string, updates: Partial<{ name: string; status: 'active' | 'planning' | 'done'; path: string }>) => {
  const config = loadConfig()
  const refIndex = config.projects.findIndex((p) => p.id === id)
  if (refIndex === -1) return []

  const ref = config.projects[refIndex]

  // Update config-level fields (name, path)
  if (updates.name !== undefined) ref.name = updates.name
  const pathJustSet = updates.path !== undefined && ref.path === null
  if (updates.path !== undefined) ref.path = updates.path

  config.projects[refIndex] = ref
  saveConfig(config)

  // If path was just set, initialize the .oneship directory and migrate any planning chat
  if (pathJustSet && ref.path) {
    linkProjectWorkspace({
      projectId: id,
      nextPath: ref.path,
      globalStateDir: getGlobalStateDir(),
      projectData: {
        status: updates.status ?? 'active',
        createdAt: ref.createdAt ?? Date.now(),
        goals: [],
        settings: {}
      }
    })
  } else if (ref.path) {
    // Update project-level fields (status, goals, etc.) in project.json
    const existing = loadProjectData(ref.path)
    const projectData: ProjectData = existing ?? { status: 'active', createdAt: ref.createdAt ?? Date.now(), goals: [], settings: {} }
    if (updates.status !== undefined) projectData.status = updates.status
    saveProjectData(ref.path, projectData)
  }

  // Return merged list for compatibility
  return config.projects.map(toProjectSummary)
})

ipcMain.handle('store:deleteProject', (_event, id: string) => {
  const config = loadConfig()
  config.projects = config.projects.filter((p) => p.id !== id)
  saveConfig(config)

  // Return merged list for compatibility
  return config.projects.map(toProjectSummary)
})

// Project data IPC handlers (extended project.json fields)
ipcMain.handle('store:getProjectData', (_event, projectId: string) => {
  const projectPath = resolveProjectPath(projectId)
  if (!projectPath) return null
  return loadProjectData(projectPath)
})

ipcMain.handle('store:updateProjectData', (_event, projectId: string, updates: Record<string, unknown>) => {
  const projectPath = resolveProjectPath(projectId)
  if (!projectPath) return null
  const existing = loadProjectData(projectPath)
  const projectData: ProjectData = existing ?? { status: 'active', createdAt: Date.now(), goals: [], settings: {} }
  const merged = { ...projectData, ...updates }
  saveProjectData(projectPath, merged as ProjectData)
  return merged
})

// Filesystem IPC handlers
ipcMain.handle('fs:readDir', (_event, dirPath: string) => {
  assertPathAllowed(dirPath, getAllowedProjectRoots())

  const entries = readdirSync(dirPath, { withFileTypes: true })
  return entries
    .filter((e) => e.name !== '.DS_Store')
    .map((e) => {
      const fullPath = join(dirPath, e.name)
      try {
        const stats = statSync(fullPath)
        return {
          name: e.name,
          type: e.isDirectory() ? 'directory' as const : 'file' as const,
          size: stats.size,
          modifiedAt: stats.mtimeMs,
        }
      } catch {
        return {
          name: e.name,
          type: e.isDirectory() ? 'directory' as const : 'file' as const,
          size: 0,
          modifiedAt: 0,
        }
      }
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
})

ipcMain.handle('fs:readFile', (_event, filePath: string) => {
  try {
    assertPathAllowed(filePath, getAllowedProjectRoots())
    const fileKind = getFileKind(filePath)

    if (fileKind === 'image') {
      const buffer = readFileSync(filePath)
      return {
        content: buffer.toString('base64'),
        encoding: 'image' as const,
        mimeType: getImageMimeType(filePath)
      }
    }

    if (fileKind === 'text') {
      const stats = statSync(filePath)
      let content = readFileSync(filePath, 'utf-8')
      let truncated = false

      if (stats.size > MAX_TEXT_SIZE) {
        content = content.slice(0, MAX_TEXT_SIZE)
        truncated = true
      }

      return {
        content,
        encoding: 'text' as const,
        truncated
      }
    }

    return { content: '', encoding: 'unsupported' as const }
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : '',
      encoding: 'error' as const,
      errorCode: error instanceof Error && error.message.includes('outside allowed roots')
        ? 'permission-denied'
        : 'read-failed'
    }
  }
})

ipcMain.handle('fs:writeFile', (_event, filePath: string, content: string) => {
  assertPathAllowed(filePath, getAllowedProjectRoots())
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(filePath, content, 'utf-8')
})

ipcMain.handle('fs:openInSystem', (_event, filePath: string) => {
  assertPathAllowed(filePath, getAllowedProjectRoots())
  return shell.openPath(filePath)
})

// Dialog IPC handler
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('project:cloneRepository', async (_event, cloneUrl: string, destinationParent: string) => {
  const cloned = await runGitClone(cloneUrl, destinationParent)
  return {
    name: cloned.repoName,
    path: cloned.targetPath,
    createdAt: Date.now()
  }
})

ipcMain.handle('hook:getStatus', () => {
  return { ...hookRuntimeStatus }
})

// Helper: resolve projectPath from projectId
function resolveProjectPath(projectId: string | null): string | null {
  if (projectId === null) return null
  const config = loadConfig()
  const ref = config.projects.find((p) => p.id === projectId)
  return ref?.path ?? null
}

// =============================================================================
// PHASE-5 TODO: legacy ProjectChat chat:* IPC handlers kept alive during
// Phases 1-4. ProjectChat still uses this; the Chief Agent routes through
// chief:send/chief:event below instead. Phase 5 migrates ProjectChat to the
// agent worker and deletes everything in this block along with
// src/main/conversation-store.ts and electronAPI.chat in the preload.
// Until then: leave it alone.
// =============================================================================
// Chat IPC handlers
ipcMain.handle('chat:getConversation', (_event, projectId: string | null): Conversation => {
  const projectPath = resolveProjectPath(projectId)
  return getOrCreateConversation(projectPath, projectId)
})

ipcMain.handle('chat:sendMessage', async (_event, projectId: string | null, content: string): Promise<Conversation> => {
  const projectPath = resolveProjectPath(projectId)
  const conversation = getOrCreateConversation(projectPath, projectId)

  // Add user message
  addMessage(conversation, 'user', content)
  saveConversation(projectPath, conversation)

  // Add mock assistant reply after a short delay
  await new Promise((resolve) => setTimeout(resolve, 500))
  addMessage(conversation, 'assistant', 'I received your message. AI responses will be available in a future update.')
  saveConversation(projectPath, conversation)

  return conversation
})

ipcMain.handle('chat:getMessages', (_event, projectId: string | null) => {
  const projectPath = resolveProjectPath(projectId)
  const conversation = getOrCreateConversation(projectPath, projectId)
  return conversation.messages
})

ipcMain.handle('terminalTheme:getState', () => {
  return terminalThemeStore.getState()
})

ipcMain.handle('terminalTheme:setActiveTheme', (_event, themeId: string) => {
  const state = terminalThemeStore.setActiveTheme(themeId)
  broadcastTerminalThemeChanged()
  return state
})

ipcMain.handle('terminalTheme:createTheme', (_event, input?: { basedOnThemeId?: string; name?: string }) => {
  const created = terminalThemeStore.createTheme(input)
  broadcastTerminalThemeChanged()
  return created
})

ipcMain.handle('terminalTheme:updateTheme', (_event, themeId: string, patch: TerminalThemePatch) => {
  const updated = terminalThemeStore.updateTheme(themeId, patch)
  if (updated) {
    broadcastTerminalThemeChanged()
  }
  return updated
})

ipcMain.handle('terminalTheme:deleteTheme', (_event, themeId: string) => {
  const deleted = terminalThemeStore.deleteTheme(themeId)
  if (deleted) {
    broadcastTerminalThemeChanged()
  }
  return deleted
})

ipcMain.handle('terminalTheme:duplicateTheme', (_event, themeId: string) => {
  const duplicated = terminalThemeStore.duplicateTheme(themeId)
  if (duplicated) {
    broadcastTerminalThemeChanged()
  }
  return duplicated
})

// Chief Agent IPC — proxies to the agent worker.
// Note: this lives ALONGSIDE the legacy chat:* handlers above, not instead
// of them. See the PHASE-5 TODO comment block.
ipcMain.handle('chief:send', (_event, msg: ToWorker) => {
  agentHost.send(msg)
})

function setupApplicationMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Oneship',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Project',
          accelerator: 'CmdOrCtrl+N',
          click: (_, win) => win?.webContents.send('shortcut', 'new-project')
        },
        {
          label: 'New Terminal',
          accelerator: 'CmdOrCtrl+T',
          click: (_, win) => win?.webContents.send('shortcut', 'new-terminal')
        },
        {
          label: 'Close Terminal',
          accelerator: 'CmdOrCtrl+W',
          click: (_, win) => win?.webContents.send('shortcut', 'close-terminal')
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: (_, win) => win?.webContents.send('shortcut', 'settings')
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: (_, win) => win?.webContents.send('shortcut', 'toggle-sidebar')
        },
        {
          label: 'Toggle Files',
          accelerator: 'CmdOrCtrl+E',
          click: (_, win) => win?.webContents.send('shortcut', 'toggle-files')
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'reload' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' }
      ]
    }
  ]

  // Cmd+1 through Cmd+9 for terminal tab switching
  const fileSubmenu = template[1].submenu as Electron.MenuItemConstructorOptions[]
  for (let i = 1; i <= 9; i++) {
    fileSubmenu.push({
      label: `Terminal ${i}`,
      accelerator: `CmdOrCtrl+${i}`,
      click: (_, win) => win?.webContents.send('shortcut', `switch-terminal-${i}`),
      visible: false
    })
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(async () => {
  sessionStore.markLiveSessionsAsInterrupted()

  const paths = runtimePaths()
  if (shouldAutoInstallHooks(paths.profile, process.env)) {
    const hookInstallResult = installHooks({ bridgeDir: paths.hookBridgeDir })
    hookRuntimeStatus.installed = hookInstallResult.installed
    if (hookInstallResult.error) {
      hookRuntimeStatus.lastError = hookInstallResult.error
    }
  }

  setupApplicationMenu()

  agentHost.on((message) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('chief:event', message)
    }
  })
  await agentHost.start()

  const win = createWindow()

  try {
    const hookPort = await resolveAvailablePort({ preferredPort: 19876, maxAttempts: 25 })
    hookRuntimeStatus.port = hookPort
    terminalManager.setHookPort(hookPort)
    await hookServer.start(win, hookPort)
    hookRuntimeStatus.running = true
  } catch (error) {
    hookRuntimeStatus.running = false
    hookRuntimeStatus.lastError = error instanceof Error ? error.message : 'Failed to start hook runtime'
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', async (event) => {
  if (isShuttingDown) return
  isShuttingDown = true
  event.preventDefault()
  hookServer.stop()
  terminalManager.killAll()
  try {
    await agentHost.shutdown()
  } catch (err) {
    console.error('[main] agent shutdown failed:', err)
  }
  app.exit(0)
})
