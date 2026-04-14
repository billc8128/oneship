# Phase 2: Terminal Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate real terminal emulation into the app using node-pty + xterm.js, supporting multiple terminal sessions per project with tab management.

**Architecture:** Main process spawns PTY processes via node-pty and communicates with renderer via IPC. Renderer uses xterm.js to display terminal output. Each terminal session is tracked by ID with project association. Terminal tabs are managed in the sidebar project tree.

**Tech Stack:** node-pty, @xterm/xterm, @xterm/addon-fit, @xterm/addon-web-links, Electron IPC

---

## File Structure (new/modified files only)

```
src/
├── main/
│   ├── index.ts              # Modified: register IPC handlers
│   └── terminal-manager.ts   # NEW: PTY process lifecycle management
├── preload/
│   └── index.ts              # Modified: expose terminal IPC API
└── renderer/
    ├── components/
    │   └── terminal/
    │       ├── terminal-view.tsx    # NEW: xterm.js wrapper component
    │       └── terminal-tabs.tsx    # NEW: tab bar for multiple sessions
    └── pages/
        └── terminal-page.tsx       # Modified: replace placeholder with real terminal
```

---

### Task 1: Install dependencies + PTY manager in main process

**Files:**
- Modify: `package.json`
- Create: `src/main/terminal-manager.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Install node-pty and xterm**

```bash
cd /Users/a/Desktop/ge
npm install node-pty @xterm/xterm @xterm/addon-fit @xterm/addon-web-links
```

Note: node-pty requires native compilation. If `electron-rebuild` is needed:
```bash
npm install --save-dev electron-rebuild
npx electron-rebuild -f -w node-pty
```

Or configure electron-vite to handle native modules.

- [ ] **Step 2: Create terminal manager**

`src/main/terminal-manager.ts` — manages PTY process lifecycle:

```ts
import * as pty from 'node-pty'
import { BrowserWindow } from 'electron'

interface TerminalSession {
  id: string
  projectId: string
  label: string
  ptyProcess: pty.IPty
}

export class TerminalManager {
  private sessions = new Map<string, TerminalSession>()
  private counter = 0

  create(projectId: string, cwd: string, shell?: string): string {
    const id = `term-${++this.counter}`
    const defaultShell = shell || process.env.SHELL || '/bin/zsh'

    const ptyProcess = pty.spawn(defaultShell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    })

    this.sessions.set(id, {
      id,
      projectId,
      label: defaultShell.split('/').pop() || 'shell',
      ptyProcess,
    })

    return id
  }

  write(id: string, data: string) {
    this.sessions.get(id)?.ptyProcess.write(data)
  }

  resize(id: string, cols: number, rows: number) {
    this.sessions.get(id)?.ptyProcess.resize(cols, rows)
  }

  onData(id: string, callback: (data: string) => void): void {
    const session = this.sessions.get(id)
    if (session) {
      session.ptyProcess.onData(callback)
    }
  }

  kill(id: string) {
    const session = this.sessions.get(id)
    if (session) {
      session.ptyProcess.kill()
      this.sessions.delete(id)
    }
  }

  getSession(id: string) {
    const s = this.sessions.get(id)
    if (!s) return null
    return { id: s.id, projectId: s.projectId, label: s.label }
  }

  listSessions(projectId?: string) {
    const all = Array.from(this.sessions.values())
    const filtered = projectId ? all.filter(s => s.projectId === projectId) : all
    return filtered.map(s => ({ id: s.id, projectId: s.projectId, label: s.label }))
  }

  killAll() {
    for (const session of this.sessions.values()) {
      session.ptyProcess.kill()
    }
    this.sessions.clear()
  }
}
```

- [ ] **Step 3: Register IPC handlers in main process**

Add to `src/main/index.ts`:

```ts
import { ipcMain } from 'electron'
import { TerminalManager } from './terminal-manager'

const terminalManager = new TerminalManager()

// Register IPC handlers before window creation
ipcMain.handle('terminal:create', (_event, projectId: string, cwd: string, shell?: string) => {
  const id = terminalManager.create(projectId, cwd, shell)
  return id
})

ipcMain.handle('terminal:list', (_event, projectId?: string) => {
  return terminalManager.listSessions(projectId)
})

ipcMain.on('terminal:write', (_event, id: string, data: string) => {
  terminalManager.write(id, data)
})

ipcMain.on('terminal:resize', (_event, id: string, cols: number, rows: number) => {
  terminalManager.resize(id, cols, rows)
})

ipcMain.on('terminal:kill', (_event, id: string) => {
  terminalManager.kill(id)
})

// Forward PTY data to renderer
ipcMain.on('terminal:subscribe', (event, id: string) => {
  terminalManager.onData(id, (data) => {
    event.sender.send(`terminal:data:${id}`, data)
  })
})

// Clean up on quit
app.on('before-quit', () => {
  terminalManager.killAll()
})
```

- [ ] **Step 4: Expose terminal API in preload**

Update `src/preload/index.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
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
    onData: (id: string, callback: (data: string) => void) => {
      const channel = `terminal:data:${id}`
      const handler = (_event: Electron.IpcRendererEvent, data: string) => callback(data)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
  },
})
```

- [ ] **Step 5: Add TypeScript types for the preload API**

Create `src/renderer/types/electron.d.ts`:
```ts
interface TerminalAPI {
  create(projectId: string, cwd: string, shell?: string): Promise<string>
  list(projectId?: string): Promise<Array<{ id: string; projectId: string; label: string }>>
  write(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  kill(id: string): void
  subscribe(id: string): void
  onData(id: string, callback: (data: string) => void): () => void
}

interface ElectronAPI {
  platform: string
  terminal: TerminalAPI
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
```

- [ ] **Step 6: Handle node-pty native module in electron-vite config**

node-pty is a native module — it must be externalized from the Vite build. Update `electron.vite.config.ts`:

```ts
// In the main config:
main: {
  build: {
    outDir: 'dist/main',
    rollupOptions: {
      input: resolve(__dirname, 'src/main/index.ts'),
      external: ['node-pty']
    }
  }
}
```

- [ ] **Step 7: Verify build**

```bash
npx electron-vite build
```

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "feat: add terminal PTY manager with IPC bridge"
```

---

### Task 2: xterm.js terminal view + tab management in renderer

**Files:**
- Create: `src/renderer/components/terminal/terminal-view.tsx`
- Create: `src/renderer/components/terminal/terminal-tabs.tsx`
- Modify: `src/renderer/pages/terminal-page.tsx`

- [ ] **Step 1: Create xterm.js terminal component**

`src/renderer/components/terminal/terminal-view.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

interface TerminalViewProps {
  sessionId: string
}

export function TerminalView({ sessionId }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 13,
      lineHeight: 1.5,
      theme: {
        background: '#FAF8F5',
        foreground: '#2C2520',
        cursor: '#2C2520',
        cursorAccent: '#FAF8F5',
        selectionBackground: '#F0ECE680',
        black: '#2C2520',
        red: '#DC2626',
        green: '#059669',
        yellow: '#D97706',
        blue: '#8B5CF6',
        magenta: '#A855F7',
        cyan: '#0891B2',
        white: '#FAF8F5',
        brightBlack: '#8C8078',
        brightRed: '#EF4444',
        brightGreen: '#10B981',
        brightYellow: '#F59E0B',
        brightBlue: '#A78BFA',
        brightMagenta: '#C084FC',
        brightCyan: '#06B6D4',
        brightWhite: '#FFFFFF',
      },
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())

    term.open(containerRef.current)
    fitAddon.fit()

    // Subscribe to PTY data
    window.electronAPI.terminal.subscribe(sessionId)
    const unsubscribe = window.electronAPI.terminal.onData(sessionId, (data) => {
      term.write(data)
    })

    // Send user input to PTY
    term.onData((data) => {
      window.electronAPI.terminal.write(sessionId, data)
    })

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      window.electronAPI.terminal.resize(sessionId, term.cols, term.rows)
    })
    resizeObserver.observe(containerRef.current)

    termRef.current = term

    return () => {
      unsubscribe()
      resizeObserver.disconnect()
      term.dispose()
    }
  }, [sessionId])

  return <div ref={containerRef} className="w-full h-full" />
}
```

- [ ] **Step 2: Create terminal tabs component**

`src/renderer/components/terminal/terminal-tabs.tsx`:

```tsx
import { Plus, X } from 'lucide-react'

interface TerminalTab {
  id: string
  label: string
}

interface TerminalTabsProps {
  tabs: TerminalTab[]
  activeId: string
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
}

export function TerminalTabs({ tabs, activeId, onSelect, onClose, onNew }: TerminalTabsProps) {
  return (
    <div className="px-5 py-2.5 border-b border-border bg-surface flex items-center gap-1.5">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          className={`group flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-mono transition-colors ${
            tab.id === activeId
              ? 'bg-sand font-medium text-espresso'
              : 'text-muted hover:bg-sand/50'
          }`}
        >
          {tab.label}
          <X
            size={12}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-espresso"
            onClick={(e) => { e.stopPropagation(); onClose(tab.id) }}
          />
        </button>
      ))}
      <button
        onClick={onNew}
        className="p-1 rounded-md text-light hover:text-muted hover:bg-sand/50 transition-colors"
      >
        <Plus size={16} />
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Update terminal page to use real components**

`src/renderer/pages/terminal-page.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { TerminalView } from '../components/terminal/terminal-view'
import { TerminalTabs } from '../components/terminal/terminal-tabs'

interface TerminalTab {
  id: string
  label: string
}

export function TerminalPage() {
  const { projectId } = useParams()
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeId, setActiveId] = useState<string>('')

  useEffect(() => {
    // Create initial terminal on mount
    createTerminal()
  }, [projectId])

  async function createTerminal() {
    const cwd = process.env.HOME || '~'
    const id = await window.electronAPI.terminal.create(projectId || 'default', cwd)
    const newTab = { id, label: `shell ${tabs.length + 1}` }
    setTabs(prev => [...prev, newTab])
    setActiveId(id)
  }

  function closeTerminal(id: string) {
    window.electronAPI.terminal.kill(id)
    setTabs(prev => {
      const remaining = prev.filter(t => t.id !== id)
      if (id === activeId && remaining.length > 0) {
        setActiveId(remaining[remaining.length - 1].id)
      }
      return remaining
    })
  }

  return (
    <div className="flex flex-col h-full">
      <TerminalTabs
        tabs={tabs}
        activeId={activeId}
        onSelect={setActiveId}
        onClose={closeTerminal}
        onNew={createTerminal}
      />
      <div className="flex-1 p-1">
        {activeId && <TerminalView key={activeId} sessionId={activeId} />}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Import xterm CSS**

Make sure `@xterm/xterm/css/xterm.css` is imported in the terminal-view component (already done in step 1).

If the CSS import doesn't work through Vite, add to `globals.css`:
```css
@import '@xterm/xterm/css/xterm.css';
```

- [ ] **Step 5: Verify build and test**

```bash
npx electron-vite build
npx electron-vite dev
```

Navigate to a project terminal page. Verify:
- Terminal renders with warm cream background
- You can type commands
- Output is displayed
- Tab bar shows the session
- Can create new terminals via + button
- Can close terminals via X

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: integrate xterm.js terminal with PTY backend"
```

---

## What's Next

After Phase 2, the app has:
- Real terminal emulation with PTY processes
- Multiple terminal sessions per project
- Tab management (create, switch, close)
- Warm-themed terminal matching the design spec
- IPC bridge between main process and renderer

**Phase 3** will add project CRUD, file system access, and the Files panel.
