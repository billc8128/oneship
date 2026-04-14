// Phase 2 implementation: real retry with exponential backoff for 429/529/network.
// Phase 1: passthrough so callers using `withRetry(fn)` already work.

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  return fn()
}
