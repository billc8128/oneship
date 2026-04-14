import { Phase1NotImplemented } from './conversation-store'
import type { LogEvent } from './event-log'
import type { AgentUIMessage } from '../../shared/agent-protocol'

/**
 * Phase 4 implementation: collapse events.jsonl into the minimum events
 * needed to reconstruct the current uiMessages, including message-finish
 * for completed messages (§15.2.5). Phase 1: stub.
 */
export function compactEventLog(_uiMessages: AgentUIMessage[]): LogEvent[] {
  throw new Phase1NotImplemented('compactEventLog')
}

/**
 * Phase 4 implementation: scan uiMessages for orphan __suspended placeholders
 * (parallel-call losers) and rewrite them via part-update events. Phase 1:
 * no suspending tools yet, so this is a no-op when called and a Phase1NotImplemented
 * if anyone tries to actually use the placeholder rewrite path.
 */
export async function cleanupOrphanPlaceholders(): Promise<void> {
  // intentional no-op in Phase 1: no tools can produce placeholders yet.
}
