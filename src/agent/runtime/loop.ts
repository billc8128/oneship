// Phase 2 will implement runSegment(session) here per spec §5.4 — streamText
// with stopWhen: stepCountIs(N), abort-on-suspension, and the cleanupOrphan
// pre-segment sweep. Phase 1 has no LLM, so the actual hardcoded reply path
// lives on Session.appendAssistantStubReply() instead. This file exists to
// claim the module boundary so Phase 2 can fill in `runSegment` without
// renaming or moving anything.

import { Phase1NotImplemented } from '../services/conversation-store'
import type { SegmentFinishReason } from '../../shared/agent-protocol'

export interface RunSegmentResult {
  reason: SegmentFinishReason
  error?: string
}

export async function runSegment(): Promise<RunSegmentResult> {
  throw new Phase1NotImplemented('runSegment (LLM-driven agent loop)')
}
