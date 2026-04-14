import { useState, useCallback, useEffect } from 'react'
import { Outlet, useParams, useNavigate } from 'react-router-dom'
import { PanelLeft, PanelRight } from 'lucide-react'
import { TitleBar } from './title-bar'
import { Sidebar } from '../sidebar/sidebar'
import { FilesPanel } from './files-panel'
import { ResizeHandle } from './resize-handle'
import { ToastContainer } from '../ui/toast-container'
import { useProjects } from '../../stores/project-store'

const SIDEBAR_DEFAULT = 220
const SIDEBAR_MIN = 140
const SIDEBAR_MAX = 400

const FILES_DEFAULT = 280
const FILES_MIN = 160
const FILES_MAX = 500

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function AppLayout() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { projects } = useProjects()
  const [showFilesPanel, setShowFilesPanel] = useState(false)
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const [filesPanelWidth, setFilesPanelWidth] = useState(FILES_DEFAULT)

  const currentProject = projectId
    ? projects.find((p) => p.id === projectId)
    : undefined

  const canShowFiles = !!currentProject?.path

  // Listen for keyboard shortcuts from the main process
  useEffect(() => {
    const unsubscribe = window.electronAPI.onShortcut((action) => {
      switch (action) {
        case 'new-project':
          window.dispatchEvent(new Event('open-new-project-modal'))
          break
        case 'toggle-sidebar':
          setSidebarVisible((prev) => !prev)
          break
        case 'toggle-files':
          if (canShowFiles) setShowFilesPanel((prev) => !prev)
          break
        case 'settings':
          navigate('/preferences/terminal')
          break
      }
    })
    return unsubscribe
  }, [projectId, navigate, canShowFiles])

  const handleSidebarDrag = useCallback((deltaX: number) => {
    setSidebarWidth((w) => clamp(w + deltaX, SIDEBAR_MIN, SIDEBAR_MAX))
  }, [])

  const handleFilesPanelDrag = useCallback((deltaX: number) => {
    setFilesPanelWidth((w) => clamp(w - deltaX, FILES_MIN, FILES_MAX))
  }, [])

  const leftContent = (
    <button
      onClick={() => setSidebarVisible((v) => !v)}
      className={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${
        sidebarVisible
          ? 'text-muted hover:text-secondary hover:bg-sand/50'
          : 'bg-sand text-secondary'
      }`}
    >
      <PanelLeft size={14} />
    </button>
  )

  const rightContent = canShowFiles ? (
    <button
      onClick={() => setShowFilesPanel((v) => !v)}
      className={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${
        showFilesPanel
          ? 'bg-sand text-secondary'
          : 'text-muted hover:text-secondary hover:bg-sand/50'
      }`}
    >
      <PanelRight size={14} />
    </button>
  ) : undefined

  return (
    <div className="flex flex-col h-screen bg-canvas">
      <TitleBar title="Oneship" leftContent={leftContent} rightContent={rightContent} />
      <div className="flex flex-1 overflow-hidden">
        {sidebarVisible && (
          <>
            <Sidebar style={{ width: sidebarWidth }} />
            <ResizeHandle onDrag={handleSidebarDrag} />
          </>
        )}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
        {showFilesPanel && canShowFiles && currentProject?.path && (
          <>
            <ResizeHandle onDrag={handleFilesPanelDrag} />
            <FilesPanel
              projectPath={currentProject.path}
              onClose={() => setShowFilesPanel(false)}
              style={{ width: filesPanelWidth }}
            />
          </>
        )}
      </div>
      <ToastContainer />
    </div>
  )
}
