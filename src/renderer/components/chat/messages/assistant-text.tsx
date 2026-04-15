import type { AgentUIMessage } from '../../../../shared/agent-protocol'
import { VennLogo } from '../../ui/venn-logo'

interface Props {
  message: AgentUIMessage
}

export function AssistantText({ message }: Props) {
  const text = message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')
  return (
    <div className="flex gap-3 mb-4">
      <div className="flex-shrink-0 mt-1">
        <VennLogo size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-body text-xs text-muted mb-1">Chief Agent</p>
        <p className="font-body text-sm text-espresso whitespace-pre-wrap">{text}</p>
      </div>
    </div>
  )
}
