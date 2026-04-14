# Phase 1: Application Shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working Electron + React desktop app with routing, sidebar navigation, design system, and all 8 page shells matching the Warm Swiss design spec.

**Architecture:** Electron main process handles window management and IPC. React renderer handles all UI via React Router. Design tokens are centralized in Tailwind config. Sidebar is a persistent layout component with collapsible project tree.

**Tech Stack:** Electron 35, React 19, TypeScript, Tailwind CSS 4, React Router 7, Vite, Lucide React icons

---

## File Structure

```
ge/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
├── electron.vite.config.ts
├── src/
│   ├── main/                          # Electron main process
│   │   └── index.ts                   # Window creation, IPC setup
│   ├── preload/
│   │   └── index.ts                   # Context bridge
│   └── renderer/                      # React app
│       ├── index.html
│       ├── main.tsx                    # React entry
│       ├── app.tsx                     # Router + layout
│       ├── styles/
│       │   └── globals.css            # Tailwind imports, font imports, base styles
│       ├── components/
│       │   ├── sidebar/
│       │   │   ├── sidebar.tsx         # Main sidebar component
│       │   │   ├── sidebar-brand.tsx   # Venn logo + product name
│       │   │   ├── sidebar-nav.tsx     # Chief Agent + Dashboard links
│       │   │   └── sidebar-projects.tsx # Collapsible project tree
│       │   ├── layout/
│       │   │   ├── app-layout.tsx      # Sidebar + main content + optional right panel
│       │   │   ├── title-bar.tsx       # macOS-style title bar with traffic lights
│       │   │   └── files-panel.tsx     # Right-side slide-out files panel (shell only)
│       │   └── ui/
│       │       ├── button.tsx          # Primary, secondary, ghost button variants
│       │       ├── badge.tsx           # Status badges (Running, Done, Cron, Active, Planning)
│       │       ├── stat-card.tsx       # Dashboard stat card (label + big number + unit)
│       │       ├── input.tsx           # Text input with icon support
│       │       └── venn-logo.tsx       # SVG Venn logo at multiple sizes
│       └── pages/
│           ├── global-dashboard.tsx    # J1: stats + project table + activity feed
│           ├── project-dashboard.tsx   # J2: goal progress + goal tree + tasks
│           ├── new-project.tsx         # J3: centered input + secondary actions
│           ├── chief-chat.tsx          # J4: chief agent conversation (static)
│           ├── project-chat.tsx        # J5: project lead conversation (static)
│           ├── terminal-page.tsx       # J6: terminal shell (placeholder, warm theme)
│           ├── tasks-page.tsx          # J7: grouped task list
│           └── not-found.tsx           # 404 fallback
```

---

### Task 1: Scaffold Electron + React project

**Files:**
- Create: `package.json`
- Create: `electron.vite.config.ts`
- Create: `tsconfig.json`
- Create: `src/main/index.ts`
- Create: `src/preload/index.ts`
- Create: `src/renderer/index.html`
- Create: `src/renderer/main.tsx`

- [ ] **Step 1: Initialize project with electron-vite**

```bash
cd /Users/a/Desktop/ge
npm create @electron-vite/create@latest . -- --template react-ts
```

If the scaffolder doesn't work interactively, manually create:

```bash
npm init -y
npm install --save-dev electron electron-vite vite typescript @types/node
npm install react react-dom
npm install --save-dev @types/react @types/react-dom @vitejs/plugin-react
```

- [ ] **Step 2: Configure electron.vite.config.ts**

```ts
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts')
      }
    }
  },
  preload: {
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts')
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: 'dist/renderer'
    },
    plugins: [react()]
  }
})
```

- [ ] **Step 3: Write main process**

`src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'path'

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 14 },
    backgroundColor: '#FAF8F5',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
```

- [ ] **Step 4: Write preload script**

`src/preload/index.ts`:
```ts
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform
})
```

- [ ] **Step 5: Write renderer entry**

`src/renderer/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GoalEngine</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./main.tsx"></script>
</body>
</html>
```

`src/renderer/main.tsx`:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './app'
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

`src/renderer/app.tsx`:
```tsx
export function App() {
  return <div>GoalEngine</div>
}
```

- [ ] **Step 6: Verify the app launches**

```bash
npx electron-vite dev
```

Expected: Electron window opens showing "GoalEngine" text on cream background.

- [ ] **Step 7: Commit**

```bash
git init
echo "node_modules/\ndist/\n.DS_Store" > .gitignore
git add .
git commit -m "feat: scaffold Electron + React + TypeScript project"
```

---

### Task 2: Tailwind + Design Tokens

**Files:**
- Create: `tailwind.config.ts`
- Create: `src/renderer/styles/globals.css`
- Modify: `package.json` (add tailwind deps)

- [ ] **Step 1: Install Tailwind**

```bash
npm install --save-dev tailwindcss @tailwindcss/vite
```

- [ ] **Step 2: Configure Tailwind with design tokens**

`tailwind.config.ts`:
```ts
import type { Config } from 'tailwindcss'

export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        canvas: '#FAF8F5',
        surface: '#FFFFFF',
        sand: '#F0ECE6',
        border: '#EDE8E1',
        espresso: '#2C2520',
        secondary: '#6B6058',
        muted: '#8C8078',
        light: '#B8AFA6',
        accent: '#8B5CF6',
        success: '#10B981',
        warning: '#F97316',
      },
      fontFamily: {
        heading: ['Funnel Sans', 'system-ui', 'sans-serif'],
        body: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '8px',
        lg: '12px',
        xl: '14px',
        '2xl': '16px',
      },
      boxShadow: {
        card: '0 2px 8px rgba(44, 37, 32, 0.03)',
        'card-hover': '0 4px 16px rgba(44, 37, 32, 0.06)',
      }
    },
  },
  plugins: [],
} satisfies Config
```

- [ ] **Step 3: Write global styles**

`src/renderer/styles/globals.css`:
```css
@import 'tailwindcss';
@config '../../../tailwind.config.ts';

@import url('https://fonts.googleapis.com/css2?family=Funnel+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
@import url('https://cdn.jsdelivr.net/npm/geist@1/dist/fonts/geist-sans/style.css');

body {
  font-family: 'Geist', system-ui, sans-serif;
  background-color: #FAF8F5;
  color: #2C2520;
  overflow: hidden;
  height: 100vh;
  -webkit-font-smoothing: antialiased;
}

/* macOS title bar drag region */
.titlebar-drag {
  -webkit-app-region: drag;
}

.titlebar-no-drag {
  -webkit-app-region: no-drag;
}
```

- [ ] **Step 4: Add Tailwind Vite plugin**

Update `electron.vite.config.ts` renderer plugins:
```ts
import tailwindcss from '@tailwindcss/vite'

// in renderer config:
plugins: [react(), tailwindcss()]
```

- [ ] **Step 5: Verify Tailwind works**

Update `app.tsx` temporarily:
```tsx
export function App() {
  return (
    <div className="flex items-center justify-center h-screen bg-canvas">
      <h1 className="font-heading text-3xl font-bold text-espresso">GoalEngine</h1>
    </div>
  )
}
```

Run `npx electron-vite dev`. Expected: "GoalEngine" in Funnel Sans Bold centered on cream background.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: add Tailwind CSS with Warm Swiss design tokens"
```

---

### Task 3: Venn Logo + UI Components

**Files:**
- Create: `src/renderer/components/ui/venn-logo.tsx`
- Create: `src/renderer/components/ui/button.tsx`
- Create: `src/renderer/components/ui/badge.tsx`
- Create: `src/renderer/components/ui/stat-card.tsx`

- [ ] **Step 1: Venn logo component**

`src/renderer/components/ui/venn-logo.tsx`:
```tsx
interface VennLogoProps {
  size?: number
  className?: string
}

export function VennLogo({ size = 26, className }: VennLogoProps) {
  const r = size * 0.35
  const cx1 = r
  const cx2 = size - r
  const cy = size / 2

  return (
    <svg width={size} height={size * 0.7} viewBox={`0 0 ${size} ${size * 0.7}`} className={className}>
      <circle cx={cx1} cy={cy * 0.7} r={r} fill="#2C2520" />
      <circle cx={cx2} cy={cy * 0.7} r={r} fill="#2C2520" opacity={0.35} />
    </svg>
  )
}
```

- [ ] **Step 2: Button component**

`src/renderer/components/ui/button.tsx`:
```tsx
import { type ButtonHTMLAttributes, type ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md'
  children: ReactNode
  icon?: ReactNode
}

export function Button({ variant = 'primary', size = 'md', children, icon, className = '', ...props }: ButtonProps) {
  const base = 'inline-flex items-center gap-2 font-body font-medium transition-colors'
  const sizes = {
    sm: 'px-3 py-1.5 text-xs rounded-lg',
    md: 'px-4 py-2 text-sm rounded-xl',
  }
  const variants = {
    primary: 'bg-espresso text-canvas hover:bg-espresso/90',
    secondary: 'border border-border text-secondary hover:bg-sand',
    ghost: 'text-muted hover:text-secondary hover:bg-sand',
  }

  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props}>
      {icon}
      {children}
    </button>
  )
}
```

- [ ] **Step 3: Badge component**

`src/renderer/components/ui/badge.tsx`:
```tsx
import { type ReactNode } from 'react'

interface BadgeProps {
  variant: 'running' | 'active' | 'done' | 'planning' | 'cron'
  children: ReactNode
}

const styles = {
  running: 'bg-espresso/5 text-espresso',
  active: 'bg-success/8 text-success',
  done: 'bg-sand text-light',
  planning: 'bg-warning/8 text-warning',
  cron: 'bg-warning/8 text-orange-700',
}

export function Badge({ variant, children }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[variant]}`}>
      {children}
    </span>
  )
}
```

- [ ] **Step 4: Stat card component**

`src/renderer/components/ui/stat-card.tsx`:
```tsx
interface StatCardProps {
  label: string
  value: string
  unit?: string
  unitColor?: string
}

export function StatCard({ label, value, unit, unitColor = 'text-light' }: StatCardProps) {
  return (
    <div className="flex-1 bg-surface rounded-xl p-5 shadow-card">
      <p className="font-mono text-[10px] font-medium text-light tracking-wider uppercase">{label}</p>
      <div className="flex items-end gap-1.5 mt-2">
        <span className="font-heading text-4xl font-bold text-espresso">{value}</span>
        {unit && <span className={`font-body text-sm ${unitColor} mb-1`}>{unit}</span>}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add Venn logo and core UI components"
```

---

### Task 4: Title Bar + Sidebar Layout

**Files:**
- Create: `src/renderer/components/layout/title-bar.tsx`
- Create: `src/renderer/components/sidebar/sidebar.tsx`
- Create: `src/renderer/components/sidebar/sidebar-brand.tsx`
- Create: `src/renderer/components/sidebar/sidebar-nav.tsx`
- Create: `src/renderer/components/sidebar/sidebar-projects.tsx`
- Create: `src/renderer/components/layout/app-layout.tsx`

- [ ] **Step 1: Title bar**

`src/renderer/components/layout/title-bar.tsx`:
```tsx
interface TitleBarProps {
  title?: string
  rightContent?: React.ReactNode
}

export function TitleBar({ title = 'GoalEngine', rightContent }: TitleBarProps) {
  return (
    <div className="titlebar-drag h-11 bg-surface border-b border-border flex items-center px-4 shrink-0">
      {/* Traffic lights area — macOS renders them natively in this space */}
      <div className="w-16 shrink-0" />
      <div className="flex-1" />
      <span className="font-heading text-[13px] font-semibold text-light">{title}</span>
      <div className="flex-1" />
      <div className="titlebar-no-drag">{rightContent}</div>
    </div>
  )
}
```

- [ ] **Step 2: Sidebar brand**

`src/renderer/components/sidebar/sidebar-brand.tsx`:
```tsx
import { VennLogo } from '../ui/venn-logo'

export function SidebarBrand() {
  return (
    <div className="flex items-center gap-2.5 px-1.5 pb-3">
      <VennLogo size={26} />
      <span className="font-heading text-[15px] font-semibold text-espresso">GoalEngine</span>
    </div>
  )
}
```

- [ ] **Step 3: Sidebar nav (Chief Agent + Dashboard)**

`src/renderer/components/sidebar/sidebar-nav.tsx`:
```tsx
import { NavLink } from 'react-router-dom'
import { Activity } from 'lucide-react'
import { VennLogo } from '../ui/venn-logo'

export function SidebarNav() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-colors ${
      isActive ? 'bg-sand font-medium text-espresso' : 'text-secondary hover:bg-sand/50'
    }`

  return (
    <nav className="flex flex-col gap-0.5">
      <NavLink to="/chief" className={linkClass}>
        <VennLogo size={16} />
        <span>Chief Agent</span>
        <div className="flex-1" />
        <div className="w-1.5 h-1.5 rounded-full bg-success" />
      </NavLink>
      <NavLink to="/" end className={linkClass}>
        <Activity size={16} className="text-muted" />
        <span>Dashboard</span>
      </NavLink>
    </nav>
  )
}
```

- [ ] **Step 4: Sidebar projects tree**

`src/renderer/components/sidebar/sidebar-projects.tsx`:
```tsx
import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ChevronDown, ChevronRight, MessageCircle, Folder, Terminal, LayoutDashboard, ListChecks, Plus } from 'lucide-react'

interface Project {
  id: string
  name: string
  status: 'active' | 'planning' | 'done'
}

const mockProjects: Project[] = [
  { id: 'saas', name: 'SaaS Landing Page', status: 'active' },
  { id: 'mobile', name: 'Mobile App MVP', status: 'active' },
  { id: 'pipeline', name: 'Data Pipeline', status: 'planning' },
]

const statusColors = {
  active: 'bg-success',
  planning: 'bg-warning',
  done: 'bg-light',
}

export function SidebarProjects() {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ saas: true })

  const toggle = (id: string) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }))

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center px-1.5 pt-3.5 pb-1.5">
        <span className="font-mono text-[10px] font-medium text-light tracking-wider">PROJECTS</span>
        <div className="flex-1" />
        <Plus size={14} className="text-light cursor-pointer hover:text-muted" />
      </div>
      {mockProjects.map(project => (
        <div key={project.id}>
          <button
            onClick={() => toggle(project.id)}
            className="w-full flex items-center gap-2 px-1.5 py-1.5 rounded-lg text-[13px] hover:bg-sand/50 transition-colors"
          >
            {expanded[project.id]
              ? <ChevronDown size={14} className="text-light" />
              : <ChevronRight size={14} className="text-light" />
            }
            <div className={`w-[7px] h-[7px] rounded-full ${statusColors[project.status]}`} />
            <span className={expanded[project.id] ? 'font-medium text-espresso' : 'text-secondary'}>
              {project.name}
            </span>
          </button>
          {expanded[project.id] && (
            <div className="ml-[22px] flex flex-col gap-0.5">
              <NavLink
                to={`/project/${project.id}/chat`}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors ${
                    isActive ? 'bg-sand font-medium text-espresso' : 'text-secondary hover:bg-sand/50'
                  }`
                }
              >
                <MessageCircle size={14} className="text-muted" />
                <span>Project Lead</span>
              </NavLink>
              <NavLink
                to={`/project/${project.id}/files`}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors ${
                    isActive ? 'bg-sand font-medium text-espresso' : 'text-secondary hover:bg-sand/50'
                  }`
                }
              >
                <Folder size={14} className="text-muted" />
                <span>Files</span>
              </NavLink>
              <NavLink
                to={`/project/${project.id}/terminal`}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors ${
                    isActive ? 'bg-sand font-medium text-espresso' : 'text-secondary hover:bg-sand/50'
                  }`
                }
              >
                <Terminal size={14} className="text-muted" />
                <span className="font-mono text-[11px]">claude: pricing</span>
              </NavLink>
              <NavLink
                to={`/project/${project.id}`}
                end
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors ${
                    isActive ? 'bg-sand font-medium text-espresso' : 'text-secondary hover:bg-sand/50'
                  }`
                }
              >
                <LayoutDashboard size={14} className="text-muted" />
                <span>Dashboard</span>
              </NavLink>
              <NavLink
                to={`/project/${project.id}/tasks`}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors ${
                    isActive ? 'bg-sand font-medium text-espresso' : 'text-secondary hover:bg-sand/50'
                  }`
                }
              >
                <ListChecks size={14} className="text-muted" />
                <span>Tasks</span>
              </NavLink>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Sidebar container**

`src/renderer/components/sidebar/sidebar.tsx`:
```tsx
import { SidebarBrand } from './sidebar-brand'
import { SidebarNav } from './sidebar-nav'
import { SidebarProjects } from './sidebar-projects'

export function Sidebar() {
  return (
    <aside className="w-60 h-full bg-surface border-r border-border flex flex-col shrink-0">
      <div className="px-3 pt-3 flex flex-col gap-0.5">
        <SidebarBrand />
        <SidebarNav />
      </div>
      <div className="px-3 flex-1 overflow-y-auto">
        <SidebarProjects />
      </div>
    </aside>
  )
}
```

- [ ] **Step 6: App layout**

`src/renderer/components/layout/app-layout.tsx`:
```tsx
import { Outlet } from 'react-router-dom'
import { TitleBar } from './title-bar'
import { Sidebar } from '../sidebar/sidebar'

export function AppLayout() {
  return (
    <div className="flex flex-col h-screen bg-canvas">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: add title bar, sidebar with project tree, and app layout"
```

---

### Task 5: Router + All Page Shells

**Files:**
- Modify: `src/renderer/app.tsx`
- Create: `src/renderer/pages/global-dashboard.tsx`
- Create: `src/renderer/pages/project-dashboard.tsx`
- Create: `src/renderer/pages/new-project.tsx`
- Create: `src/renderer/pages/chief-chat.tsx`
- Create: `src/renderer/pages/project-chat.tsx`
- Create: `src/renderer/pages/terminal-page.tsx`
- Create: `src/renderer/pages/tasks-page.tsx`
- Create: `src/renderer/pages/not-found.tsx`
- Install: `react-router-dom`

- [ ] **Step 1: Install React Router**

```bash
npm install react-router-dom
```

- [ ] **Step 2: Set up router**

`src/renderer/app.tsx`:
```tsx
import { HashRouter, Routes, Route } from 'react-router-dom'
import { AppLayout } from './components/layout/app-layout'
import { GlobalDashboard } from './pages/global-dashboard'
import { ProjectDashboard } from './pages/project-dashboard'
import { NewProject } from './pages/new-project'
import { ChiefChat } from './pages/chief-chat'
import { ProjectChat } from './pages/project-chat'
import { TerminalPage } from './pages/terminal-page'
import { TasksPage } from './pages/tasks-page'
import { NotFound } from './pages/not-found'

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<GlobalDashboard />} />
          <Route path="chief" element={<ChiefChat />} />
          <Route path="new" element={<NewProject />} />
          <Route path="project/:projectId" element={<ProjectDashboard />} />
          <Route path="project/:projectId/chat" element={<ProjectChat />} />
          <Route path="project/:projectId/terminal" element={<TerminalPage />} />
          <Route path="project/:projectId/tasks" element={<TasksPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
```

- [ ] **Step 3: Global Dashboard page (J1)**

`src/renderer/pages/global-dashboard.tsx`:
```tsx
import { StatCard } from '../components/ui/stat-card'
import { Badge } from '../components/ui/badge'

export function GlobalDashboard() {
  return (
    <div className="p-7 flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-bold">Dashboard</h1>

      <div className="flex gap-3.5">
        <StatCard label="Active Projects" value="3" />
        <StatCard label="Goals Progress" value="12" unit="of 19" />
        <StatCard label="Agents Running" value="5" unit="of 8" unitColor="text-light" />
        <StatCard label="Tasks Today" value="23" unit="↑ 8 done" unitColor="text-success" />
      </div>

      <div className="flex gap-3.5 flex-1">
        {/* Projects table */}
        <div className="flex-1 bg-surface rounded-xl shadow-card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center">
            <span className="font-heading text-[15px] font-semibold">Projects</span>
          </div>
          <div className="text-sm">
            <div className="grid grid-cols-[1fr_80px_80px_90px_80px] px-5 py-2 text-light font-mono text-[10px] tracking-wider">
              <span>Name</span><span>Goals</span><span>Tasks</span><span>Agents</span><span>Status</span>
            </div>
            {[
              { name: 'SaaS Landing Page', goals: '3 / 5', tasks: '7 active', agents: '2 running', status: 'active' as const },
              { name: 'Mobile App MVP', goals: '1 / 4', tasks: '3 active', agents: '1 running', status: 'active' as const },
              { name: 'Data Pipeline', goals: '0 / 3', tasks: '0 active', agents: '—', status: 'planning' as const },
              { name: 'API Docs', goals: '6 / 6', tasks: '—', agents: '—', status: 'done' as const },
            ].map(row => (
              <div key={row.name} className="grid grid-cols-[1fr_80px_80px_90px_80px] px-5 py-3 border-t border-border items-center">
                <span className="font-medium">{row.name}</span>
                <span className="font-mono text-xs text-secondary">{row.goals}</span>
                <span className="text-xs text-secondary">{row.tasks}</span>
                <span className={`text-xs ${row.agents === '—' ? 'text-light' : 'text-success'}`}>{row.agents}</span>
                <Badge variant={row.status}>{row.status === 'active' ? 'Active' : row.status === 'planning' ? 'Planning' : 'Done'}</Badge>
              </div>
            ))}
          </div>
        </div>

        {/* Activity feed */}
        <div className="w-80 bg-surface rounded-xl shadow-card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center">
            <span className="font-heading text-[15px] font-semibold">Activity</span>
            <div className="flex-1" />
            <div className="w-2 h-2 rounded-full bg-success" />
          </div>
          <div className="p-3 flex flex-col gap-0.5">
            {[
              { icon: '✓', text: 'Task done: Hero section built', meta: 'SaaS Landing Page · 2m ago' },
              { icon: '◎', text: 'Agent started: Pricing page', meta: 'SaaS Landing Page · 5m ago' },
              { icon: '◎', text: 'Goal decomposed: 3 sub-goals', meta: 'Data Pipeline · 12m ago' },
            ].map((item, i) => (
              <div key={i} className="flex gap-2.5 px-2 py-2.5 rounded-lg">
                <span className="text-muted text-sm">{item.icon}</span>
                <div>
                  <p className="text-xs text-espresso/80">{item.text}</p>
                  <p className="font-mono text-[10px] text-light mt-0.5">{item.meta}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: New Project page (J3)**

`src/renderer/pages/new-project.tsx`:
```tsx
import { FolderOpen, Terminal, GitBranch, ArrowUp } from 'lucide-react'
import { VennLogo } from '../components/ui/venn-logo'

export function NewProject() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-0">
      <div className="flex-1" />
      <VennLogo size={48} />
      <div className="h-6" />
      <h1 className="font-heading text-3xl font-bold text-espresso">What are you building?</h1>
      <div className="h-2" />
      <p className="text-sm text-light">Describe your goal, or pick a way to start below.</p>
      <div className="h-7" />
      <div className="flex items-center gap-2.5 w-[520px] px-4 py-3.5 rounded-xl bg-surface border border-border shadow-card">
        <input
          type="text"
          placeholder="Build a SaaS landing page with pricing and SEO..."
          className="flex-1 bg-transparent text-sm text-espresso placeholder:text-light outline-none font-body"
        />
        <button className="w-8 h-8 rounded-lg bg-espresso flex items-center justify-center">
          <ArrowUp size={16} className="text-canvas" />
        </button>
      </div>
      <div className="h-8" />
      <div className="flex items-center gap-4 w-[520px]">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-light">or</span>
        <div className="flex-1 h-px bg-border" />
      </div>
      <div className="h-5" />
      <div className="flex gap-3">
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-[13px] font-medium text-espresso/80 hover:bg-sand transition-colors">
          <FolderOpen size={15} className="text-muted" />
          Open Folder
        </button>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-[13px] font-medium text-espresso/80 hover:bg-sand transition-colors">
          <Terminal size={15} className="text-muted" />
          Open Terminal
        </button>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-[13px] font-medium text-espresso/80 hover:bg-sand transition-colors">
          <GitBranch size={15} className="text-muted" />
          Clone Repo
        </button>
      </div>
      <div className="flex-1" />
    </div>
  )
}
```

- [ ] **Step 5: Remaining page shells**

Create minimal shells for the other pages. Each should have the correct heading and layout structure but use placeholder content.

`src/renderer/pages/project-dashboard.tsx`:
```tsx
import { useParams } from 'react-router-dom'
import { ArrowLeft, MessageCircle, Terminal } from 'lucide-react'
import { StatCard } from '../components/ui/stat-card'
import { Button } from '../components/ui/button'

export function ProjectDashboard() {
  const { projectId } = useParams()
  return (
    <div className="p-7 flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <ArrowLeft size={18} className="text-light cursor-pointer" />
        <div className="w-2 h-2 rounded-full bg-success" />
        <h1 className="font-heading text-2xl font-bold">SaaS Landing Page</h1>
        <div className="flex-1" />
        <Button icon={<MessageCircle size={14} />}>Talk to Agent</Button>
        <Button variant="secondary" icon={<Terminal size={14} />}>Terminal</Button>
      </div>
      <div className="flex gap-3.5">
        <StatCard label="Goal Progress" value="3" unit="of 5" />
        <StatCard label="Active Tasks" value="7" unit="in progress" />
        <StatCard label="Agents" value="2" unit="running" unitColor="text-success" />
      </div>
      <div className="flex gap-3.5 flex-1">
        <div className="flex-1 bg-surface rounded-xl shadow-card p-5">
          <p className="font-heading text-[15px] font-semibold mb-4">Goal Tree</p>
          <p className="text-sm text-muted">Goal tree content...</p>
        </div>
        <div className="flex-1 bg-surface rounded-xl shadow-card p-5">
          <p className="font-heading text-[15px] font-semibold mb-4">Recent Tasks</p>
          <p className="text-sm text-muted">Tasks content...</p>
        </div>
      </div>
    </div>
  )
}
```

`src/renderer/pages/chief-chat.tsx`:
```tsx
import { ArrowUp, Paperclip } from 'lucide-react'
import { VennLogo } from '../components/ui/venn-logo'

export function ChiefChat() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3.5 border-b border-border bg-surface flex items-center gap-2.5">
        <VennLogo size={28} />
        <div>
          <p className="font-heading text-[15px] font-semibold">Chief Agent</p>
          <p className="text-xs text-muted">Overseeing 3 projects</p>
        </div>
      </div>
      <div className="flex-1 p-8 overflow-y-auto">
        <p className="text-sm text-muted">Chief agent conversation...</p>
      </div>
      <div className="px-6 py-4 flex gap-2.5 items-center">
        <div className="flex-1 flex items-center gap-2 px-4 py-3 rounded-xl bg-surface border border-border">
          <input placeholder="Ask about any project..." className="flex-1 bg-transparent text-sm outline-none placeholder:text-light" />
          <Paperclip size={16} className="text-light" />
        </div>
        <button className="w-9 h-9 rounded-lg bg-espresso flex items-center justify-center">
          <ArrowUp size={18} className="text-canvas" />
        </button>
      </div>
    </div>
  )
}
```

`src/renderer/pages/project-chat.tsx`:
```tsx
import { ArrowUp, Paperclip } from 'lucide-react'

export function ProjectChat() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3.5 border-b border-border bg-surface flex items-center gap-2.5">
        <div className="w-2 h-2 rounded-full bg-success" />
        <div>
          <p className="font-heading text-[15px] font-semibold">Project Lead</p>
          <p className="text-xs text-muted">Working on pricing page...</p>
        </div>
      </div>
      <div className="flex-1 p-8 overflow-y-auto">
        <p className="text-sm text-muted">Project lead conversation...</p>
      </div>
      <div className="px-6 py-4 flex gap-2.5 items-center">
        <div className="flex-1 flex items-center gap-2 px-4 py-3 rounded-xl bg-surface border border-border">
          <input placeholder="Message the project lead..." className="flex-1 bg-transparent text-sm outline-none placeholder:text-light" />
          <Paperclip size={16} className="text-light" />
        </div>
        <button className="w-9 h-9 rounded-lg bg-espresso flex items-center justify-center">
          <ArrowUp size={18} className="text-canvas" />
        </button>
      </div>
    </div>
  )
}
```

`src/renderer/pages/terminal-page.tsx`:
```tsx
export function TerminalPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-2.5 border-b border-border bg-surface flex items-center gap-2">
        <div className="px-3 py-1 rounded-lg bg-sand text-xs font-mono font-medium">claude: pricing</div>
        <div className="px-3 py-1 rounded-lg text-xs font-mono text-muted">shell: dev server</div>
      </div>
      <div className="flex-1 p-6 font-mono text-[13px] text-espresso leading-relaxed">
        <p>Terminal will be integrated in Phase 2</p>
      </div>
    </div>
  )
}
```

`src/renderer/pages/tasks-page.tsx`:
```tsx
import { Badge } from '../components/ui/badge'

export function TasksPage() {
  return (
    <div className="p-7 flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-bold">Tasks</h1>
      <div className="flex flex-col gap-6">
        <section>
          <p className="font-mono text-[10px] font-medium text-light tracking-wider mb-2.5">RUNNING</p>
          <div className="bg-surface rounded-xl shadow-card overflow-hidden">
            {[
              { name: 'Build pricing components', meta: 'Started 12 min ago · Agent: task-agent-01' },
              { name: 'Generate SEO meta tags', meta: 'Started 3 min ago · Agent: task-agent-02' },
            ].map((task, i) => (
              <div key={i} className={`flex items-center gap-3 px-5 py-3.5 ${i > 0 ? 'border-t border-border' : ''}`}>
                <div className="w-2 h-2 rounded-full bg-espresso" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{task.name}</p>
                  <p className="font-mono text-[11px] text-light">{task.meta}</p>
                </div>
                <Badge variant="running">Running</Badge>
              </div>
            ))}
          </div>
        </section>
        <section>
          <p className="font-mono text-[10px] font-medium text-light tracking-wider mb-2.5">COMPLETED</p>
          <div className="bg-surface rounded-xl shadow-card overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-3.5">
              <div className="w-2 h-2 rounded-full bg-light" />
              <div className="flex-1">
                <p className="text-sm text-muted">Write hero section copy</p>
                <p className="font-mono text-[11px] text-light">Completed 1h ago · 2 files modified</p>
              </div>
              <Badge variant="done">Done</Badge>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
```

`src/renderer/pages/not-found.tsx`:
```tsx
export function NotFound() {
  return (
    <div className="flex items-center justify-center h-full">
      <p className="text-muted">Page not found</p>
    </div>
  )
}
```

- [ ] **Step 6: Install lucide-react**

```bash
npm install lucide-react
```

- [ ] **Step 7: Verify all routes work**

```bash
npx electron-vite dev
```

Navigate to each route via sidebar clicks. Verify:
- `/` shows Global Dashboard with stats and table
- `/chief` shows Chief Agent chat layout
- `/new` shows centered "What are you building?" input
- `/project/saas` shows Project Dashboard
- `/project/saas/chat` shows Project Lead chat
- `/project/saas/terminal` shows terminal placeholder
- `/project/saas/tasks` shows grouped task list

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "feat: add router and all 8 page shells"
```

---

## What's Next

After Phase 1, the app has:
- Working Electron desktop window with macOS-native title bar
- Full sidebar with collapsible project tree
- All 8 pages with static content matching the design spec
- Design system tokens in Tailwind
- Venn logo + Button/Badge/StatCard components

**Phase 2** will add real terminal integration with node-pty + xterm.js.
**Phase 3** will add project CRUD, file system access, and the Files panel.
**Phase 4** will add the chat system with message persistence.
**Phase 5** will add the agent runtime.
