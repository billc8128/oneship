import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, FolderOpen, Plus, Terminal, Copy, Clock, Settings } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { useProjects } from '../stores/project-store'
import {
  buildProjectActivity,
  getSessionBadgeVariant,
  getSessionStateLabel,
} from '../../shared/session-activity'

function formatPath(fullPath: string | null): string {
  if (!fullPath) return '--'
  const home = window.electronAPI.homeDir
  return fullPath.startsWith(home) ? '~' + fullPath.slice(home.length) : fullPath
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function relativeTime(timestampMs: number): string {
  const diff = Date.now() - timestampMs
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

interface FileEntry {
  name: string
  type: 'file' | 'directory'
  size: number
  modifiedAt: number
}

const statusDot: Record<string, string> = {
  active: 'bg-success',
  planning: 'bg-warning',
  done: 'bg-light',
}

export function ProjectDashboard() {
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()
  const { projects } = useProjects()
  const project = projects.find((p) => p.id === projectId)

  const [recentFiles, setRecentFiles] = useState<FileEntry[]>([])
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [copied, setCopied] = useState(false)

  const projectName = project?.name ?? 'Unknown Project'
  const dotClass = project ? statusDot[project.status] ?? 'bg-light' : 'bg-light'

  // Fetch recent files from project directory
  useEffect(() => {
    if (!project?.path) return
    window.electronAPI.fs.readDir(project.path).then((entries) => {
      const files = entries
        .filter((e: FileEntry) => e.type === 'file')
        .sort((a: FileEntry, b: FileEntry) => b.modifiedAt - a.modifiedAt)
        .slice(0, 8)
      setRecentFiles(files)
    })
  }, [project?.path])

  // Fetch terminal sessions for this project
  useEffect(() => {
    if (!projectId) return
    const sync = () => {
      window.electronAPI.session.list(projectId).then(setSessions)
    }

    sync()
    const interval = setInterval(sync, 2000)
    return () => clearInterval(interval)
  }, [projectId])

  const handleOpenInFinder = () => {
    if (project?.path) {
      window.electronAPI.fs.openInSystem(project.path)
    }
  }

  const handleCopyPath = () => {
    if (project?.path) {
      navigator.clipboard.writeText(project.path)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleNewTerminal = async () => {
    if (!projectId) return
    const cwd = project?.path || window.electronAPI.homeDir
    const sessionId = await window.electronAPI.terminal.create(projectId, cwd)
    navigate(`/project/${projectId}/terminal/${sessionId}`)
  }

  const handleSettings = () => {
    navigate(`/project/${projectId}/settings`)
  }

  const activity = useMemo(
    () => (project ? buildProjectActivity([project], sessions)[0] : null),
    [project, sessions],
  )
  const liveSessions = activity?.activeSessions ?? []

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-muted hover:text-secondary transition-colors">
            <ArrowLeft size={20} />
          </button>
          <span className={`w-2.5 h-2.5 rounded-full ${dotClass}`} />
          <h1 className="font-heading text-2xl font-bold text-espresso">{projectName}</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSettings}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-muted hover:text-secondary hover:bg-sand/50 transition-colors"
            title="Project Settings"
          >
            <Settings size={16} />
          </button>
          <Button variant="primary" onClick={() => navigate(`/project/${projectId}/chat`)}>Talk to Agent</Button>
          <Button variant="secondary" onClick={() => navigate(`/project/${projectId}/terminal`)}>Terminal</Button>
        </div>
      </div>

      {/* Project Info Card */}
      <div className="bg-surface rounded-xl shadow-card p-5 mb-8">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <span className="font-mono text-[10px] font-medium text-light tracking-wider uppercase">Path</span>
              <span className="font-mono text-sm text-espresso truncate">
                {project?.path ? formatPath(project.path) : 'No folder linked'}
              </span>
              {project?.path && (
                <button
                  onClick={handleCopyPath}
                  className="text-muted hover:text-secondary transition-colors shrink-0"
                  title="Copy path"
                >
                  <Copy size={14} />
                </button>
              )}
              {copied && <span className="font-mono text-xs text-success">Copied</span>}
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] font-medium text-light tracking-wider uppercase">Created</span>
                <span className="font-body text-sm text-secondary">
                  {project ? formatDate(project.createdAt) : '--'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] font-medium text-light tracking-wider uppercase">Status</span>
                <Badge variant={project ? (project.status as 'active' | 'planning' | 'done') : 'planning'}>
                  {project?.status ?? 'unknown'}
                </Badge>
              </div>
            </div>
          </div>
          {project?.path && (
            <Button variant="secondary" size="sm" icon={<FolderOpen size={14} />} onClick={handleOpenInFinder}>
              Open in Finder
            </Button>
          )}
        </div>
      </div>

      {/* Two-column panels */}
      <div className="flex gap-6">
        {/* Recent Files */}
        <div className="flex-1 bg-surface rounded-xl shadow-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="font-heading text-sm font-semibold text-espresso">Recent Files</h2>
          </div>
          {!project?.path ? (
            <div className="p-5 text-center">
              <p className="font-body text-sm text-muted">No folder linked</p>
            </div>
          ) : recentFiles.length === 0 ? (
            <div className="p-5 text-center">
              <p className="font-body text-sm text-muted">No files found</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recentFiles.map((file) => (
                <div
                  key={file.name}
                  className="px-5 py-3 flex items-center justify-between hover:bg-sand/30 transition-colors cursor-pointer"
                  onClick={() => {
                    if (project?.path) {
                      window.electronAPI.fs.openInSystem(`${project.path}/${file.name}`)
                    }
                  }}
                >
                  <span className="font-mono text-sm text-espresso truncate">{file.name}</span>
                  <span className="font-mono text-xs text-light shrink-0 ml-3 flex items-center gap-1">
                    <Clock size={11} />
                    {relativeTime(file.modifiedAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Terminals */}
        <div className="flex-1 bg-surface rounded-xl shadow-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-heading text-sm font-semibold text-espresso">Terminals</h2>
              <span className="font-mono text-[10px] text-light uppercase tracking-wider">
                {liveSessions.length} live
              </span>
            </div>
          </div>
          {liveSessions.length === 0 ? (
            <div className="p-5 text-center">
              <p className="font-body text-sm text-muted mb-3">No live terminals</p>
              <Button variant="secondary" size="sm" icon={<Terminal size={14} />} onClick={handleNewTerminal}>
                Launch Terminal
              </Button>
            </div>
          ) : (
            <div>
              <div className="px-5 py-4">
                <div className="space-y-2">
                  {liveSessions.map((session) => (
                    <div
                      key={session.id}
                      onClick={() => navigate(`/project/${projectId}/terminal/${session.id}`)}
                      className="px-3 py-3 flex items-center justify-between rounded-lg hover:bg-sand/30 transition-colors cursor-pointer"
                    >
                      <div className="min-w-0">
                        <span className="font-body text-sm text-espresso block truncate">{session.label}</span>
                        <span className="font-mono text-[11px] text-light">
                          {relativeTime(session.updatedAt)}
                          {session.lastEventSummary ? ` · ${session.lastEventSummary}` : ''}
                        </span>
                      </div>
                      <Badge variant={getSessionBadgeVariant(session)}>{getSessionStateLabel(session)}</Badge>
                    </div>
                  ))}
                </div>
              </div>

              <div
                onClick={handleNewTerminal}
                className="px-5 py-3 border-t border-border hover:bg-sand/30 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2 font-body text-sm text-muted">
                  <Plus size={14} />
                  New Terminal
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
