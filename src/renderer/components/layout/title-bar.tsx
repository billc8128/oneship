import { type ReactNode } from 'react'

interface TitleBarProps {
  title?: string
  leftContent?: ReactNode
  rightContent?: ReactNode
}

export function TitleBar({ title, leftContent, rightContent }: TitleBarProps) {
  return (
    <div className="titlebar-drag h-11 flex items-center justify-center shrink-0 bg-canvas border-b border-border relative">
      {leftContent && (
        <div className="titlebar-no-drag absolute left-20 flex items-center">
          {leftContent}
        </div>
      )}
      {title && (
        <span className="font-body text-xs text-muted select-none">{title}</span>
      )}
      {rightContent && (
        <div className="titlebar-no-drag absolute right-4 flex items-center">
          {rightContent}
        </div>
      )}
    </div>
  )
}
