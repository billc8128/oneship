interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function MessageBubble({ role, content, timestamp }: MessageBubbleProps) {
  if (role === 'user') {
    return (
      <div className="flex flex-col items-end">
        <div
          className="max-w-[75%] px-4 py-2.5 bg-espresso text-canvas font-body text-sm"
          style={{ borderRadius: '12px 12px 4px 12px' }}
        >
          <p className="whitespace-pre-wrap">{content}</p>
        </div>
        <span className="font-mono text-[10px] text-light mt-1 mr-1">
          {formatTime(timestamp)}
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-start">
      <div className="flex items-start gap-2.5 max-w-[75%]">
        <span className="w-1.5 h-1.5 rounded-full bg-espresso mt-2 shrink-0" />
        <div className="font-body text-sm text-espresso">
          <p className="whitespace-pre-wrap">{content}</p>
        </div>
      </div>
      <span className="font-mono text-[10px] text-light mt-1 ml-4">
        {formatTime(timestamp)}
      </span>
    </div>
  )
}
