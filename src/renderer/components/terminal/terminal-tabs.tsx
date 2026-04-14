import { useState, useRef, useEffect } from 'react'
import { X, Plus } from 'lucide-react'
import {
  getTerminalActiveTabStyle,
  getTerminalInactiveTabStyle,
  getTerminalTabsBarStyle,
  terminalTabsBarClassName,
} from './terminal-theme'
import { useTerminalThemeSnapshot } from '../../stores/terminal-theme-store'

export interface TerminalTab {
  id: string
  label: string
}

interface TerminalTabsProps {
  tabs: TerminalTab[]
  activeId: string
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onCreate: () => void
  onRename: (id: string, newLabel: string) => void
}

export function TerminalTabs({ tabs, activeId, onSelect, onClose, onCreate, onRename }: TerminalTabsProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const { resolvedActiveTheme } = useTerminalThemeSnapshot()

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])

  const startEditing = (tab: TerminalTab) => {
    setEditingId(tab.id)
    setEditValue(tab.label)
  }

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim())
    }
    setEditingId(null)
  }

  const cancelEditing = () => {
    setEditingId(null)
  }

  return (
    <div className={terminalTabsBarClassName} style={getTerminalTabsBarStyle(resolvedActiveTheme)}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeId
        const isEditing = editingId === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            onDoubleClick={() => startEditing(tab)}
            style={isActive ? getTerminalActiveTabStyle(resolvedActiveTheme) : getTerminalInactiveTabStyle(resolvedActiveTheme)}
            className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-xs transition-colors ${
              isActive
                ? 'font-medium'
                : 'hover:bg-sand/50'
            }`}
          >
            {isEditing ? (
              <input
                ref={inputRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') cancelEditing()
                }}
                onClick={(e) => e.stopPropagation()}
                style={isActive ? getTerminalActiveTabStyle(resolvedActiveTheme) : getTerminalInactiveTabStyle(resolvedActiveTheme)}
                className="bg-transparent border-b border-muted outline-none font-mono text-xs w-24"
              />
            ) : (
              <span>{tab.label}</span>
            )}
            <span
              onClick={(e) => {
                e.stopPropagation()
                onClose(tab.id)
              }}
              className={`inline-flex items-center justify-center w-4 h-4 rounded hover:bg-border transition-colors ${
                isActive ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'
              }`}
            >
              <X size={10} />
            </span>
          </button>
        )
      })}
      <button
        onClick={onCreate}
        className="flex items-center justify-center w-7 h-7 rounded-lg text-muted hover:bg-sand/50 hover:text-secondary transition-colors"
      >
        <Plus size={14} />
      </button>
    </div>
  )
}
