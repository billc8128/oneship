import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderOpen, Palette, Plus } from 'lucide-react'
import { StatCard } from '../components/ui/stat-card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { useProjects } from '../stores/project-store'
import { buildProjectActivity } from '../../shared/session-activity'

function shortenPath(fullPath: string | null): string {
  if (!fullPath) return '--'
  const home = window.electronAPI.homeDir
  const display = fullPath.startsWith(home) ? '~' + fullPath.slice(home.length) : fullPath
  const segments = display.split('/')
  if (segments.length <= 3) return display
  return segments.slice(-2).join('/')
}

const statusBadge: Record<string, 'active' | 'planning' | 'done'> = {
  active: 'active',
  planning: 'planning',
  done: 'done',
}

export function GlobalDashboard() {
  const navigate = useNavigate()
  const { projects, dispatch } = useProjects()
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [hookStatus, setHookStatus] = useState<HookRuntimeStatus | null>(null)

  useEffect(() => {
    const sync = () => {
      window.electronAPI.session.list().then(setSessions)
      window.electronAPI.hook.getStatus().then(setHookStatus)
    }

    sync()
    const interval = setInterval(sync, 2000)
    return () => clearInterval(interval)
  }, [])

  const activeCount = projects.filter((p) => p.status === 'active').length
  const activity = buildProjectActivity(projects, sessions)
  const liveAgents = activity.reduce((count, summary) => count + summary.liveAgents, 0)
  const liveTerminals = activity.reduce((count, summary) => count + summary.liveTerminals, 0)

  const handleNewProject = () => {
    const id = crypto.randomUUID()
    dispatch({
      type: 'ADD_PROJECT',
      payload: { id, name: 'Untitled Project', status: 'planning', path: null, createdAt: Date.now() },
    })
    navigate(`/project/${id}/chat`)
  }

  const handleOpenFolder = async () => {
    const folderPath = await window.electronAPI.openFolder()
    if (!folderPath) return
    const id = crypto.randomUUID()
    const name = folderPath.split('/').pop() || 'Project'
    dispatch({
      type: 'ADD_PROJECT',
      payload: { id, name, status: 'active', path: folderPath, createdAt: Date.now() },
    })
    navigate(`/project/${id}`)
  }

  return (
    <div className="p-8">
      <h1 className="font-heading text-2xl font-bold text-espresso mb-6">Dashboard</h1>

      <div className="flex gap-4 mb-8">
        <StatCard label="Projects" value={String(projects.length)} unit={`${activeCount} active`} unitColor="text-success" />
        <StatCard label="Live Agents" value={String(liveAgents)} unit={`${liveTerminals} terminals`} />
        <StatCard
          label="Hook Runtime"
          value={hookStatus?.running ? 'Live' : 'Down'}
          unit={
            hookStatus?.running
              ? `:${hookStatus.port ?? '--'}`
              : hookStatus?.lastError ?? 'not available'
          }
          unitColor={hookStatus?.running ? 'text-success' : 'text-danger'}
        />
      </div>

      <div className="bg-surface rounded-xl shadow-card overflow-hidden mb-8">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-heading text-sm font-semibold text-espresso">Projects</h2>
        </div>

        {projects.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="font-body text-sm text-muted mb-3">No projects yet</p>
            <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={handleNewProject}>
              Create your first project
            </Button>
          </div>
        ) : (
          <table className="w-full table-fixed">
            <colgroup>
              <col className="w-[35%]" />
              <col className="w-[45%]" />
              <col className="w-[20%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-border">
                <th className="px-5 py-2.5 text-left font-mono text-[10px] font-medium text-light tracking-wider uppercase">Name</th>
                <th className="px-5 py-2.5 text-left font-mono text-[10px] font-medium text-light tracking-wider uppercase">Path</th>
                <th className="px-5 py-2.5 text-left font-mono text-[10px] font-medium text-light tracking-wider uppercase">Status</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr
                  key={project.id}
                  onClick={() => navigate(`/project/${project.id}`)}
                  className="border-b border-border last:border-0 hover:bg-sand/30 transition-colors cursor-pointer"
                >
                  <td className="px-5 py-3 font-body text-sm text-espresso truncate">{project.name}</td>
                  <td className="px-5 py-3 font-mono text-sm text-secondary truncate">{shortenPath(project.path)}</td>
                  <td className="px-5 py-3 whitespace-nowrap">
                    <Badge variant={statusBadge[project.status] ?? 'planning'}>{project.status}</Badge>
                  </td>
                </tr>
              ))}
              <tr
                onClick={handleNewProject}
                className="hover:bg-sand/30 transition-colors cursor-pointer"
              >
                <td colSpan={3} className="px-5 py-3 font-body text-sm text-muted">
                  <span className="flex items-center gap-2">
                    <Plus size={14} />
                    New Project
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-surface rounded-xl shadow-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-heading text-sm font-semibold text-espresso">Quick Actions</h2>
        </div>
        <div className="p-5 flex gap-3">
          <Button variant="secondary" icon={<Plus size={16} className="text-muted" />} onClick={handleNewProject}>
            New Project
          </Button>
          <Button variant="secondary" icon={<FolderOpen size={16} className="text-muted" />} onClick={handleOpenFolder}>
            Open Folder
          </Button>
          <Button variant="secondary" icon={<Palette size={16} className="text-muted" />} onClick={() => navigate('/preferences/terminal')}>
            Terminal Themes
          </Button>
        </div>
      </div>
    </div>
  )
}
