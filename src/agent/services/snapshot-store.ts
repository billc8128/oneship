import type { AgentUIMessage } from '../../shared/agent-protocol'
import { Phase1NotImplemented } from './conversation-store'

export interface SnapshotData {
  uiMessages: AgentUIMessage[]
  snapshotEventOffset: number
}

/**
 * Phase 4 implementation: writes snapshot.json + updates meta. Phase 1 has
 * too few events for snapshotting to matter (every session replay is fast).
 */
export async function writeSnapshot(_dir: string, _data: SnapshotData): Promise<void> {
  throw new Phase1NotImplemented('writeSnapshot')
}

/**
 * Phase 4 implementation: reads snapshot.json, validates against meta.
 * Phase 1: always returns null (cache miss, replay-from-zero).
 */
export async function loadSnapshot(_dir: string): Promise<SnapshotData | null> {
  return null
}
