import { Phase1NotImplemented } from '../services/conversation-store'

export interface ModelHandle {
  modelId: string
}

/**
 * Phase 2 fills this in with `createOpenRouter({ apiKey })(modelId)`.
 * Phase 1 throws so the LLM call path is wired but not reachable.
 */
export function getModel(_modelId: string): ModelHandle {
  throw new Phase1NotImplemented('getModel (OpenRouter provider)')
}
