import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Settings2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { VennLogo } from '../ui/venn-logo'
import { sidebarBrandMenuItems } from './sidebar-brand-menu'

export function SidebarBrand() {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  return (
    <div className="relative px-3 pt-4 pb-3" ref={menuRef}>
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-sand/60 transition-colors"
      >
        <VennLogo size={26} />
        <span className="flex-1 font-heading text-[15px] font-semibold text-espresso">Oneship</span>
        <ChevronDown size={15} className={`text-muted transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
      </button>

      {menuOpen && (
        <div className="absolute left-3 right-3 top-[calc(100%-4px)] z-20 rounded-xl border border-border bg-surface p-1.5 shadow-card">
          {sidebarBrandMenuItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setMenuOpen(false)
                navigate(item.to)
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-secondary hover:bg-sand/60 hover:text-espresso transition-colors"
            >
              <Settings2 size={15} className="text-muted" />
              <span className="flex-1 text-left">{item.label}</span>
              {item.shortcut && (
                <span className="font-mono text-[11px] tracking-wide text-light">{item.shortcut}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
