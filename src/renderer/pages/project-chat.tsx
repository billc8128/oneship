import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { MessageList } from '../components/chat/message-list'
import { ChatInput } from '../components/chat/chat-input'
import { useProjects } from '../stores/project-store'

export function ProjectChat() {
  const { projectId } = useParams<{ projectId: string }>()
  const { projects } = useProjects()
  const project = projects.find((p) => p.id === projectId)
  const projectName = project?.name ?? 'Project'

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!projectId) return
    window.electronAPI.chat.getConversation(projectId).then((conv) => {
      setMessages(conv.messages)
    })
  }, [projectId])

  const handleSend = useCallback(async (content: string) => {
    if (!projectId) return
    setSending(true)
    try {
      const conv = await window.electronAPI.chat.sendMessage(projectId, content)
      setMessages(conv.messages)
    } finally {
      setSending(false)
    }
  }, [projectId])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-surface">
        <span className="w-2.5 h-2.5 rounded-full bg-success" />
        <div>
          <h1 className="font-heading text-sm font-semibold text-espresso">Project Lead</h1>
          <p className="font-body text-xs text-muted">{projectName}</p>
        </div>
      </div>

      <MessageList messages={messages} />

      <ChatInput
        placeholder={`Message Project Lead...`}
        onSend={handleSend}
        disabled={sending}
      />
    </div>
  )
}
