// Phase 4 implementation: SuspensionSpec, suspension.json persistence,
// resolution helpers. Phase 1: types only. The spec's full definitions
// live in §15.5; this file currently re-exports nothing useful, but the
// filename and module boundary are claimed.

export type SuspensionKind = 'plan' | 'question' | 'cautious'

// Placeholder. Phase 4 fills in the discriminated union per §15.5.
export interface SuspensionSpec {
  suspensionId: string
  kind: SuspensionKind
}
