import { useState, useRef, useEffect, useCallback } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  ChevronRight,
  User,
  Terminal,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { useProjects, type Project } from '../../stores/project-store'
import { orderTerminalSessionsForDisplay } from '../../stores/session-records'
import { NewProjectModal } from '../modals/new-project-modal'
import { ConfirmDialog } from '../modals/confirm-dialog'

const statusDot: Record<string, string> = {
  active: 'bg-success',
  planning: 'bg-warning',
  done: 'bg-light',
}

const childNavClass = ({ isActive }: { isActive: boolean }) =>
  `flex-1 flex items-center gap-2.5 px-3 py-1 rounded-lg text-[13px] transition-colors ${
    isActive
      ? 'bg-sand font-medium text-espresso'
      : 'text-secondary hover:bg-sand/50'
  }`

function ProjectChildren({ project }: { project: Project }) {
  const navigate = useNavigate()
  const isPlanningOnly = project.status === 'planning' && !project.path

  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null)

  const refreshSessions = useCallback(() => {
    if (project.path) {
      window.electronAPI.session.list(project.id).then(setSessions)
    }
  }, [project.id, project.path])

  useEffect(() => {
    refreshSessions()
    const interval = setInterval(refreshSessions, 3000)
    return () => clearInterval(interval)
  }, [refreshSessions])

  if (isPlanningOnly) {
    return (
      <div className="ml-4 pl-3 border-l border-border space-y-0.5 mt-0.5">
        <NavLink to={`/project/${project.id}/chat`} className={childNavClass}>
          <User size={14} className="text-muted" />
          <span>Project Lead</span>
        </NavLink>
      </div>
    )
  }

  const handleNewAgent = async () => {
    const cwd = project.path || window.electronAPI.homeDir
    const sessionId = await window.electronAPI.terminal.create(project.id, cwd)
    refreshSessions()
    navigate(`/project/${project.id}/terminal/${sessionId}`)
  }

  const handleCloseTerminal = (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setPendingCloseId(sessionId)
  }

  const confirmCloseTerminal = async () => {
    if (!pendingCloseId) return
    const id = pendingCloseId
    setPendingCloseId(null)
    await window.electronAPI.terminal.kill(id)
    refreshSessions()
  }

  const liveSessions = orderTerminalSessionsForDisplay(
    sessions.filter((session) => session.lifecycle === 'live'),
  )
  const pendingCloseLabel = pendingCloseId
    ? sessions.find((session) => session.id === pendingCloseId)?.label ?? null
    : null

  return (
    <>
    <div className="ml-4 pl-3 border-l border-border space-y-0.5 mt-0.5">
      {/* Active terminal sessions */}
      {liveSessions.map((session) => {
        const status = session.lastStatus
        // waiting = agent is blocked on user input (permission request, etc.).
        // Make it obviously distinct from working: larger dot, solid red,
        // pulsing, with a red outer ring so the eye catches it from across
        // the sidebar. Everything else stays at 1.5 × 1.5 for a subtle feel.
        const isWaiting = status === 'waiting'
        const statusDotSize = isWaiting ? 'w-2 h-2' : 'w-1.5 h-1.5'
        const statusDotClass =
          isWaiting ? 'bg-danger ring-2 ring-danger/40 animate-pulse' :
          status === 'working' ? 'bg-amber-400 animate-pulse' :
          status === 'error' ? 'bg-danger' :
          status === 'done' ? 'bg-success' :
          'bg-light'

        return (
        <div key={session.id} className="group/term flex items-center">
          <NavLink
            to={`/project/${project.id}/terminal/${session.id}`}
            end
            className={childNavClass}
            title={session.label}
          >
            <Terminal size={14} className="text-muted" />
            <span className="font-mono text-[12px] truncate">{session.label}</span>
            <span className={`${statusDotSize} rounded-full ${statusDotClass} ml-auto shrink-0`} />
          </NavLink>
          <button
            onClick={(e) => handleCloseTerminal(e, session.id)}
            className="opacity-0 group-hover/term:opacity-100 flex items-center justify-center w-5 h-5 rounded text-muted hover:text-secondary transition-all shrink-0"
          >
            <X size={12} />
          </button>
        </div>
        )
      })}

      <button
        onClick={handleNewAgent}
        className="flex items-center gap-2.5 px-3 py-1 rounded-lg text-[13px] text-muted hover:text-secondary hover:bg-sand/50 transition-colors w-full"
      >
        <Plus size={12} className="text-muted" />
        <span className="text-[12px]">Terminal</span>
      </button>
    </div>
    <ConfirmDialog
      open={pendingCloseId !== null}
      title="Close Terminal?"
      message={
        pendingCloseLabel
          ? `Closing "${pendingCloseLabel}" will kill its process. This cannot be undone.`
          : 'Closing this terminal will kill its process. This cannot be undone.'
      }
      confirmLabel="Close"
      variant="danger"
      onCancel={() => setPendingCloseId(null)}
      onConfirm={confirmCloseTerminal}
    />
    </>
  )
}

export function SidebarProjects() {
  const { projects, dispatch } = useProjects()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    projects.forEach((p, i) => {
      initial[p.id] = i === 0
    })
    return initial
  })
  const [showModal, setShowModal] = useState(false)

  // Listen for shortcut-triggered new project event
  useEffect(() => {
    const handler = () => setShowModal(true)
    window.addEventListener('open-new-project-modal', handler)
    return () => window.removeEventListener('open-new-project-modal', handler)
  }, [])

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [editingId])

  const startRenaming = (project: Project) => {
    setEditingId(project.id)
    setEditValue(project.name)
  }

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      dispatch({
        type: 'UPDATE_PROJECT',
        payload: { id: editingId, name: editValue.trim() },
      })
    }
    setEditingId(null)
  }

  const cancelRename = () => {
    setEditingId(null)
  }

  const toggle = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const handleDelete = (project: Project) => {
    if (window.confirm(`Delete "${project.name}"?`)) {
      dispatch({ type: 'DELETE_PROJECT', payload: project.id })
    }
  }

  return (
    <div className="px-3 mt-5">
      <div className="flex items-center justify-between px-3 mb-2">
        <p className="font-mono text-[10px] font-medium text-light tracking-wider uppercase">
          Projects
        </p>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center justify-center w-5 h-5 rounded text-muted hover:text-secondary transition-colors"
        >
          <Plus size={12} />
        </button>
      </div>

      <div className="space-y-0.5">
        {projects.map((project) => {
          const handleProjectClick = () => {
            toggle(project.id)
          }

          return (
            <div key={project.id}>
              <div className="group flex items-center">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    toggle(project.id)
                  }}
                  className="flex items-center justify-center w-6 h-6 shrink-0 text-muted hover:text-secondary transition-colors"
                >
                  <ChevronRight
                    size={14}
                    className={`transition-transform ${expanded[project.id] ? 'rotate-90' : ''}`}
                  />
                </button>
                <button
                  onClick={() => {
                    navigate(`/project/${project.id}`)
                    setExpanded(prev => ({ ...prev, [project.id]: true }))
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    startRenaming(project)
                  }}
                  className="flex-1 flex items-center gap-2 py-1.5 rounded-lg text-sm text-secondary hover:text-espresso transition-colors"
                >
                  {editingId === project.id ? (
                    <input
                      ref={renameInputRef}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename()
                        if (e.key === 'Escape') cancelRename()
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 bg-transparent border-b border-muted outline-none text-sm text-espresso"
                    />
                  ) : (
                    <span className="flex-1 text-left truncate">{project.name}</span>
                  )}
                </button>
                <button
                  onClick={() => handleDelete(project)}
                  className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-6 h-6 mr-1 rounded text-muted hover:text-secondary transition-all"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              {expanded[project.id] && <ProjectChildren project={project} />}
            </div>
          )
        })}
      </div>

      <NewProjectModal open={showModal} onClose={() => setShowModal(false)} />
    </div>
  )
}
