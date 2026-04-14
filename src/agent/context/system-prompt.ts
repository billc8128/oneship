// Phase 2 implementation: returns the static + dynamic system messages
// from §7.1, complete with cache control on the static block.
// Phase 1: empty array. Worker hardcodes its assistant text in runSegment
// stub instead of going through any LLM.

import type { AgentUIMessage } from '../../shared/agent-protocol'

export function buildSystemMessages(): AgentUIMessage[] {
  return []
}
