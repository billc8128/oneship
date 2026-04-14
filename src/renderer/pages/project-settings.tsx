import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, FolderOpen, X, Plus } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useProjects } from '../stores/project-store'
import { appendRepositoryDraft } from './project-settings-state'

interface ProjectDataExt {
  status: 'active' | 'planning' | 'done'
  createdAt: number
  goals: unknown[]
  settings: Record<string, unknown>
  repositories?: string[]
  notes?: string
}

function formatPath(fullPath: string | null): string {
  if (!fullPath) return '--'
  const home = window.electronAPI.homeDir
  return fullPath.startsWith(home) ? '~' + fullPath.slice(home.length) : fullPath
}

export function ProjectSettings() {
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()
  const { projects, dispatch } = useProjects()
  const project = projects.find((p) => p.id === projectId)

  const [name, setName] = useState(project?.name ?? '')
  const [status, setStatus] = useState<'active' | 'planning' | 'done'>(project?.status ?? 'active')
  const [repositories, setRepositories] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [newRepo, setNewRepo] = useState('')
  const [showRepoInput, setShowRepoInput] = useState(false)
  const [hookStatus, setHookStatus] = useState<HookRuntimeStatus | null>(null)
  const repoInputRef = useRef<HTMLInputElement>(null)

  // Sync local name/status when project changes
  useEffect(() => {
    if (project) {
      setName(project.name)
      setStatus(project.status)
    }
  }, [project?.name, project?.status])

  // Load project data (repositories, notes) from project.json
  useEffect(() => {
    if (!projectId) return
    window.electronAPI.store.getProjectData(projectId).then((data: ProjectDataExt | null) => {
      if (data) {
        setRepositories(data.repositories ?? [])
        setNotes(data.notes ?? '')
      }
    })
    window.electronAPI.hook.getStatus().then(setHookStatus)
  }, [projectId])

  // Focus repo input when shown
  useEffect(() => {
    if (showRepoInput && repoInputRef.current) {
      repoInputRef.current.focus()
    }
  }, [showRepoInput])

  const handleNameBlur = () => {
    if (!projectId || name === project?.name) return
    dispatch({ type: 'UPDATE_PROJECT', payload: { id: projectId, name } })
  }

  const handleStatusChange = (newStatus: 'active' | 'planning' | 'done') => {
    if (!projectId) return
    setStatus(newStatus)
    dispatch({ type: 'UPDATE_PROJECT', payload: { id: projectId, status: newStatus } })
  }

  const handleChangePath = async () => {
    if (!projectId) return
    const selected = await window.electronAPI.openFolder()
    if (selected) {
      dispatch({ type: 'UPDATE_PROJECT', payload: { id: projectId, path: selected } })
    }
  }

  const handleAddRepo = () => {
    if (!projectId) return
    const updated = appendRepositoryDraft(repositories, newRepo)
    if (!updated) return
    setRepositories(updated)
    setNewRepo('')
    setShowRepoInput(false)
    window.electronAPI.store.updateProjectData(projectId, { repositories: updated })
  }

  const handleCancelRepo = () => {
    setNewRepo('')
    setShowRepoInput(false)
  }

  const handleRemoveRepo = (index: number) => {
    if (!projectId) return
    const updated = repositories.filter((_, i) => i !== index)
    setRepositories(updated)
    window.electronAPI.store.updateProjectData(projectId, { repositories: updated })
  }

  const handleNotesChange = (value: string) => {
    setNotes(value)
  }

  const handleNotesBlur = () => {
    if (!projectId) return
    window.electronAPI.store.updateProjectData(projectId, { notes })
  }

  const handleRepoKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddRepo()
    } else if (e.key === 'Escape') {
      setNewRepo('')
      setShowRepoInput(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={() => navigate(`/project/${projectId}`)}
          className="text-muted hover:text-secondary transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="font-heading text-2xl font-bold text-espresso">Project Settings</h1>
          <p className="font-body text-sm text-muted mt-1">Name, status, path, notes, and saved repositories update immediately.</p>
        </div>
      </div>

      {/* Project Info */}
      <div className="bg-surface rounded-xl shadow-card p-5 mb-6">
        <div className="font-mono text-[10px] font-medium text-light tracking-wider uppercase mb-4">
          Project Info
        </div>

        <div className="space-y-4">
          {/* Name */}
          <div className="flex items-center gap-4">
            <label className="font-mono text-[10px] font-medium text-light tracking-wider uppercase w-16 shrink-0">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={handleNameBlur}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
              className="flex-1 bg-canvas border border-border rounded-lg px-3 py-2 text-sm font-body text-espresso focus:outline-none focus:border-secondary transition-colors"
            />
          </div>

          {/* Path */}
          <div className="flex items-center gap-4">
            <label className="font-mono text-[10px] font-medium text-light tracking-wider uppercase w-16 shrink-0">
              Path
            </label>
            <div className="flex-1 flex items-center gap-2">
              <span className="font-mono text-sm text-secondary truncate">
                {project?.path ? formatPath(project.path) : 'No folder linked'}
              </span>
              <button
                onClick={handleChangePath}
                className="text-muted hover:text-secondary transition-colors shrink-0"
                title="Change folder"
              >
                <FolderOpen size={14} />
              </button>
            </div>
          </div>

          {/* Status */}
          <div className="flex items-center gap-4">
            <label className="font-mono text-[10px] font-medium text-light tracking-wider uppercase w-16 shrink-0">
              Status
            </label>
            <select
              value={status}
              onChange={(e) => handleStatusChange(e.target.value as 'active' | 'planning' | 'done')}
              className="bg-canvas border border-border rounded-lg px-3 py-2 text-sm font-body text-espresso focus:outline-none focus:border-secondary transition-colors cursor-pointer"
            >
              <option value="active">Active</option>
              <option value="planning">Planning</option>
              <option value="done">Done</option>
            </select>
          </div>
        </div>
      </div>

      {/* Repositories */}
      <div className="bg-surface rounded-xl shadow-card p-5 mb-6">
        <div className="font-mono text-[10px] font-medium text-light tracking-wider uppercase mb-4">
          Repositories
        </div>

        {repositories.length > 0 && (
          <div className="space-y-1 mb-3">
            {repositories.map((repo, index) => (
              <div
                key={index}
                className="group flex items-center justify-between px-3 py-2 rounded-lg hover:bg-sand/50 transition-colors"
              >
                <span className="font-mono text-sm text-espresso truncate">{repo}</span>
                <button
                  onClick={() => handleRemoveRepo(index)}
                  className="text-muted opacity-0 group-hover:opacity-100 hover:text-danger transition-all shrink-0 ml-2"
                  title="Remove repository"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {showRepoInput ? (
          <div className="flex items-center gap-2">
            <input
              ref={repoInputRef}
              type="text"
              value={newRepo}
              onChange={(e) => setNewRepo(e.target.value)}
              onKeyDown={handleRepoKeyDown}
              onBlur={() => {
                if (!newRepo.trim()) {
                  setShowRepoInput(false)
                }
              }}
              placeholder="https://github.com/user/repo"
              className="flex-1 bg-canvas border border-border rounded-lg px-3 py-2 text-sm font-mono text-espresso placeholder:text-light focus:outline-none focus:border-secondary transition-colors"
            />
            <Button variant="secondary" size="sm" onClick={handleAddRepo} disabled={!newRepo.trim()}>
              Add
            </Button>
            <Button variant="ghost" size="sm" onClick={handleCancelRepo}>
              Cancel
            </Button>
          </div>
        ) : (
          <button
            onClick={() => setShowRepoInput(true)}
            className="flex items-center gap-2 text-muted hover:text-secondary transition-colors font-body text-sm"
          >
            <Plus size={14} />
            Add Repository
          </button>
        )}
      </div>

      {/* Project Notes */}
      <div className="bg-surface rounded-xl shadow-card p-5">
        <div className="font-mono text-[10px] font-medium text-light tracking-wider uppercase mb-4">
          Project Notes
        </div>
        <textarea
          value={notes}
          onChange={(e) => handleNotesChange(e.target.value)}
          onBlur={handleNotesBlur}
          rows={4}
          placeholder="Add notes that agents can read as context..."
          className="w-full bg-canvas border border-border rounded-lg px-3 py-2 text-sm font-body text-espresso placeholder:text-light focus:outline-none focus:border-secondary transition-colors resize-y min-h-[100px]"
        />
      </div>

      <div className="bg-surface rounded-xl shadow-card p-5 mt-6">
        <div className="font-mono text-[10px] font-medium text-light tracking-wider uppercase mb-4">
          Hook Runtime
        </div>
        <div className="space-y-2 text-sm">
          <p className="font-body text-espresso">
            Status: {hookStatus?.running ? 'Live' : 'Unavailable'}
          </p>
          <p className="font-mono text-secondary">
            Port: {hookStatus?.port ?? '--'}
          </p>
          <p className="font-body text-secondary">
            Hooks installed: {hookStatus?.installed ? 'yes' : 'no'}
          </p>
          {hookStatus?.lastError && (
            <p className="font-body text-danger">{hookStatus.lastError}</p>
          )}
        </div>
      </div>
    </div>
  )
}
