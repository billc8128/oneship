import type { AgentUIMessage } from '../../../../shared/agent-protocol'

interface Props {
  message: AgentUIMessage
}

export function UserBubble({ message }: Props) {
  const text = message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')
  return (
    <div className="flex justify-end mb-4">
      <div className="bg-surface px-4 py-2.5 rounded-2xl rounded-br-md shadow-sm max-w-[85%]">
        <p className="font-body text-sm text-espresso whitespace-pre-wrap">{text}</p>
      </div>
    </div>
  )
}
