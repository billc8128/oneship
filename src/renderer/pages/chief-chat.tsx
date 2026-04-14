import { useState, useEffect, useCallback } from 'react'
import { VennLogo } from '../components/ui/venn-logo'
import { MessageList } from '../components/chat/message-list'
import { ChatInput } from '../components/chat/chat-input'
import { useProjects } from '../stores/project-store'

export function ChiefChat() {
  const { projects } = useProjects()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)

  useEffect(() => {
    window.electronAPI.chat.getConversation(null).then((conv) => {
      setMessages(conv.messages)
    })
  }, [])

  const handleSend = useCallback(async (content: string) => {
    setSending(true)
    try {
      const conv = await window.electronAPI.chat.sendMessage(null, content)
      setMessages(conv.messages)
    } finally {
      setSending(false)
    }
  }, [])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-surface">
        <VennLogo size={28} />
        <div>
          <h1 className="font-heading text-sm font-semibold text-espresso">Chief Agent</h1>
          <p className="font-body text-xs text-muted">
            Overseeing {projects.length} project{projects.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      <MessageList messages={messages} />

      <ChatInput
        placeholder="Message Chief Agent..."
        onSend={handleSend}
        disabled={sending}
      />
    </div>
  )
}
