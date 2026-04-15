import { useChiefSession } from '../stores/chief-session'
import { VennLogo } from '../components/ui/venn-logo'
import { ChatInput } from '../components/chat/chat-input'
import { UserBubble } from '../components/chat/messages/user-bubble'
import { AssistantText } from '../components/chat/messages/assistant-text'
import { SystemNotice } from '../components/chat/messages/system-notice'
import { useProjects } from '../stores/project-store'

export function ChiefChat() {
  const { projects } = useProjects()
  const { status, uiMessages, sendUserMessage, error } = useChiefSession()

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

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {status === 'booting' && <SystemNotice text="Connecting to Chief Agent…" />}
        {error && <SystemNotice text={`Error: ${error}`} />}
        {uiMessages.map((msg) =>
          msg.role === 'user' ? (
            <UserBubble key={msg.id} message={msg} />
          ) : msg.role === 'assistant' ? (
            <AssistantText key={msg.id} message={msg} />
          ) : null
        )}
      </div>

      <ChatInput
        placeholder="Message Chief Agent..."
        onSend={sendUserMessage}
        disabled={status === 'sending' || status === 'booting' || status === 'error'}
      />
    </div>
  )
}
