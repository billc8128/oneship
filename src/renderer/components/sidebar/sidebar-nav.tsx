import { NavLink } from 'react-router-dom'
import { Activity } from 'lucide-react'
import { VennLogo } from '../ui/venn-logo'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
    isActive
      ? 'bg-sand font-medium text-espresso'
      : 'text-secondary hover:bg-sand/50'
  }`

export function SidebarNav() {
  return (
    <nav className="px-3 mt-1 space-y-0.5">
      <NavLink to="/chief" className={navLinkClass}>
        {({ isActive }) => (
          <>
            <VennLogo size={16} className="text-muted" />
            <span className="flex-1">Chief Agent</span>
            <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-success' : 'bg-success'}`} />
          </>
        )}
      </NavLink>
      <NavLink to="/" end className={navLinkClass}>
        <Activity size={16} className="text-muted" />
        <span>Dashboard</span>
      </NavLink>
    </nav>
  )
}
