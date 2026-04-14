import { HashRouter, Routes, Route, useParams } from 'react-router-dom'
import { AppLayout } from './components/layout/app-layout'
import { GlobalDashboard } from './pages/global-dashboard'
import { ChiefChat } from './pages/chief-chat'
import { ProjectDashboard } from './pages/project-dashboard'
import { ProjectChat } from './pages/project-chat'
import { TerminalPage } from './pages/terminal-page'
import { TasksPage } from './pages/tasks-page'
import { ProjectSettings } from './pages/project-settings'
import { PreferencesPage } from './pages/preferences-page'
import { NotFound } from './pages/not-found'
import { ProjectProvider } from './stores/project-store'
import { ensureTerminalThemeStoreInitialized } from './stores/terminal-theme-store'
import { ToastProvider } from './stores/toast-store'
import { useEffect } from 'react'

function ProjectScopedTerminalPage() {
  const { projectId = 'default' } = useParams()
  return <TerminalPage key={projectId} />
}

function TerminalThemeBootstrap() {
  useEffect(() => {
    void ensureTerminalThemeStoreInitialized()
  }, [])

  return null
}

export function App() {
  return (
    <ProjectProvider>
      <ToastProvider>
        <TerminalThemeBootstrap />
        <HashRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<GlobalDashboard />} />
              <Route path="/chief" element={<ChiefChat />} />
              <Route path="/project/:projectId" element={<ProjectDashboard />} />
              <Route path="/project/:projectId/chat" element={<ProjectChat />} />
              <Route path="/project/:projectId/terminal/:sessionId?" element={<ProjectScopedTerminalPage />} />
              <Route path="/project/:projectId/settings" element={<ProjectSettings />} />
              <Route path="/project/:projectId/tasks" element={<TasksPage />} />
              <Route path="/preferences" element={<PreferencesPage />} />
              <Route path="/preferences/terminal" element={<PreferencesPage />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </HashRouter>
      </ToastProvider>
    </ProjectProvider>
  )
}
