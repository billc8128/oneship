import { useState, useRef, useCallback, type KeyboardEvent } from 'react'
import { Paperclip, ArrowUp } from 'lucide-react'

interface ChatInputProps {
  placeholder: string
  onSend: (content: string) => void
  disabled?: boolean
}

export function ChatInput({ placeholder, onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    const lineHeight = 20
    const maxHeight = lineHeight * 4
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`
  }, [])

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [value, disabled, onSend])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  return (
    <div className="px-6 py-4 border-t border-border bg-surface">
      <div className="flex items-end gap-2 bg-canvas border border-border rounded-xl px-3 py-2.5">
        <button
          className="text-light cursor-not-allowed mb-0.5"
          disabled
          title="File attachments coming soon"
        >
          <Paperclip size={18} />
        </button>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            adjustHeight()
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={disabled}
          className="flex-1 bg-transparent font-body text-sm text-espresso placeholder:text-light focus:outline-none resize-none leading-5"
        />
        <button
          onClick={handleSend}
          disabled={!value.trim() || disabled}
          className="w-7 h-7 flex items-center justify-center rounded-lg bg-espresso text-canvas hover:bg-espresso/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0 mb-0.5"
        >
          <ArrowUp size={16} />
        </button>
      </div>
    </div>
  )
}
