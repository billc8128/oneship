import { useEffect, useRef } from 'react'
import {
  attachTerminalView,
  detachTerminalView,
  focusTerminalView,
} from '../../stores/terminal-view-store'
import {
  getTerminalPanelStyle,
  terminalViewPanelClassName,
  terminalViewShellClassName,
} from './terminal-theme'
import { useTerminalThemeSnapshot } from '../../stores/terminal-theme-store'

interface TerminalViewProps {
  sessionId: string
  isActive: boolean
}

export function TerminalView({ sessionId, isActive }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { resolvedActiveTheme } = useTerminalThemeSnapshot()

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    attachTerminalView(sessionId, container)

    return () => {
      detachTerminalView(sessionId, container)
    }
  }, [sessionId])

  useEffect(() => {
    if (isActive) {
      focusTerminalView(sessionId)
    }
  }, [isActive, sessionId])

  return (
    <div
      style={{ display: isActive ? 'flex' : 'none' }}
      className={terminalViewShellClassName}
    >
      <div
        className={terminalViewPanelClassName}
        style={getTerminalPanelStyle(resolvedActiveTheme)}
      >
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden"
        />
      </div>
    </div>
  )
}
