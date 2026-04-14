// Phase 2+ will use this to call back into Main for things like ListProjects.
// Phase 1 has no tools that need Main data, so the stub rejects unconditionally.

import { Phase1NotImplemented } from '../services/conversation-store'

export async function rpcCall<T>(_op: string, _params: unknown): Promise<T> {
  throw new Phase1NotImplemented('rpcCall (Worker→Main RPC)')
}
