import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderOpen, GitBranch, MessageSquare, ArrowLeft, X } from 'lucide-react'
import { useProjects, type Project } from '../../stores/project-store'

interface NewProjectModalProps {
  open: boolean
  onClose: () => void
}

type ModalView = 'main' | 'clone'

export function NewProjectModal({ open, onClose }: NewProjectModalProps) {
  const navigate = useNavigate()
  const { dispatch } = useProjects()
  const [view, setView] = useState<ModalView>('main')
  const [cloneUrl, setCloneUrl] = useState('')
  const [cloneDest, setCloneDest] = useState('')
  const [cloneError, setCloneError] = useState('')
  const [cloning, setCloning] = useState(false)
  const urlInputRef = useRef<HTMLInputElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      setView('main')
      setCloneUrl('')
      setCloneDest('')
      setCloneError('')
      setCloning(false)
    }
  }, [open])

  useEffect(() => {
    if (view === 'clone' && urlInputRef.current) {
      urlInputRef.current.focus()
    }
  }, [view])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  const createProjectId = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') +
    '-' +
    Date.now().toString(36)

  const handleOpenFolder = async () => {
    const folderPath = await window.electronAPI.openFolder()
    if (!folderPath) return

    const folderName = folderPath.split('/').pop() || 'Untitled'
    const id = createProjectId(folderName)
    const project: Project = {
      id,
      name: folderName,
      status: 'active',
      path: folderPath,
      createdAt: Date.now(),
    }
    dispatch({ type: 'ADD_PROJECT', payload: project })
    onClose()
    navigate(`/project/${id}/terminal`)
  }

  const handleCloneStart = () => {
    setView('clone')
    setCloneError('')
  }

  const handlePickCloneDest = async () => {
    const folderPath = await window.electronAPI.openFolder()
    if (folderPath) setCloneDest(folderPath)
  }

  const handleClone = async () => {
    if (!cloneUrl.trim() || !cloneDest.trim() || cloning) return

    setCloning(true)
    setCloneError('')

    try {
      const clonedProject = await window.electronAPI.cloneRepository(cloneUrl.trim(), cloneDest.trim())
      const id = createProjectId(clonedProject.name)
      const project: Project = {
        id,
        name: clonedProject.name,
        status: 'active',
        path: clonedProject.path,
        createdAt: clonedProject.createdAt,
      }

      dispatch({ type: 'ADD_PROJECT', payload: project })
      onClose()
      navigate(`/project/${id}/terminal`)
    } catch (error) {
      setCloneError(error instanceof Error ? error.message : 'Clone failed')
    } finally {
      setCloning(false)
    }
  }

  const handleTalkToLead = () => {
    const id = createProjectId('new-project')
    const project: Project = {
      id,
      name: 'New Project',
      status: 'planning',
      path: null,
      createdAt: Date.now(),
    }
    dispatch({ type: 'ADD_PROJECT', payload: project })
    onClose()
    navigate(`/project/${id}/chat`)
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose()
  }

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
    >
      <div className="bg-white rounded-2xl shadow-card-hover w-full max-w-md mx-4 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {view === 'main' ? (
          <MainView
            onOpenFolder={handleOpenFolder}
            onClone={handleCloneStart}
            onTalkToLead={handleTalkToLead}
            onClose={onClose}
          />
        ) : (
          <CloneView
            url={cloneUrl}
            dest={cloneDest}
            error={cloneError}
            cloning={cloning}
            urlInputRef={urlInputRef}
            onUrlChange={setCloneUrl}
            onPickDest={handlePickCloneDest}
            onClone={handleClone}
            onBack={() => setView('main')}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  )
}

function MainView({
  onOpenFolder,
  onClone,
  onTalkToLead,
  onClose,
}: {
  onOpenFolder: () => void
  onClone: () => void
  onTalkToLead: () => void
  onClose: () => void
}) {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-heading text-lg font-semibold text-espresso">
          Create New Project
        </h2>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-7 h-7 rounded-lg text-muted hover:text-secondary hover:bg-sand/50 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <div className="space-y-2.5">
        <OptionCard
          icon={<FolderOpen size={20} />}
          title="Open from Folder"
          description="Select or create a local project folder"
          onClick={onOpenFolder}
        />
        <OptionCard
          icon={<GitBranch size={20} />}
          title="Clone from Git"
          description="Clone a repository to get started"
          onClick={onClone}
        />
        <OptionCard
          icon={<MessageSquare size={20} />}
          title="Talk to Project Lead"
          description="Describe your goals and let the agent plan"
          onClick={onTalkToLead}
        />
      </div>
    </div>
  )
}

function CloneView({
  url,
  dest,
  error,
  cloning,
  urlInputRef,
  onUrlChange,
  onPickDest,
  onClone,
  onBack,
  onClose,
}: {
  url: string
  dest: string
  error: string
  cloning: boolean
  urlInputRef: React.RefObject<HTMLInputElement | null>
  onUrlChange: (v: string) => void
  onPickDest: () => void
  onClone: () => void
  onBack: () => void
  onClose: () => void
}) {
  const canClone = url.trim().length > 0 && dest.trim().length > 0 && !cloning

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-muted hover:text-secondary hover:bg-sand/50 transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          <h2 className="font-heading text-lg font-semibold text-espresso">
            Clone from Git
          </h2>
        </div>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-7 h-7 rounded-lg text-muted hover:text-secondary hover:bg-sand/50 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block font-body text-sm text-secondary mb-1.5">
            Repository URL
          </label>
          <input
            ref={urlInputRef}
            type="text"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canClone) onClone()
            }}
            placeholder="https://github.com/user/repo.git"
            className="w-full bg-canvas border border-border rounded-lg px-3 py-2 text-sm text-espresso placeholder:text-muted outline-none focus:border-secondary transition-colors"
          />
        </div>

        <div>
          <label className="block font-body text-sm text-secondary mb-1.5">
            Destination Folder
          </label>
          <button
            onClick={onPickDest}
            className="w-full flex items-center gap-2 bg-canvas border border-border rounded-lg px-3 py-2 text-sm text-left hover:border-secondary transition-colors"
          >
            <FolderOpen size={14} className="text-muted shrink-0" />
            <span className={dest ? 'text-espresso truncate' : 'text-muted'}>
              {dest || 'Choose folder...'}
            </span>
          </button>
        </div>

        <button
          onClick={onClone}
          disabled={!canClone}
          className="w-full py-2 rounded-lg text-sm font-medium transition-colors bg-espresso text-canvas hover:bg-espresso/90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {cloning ? 'Cloning…' : 'Clone Repository'}
        </button>

        {error && (
          <p className="text-sm text-danger">{error}</p>
        )}
      </div>
    </div>
  )
}

function OptionCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-3.5 p-3.5 rounded-xl border border-border hover:bg-sand/50 hover:border-secondary/20 transition-colors text-left group"
    >
      <div className="text-muted mt-0.5 shrink-0 group-hover:text-secondary transition-colors">
        {icon}
      </div>
      <div>
        <div className="font-body text-sm font-medium text-espresso">
          {title}
        </div>
        <div className="font-body text-xs text-muted mt-0.5">{description}</div>
      </div>
    </button>
  )
}
