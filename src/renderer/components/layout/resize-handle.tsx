import { useCallback, useRef } from 'react'

interface ResizeHandleProps {
  onDrag: (deltaX: number) => void
}

export function ResizeHandle({ onDrag }: ResizeHandleProps) {
  const isDragging = useRef(false)
  const lastX = useRef(0)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isDragging.current = true
      lastX.current = e.clientX

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isDragging.current) return
        const deltaX = moveEvent.clientX - lastX.current
        lastX.current = moveEvent.clientX
        onDrag(deltaX)
      }

      const handleMouseUp = () => {
        isDragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [onDrag]
  )

  return (
    <div
      onMouseDown={handleMouseDown}
      className="group relative w-0 shrink-0 cursor-col-resize"
    >
      {/* Visible 1px line */}
      <div className="absolute inset-y-0 left-0 w-px bg-border" />
      {/* Wider hover/drag hit area */}
      <div className="absolute inset-y-0 -left-[2px] w-[5px] opacity-0 group-hover:opacity-100 bg-border/50 transition-opacity" />
    </div>
  )
}
