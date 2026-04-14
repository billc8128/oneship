import { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderOpen } from 'lucide-react'
import { SidebarBrand } from './sidebar-brand'
import { SidebarNav } from './sidebar-nav'
import { SidebarProjects } from './sidebar-projects'
import { useProjects } from '../../stores/project-store'

interface SidebarProps {
  style?: CSSProperties
}

export function Sidebar({ style }: SidebarProps) {
  const navigate = useNavigate()
  const { dispatch } = useProjects()

  const handleOpenWorkspace = async () => {
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
    <aside
      className="bg-surface flex flex-col shrink-0 overflow-y-auto"
      style={style}
    >
      <SidebarBrand />
      <SidebarNav />
      <SidebarProjects />

      <div className="flex-1" />

      <div className="px-3 pb-3">
        <button
          onClick={handleOpenWorkspace}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] text-muted hover:text-secondary hover:bg-sand/50 transition-colors w-full"
        >
          <FolderOpen size={13} className="text-muted" />
          <span>Open Workspace</span>
        </button>
      </div>
    </aside>
  )
}
