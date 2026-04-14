# Terminal Page Session Event Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `TerminalPage` consume `session:updated` and `session:removed` through one stable subscription per project scope, without stale-closure races, repeated resubscribe churn, or side effects hidden inside React state updaters.

**Architecture:** Keep the current `projectId`-scoped remount and single-active-`TerminalView` model. Fix the remaining event-handling bug by extracting pure state-derivation helpers, storing the latest `records` and `activeId` in refs for event callbacks, and keeping navigation / terminal-destroy side effects outside React state updater functions. Do not widen this into a `useReducer` rewrite in this pass.

**Tech Stack:** React 19, React Router 7, Electron preload IPC bridge, Vitest

---

## File Map

- Modify: `src/renderer/pages/terminal-page.tsx`
  - Stabilize the `session.onUpdated` / `session.onRemoved` effect so it no longer depends on `records` or `activeId`.
  - Use refs for latest state inside IPC callbacks.
  - Keep imperative effects (`navigate`, `destroyTerminalView`) outside React state updater functions.
- Create: `src/renderer/pages/terminal-page-state.ts`
  - Hold pure helpers for deriving next `records`, `activeId`, and navigation target after `session:updated` and `session:removed`.
  - Keep this file logic-only so it can be tested without a React renderer harness.
- Create: `src/renderer/pages/__tests__/terminal-page-state.test.ts`
  - Verify update and deletion state transitions independently of React timing.
- Verify existing coverage still passes:
  - `src/renderer/stores/__tests__/session-records.test.ts`
  - `src/renderer/stores/__tests__/terminal-view-store.test.ts`
  - `src/preload/__tests__/index.test.ts`

### Task 1: Lock Down Session Event State Semantics in Pure Helpers

**Files:**
- Create: `src/renderer/pages/terminal-page-state.ts`
- Create: `src/renderer/pages/__tests__/terminal-page-state.test.ts`

- [ ] **Step 1: Write the failing tests for update/removal state derivation**

Create `src/renderer/pages/__tests__/terminal-page-state.test.ts` with cases like:

```ts
import { describe, expect, it } from 'vitest'
import { deriveRemovalOutcome, deriveUpdateOutcome } from '../terminal-page-state'

function makeRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: overrides.id ?? 'session-1',
    projectId: overrides.projectId ?? 'project-1',
    cwd: overrides.cwd ?? '/tmp/project',
    shell: overrides.shell ?? '/bin/zsh',
    label: overrides.label ?? 'Terminal 1',
    createdAt: overrides.createdAt ?? 100,
    updatedAt: overrides.updatedAt ?? 100,
    lifecycle: overrides.lifecycle ?? 'live',
    lastStatus: overrides.lastStatus ?? 'idle',
    lastEventSummary: overrides.lastEventSummary ?? '',
    source: overrides.source ?? null,
    lastHookName: overrides.lastHookName ?? null,
    lastToolName: overrides.lastToolName ?? null,
  }
}

describe('deriveRemovalOutcome', () => {
  it('keeps activeId unchanged when a different session is removed', () => {
    const result = deriveRemovalOutcome({
      records: [makeRecord({ id: 'a' }), makeRecord({ id: 'b' })],
      activeId: 'a',
      removedSessionId: 'b',
      urlSessionId: undefined,
      projectId: 'project-1',
    })

    expect(result.nextActiveId).toBe('a')
    expect(result.navigateTo).toBeNull()
  })

  it('falls back to the first remaining live session when the active session is removed', () => {
    const result = deriveRemovalOutcome({
      records: [
        makeRecord({ id: 'a' }),
        makeRecord({ id: 'b', updatedAt: 200 }),
      ],
      activeId: 'a',
      removedSessionId: 'a',
      urlSessionId: undefined,
      projectId: 'project-1',
    })

    expect(result.nextRecords.map((record) => record.id)).toEqual(['b'])
    expect(result.nextActiveId).toBe('b')
    expect(result.navigateTo).toBe('/project/project-1/terminal/b')
  })

  it('navigates to the project terminal root when no live sessions remain', () => {
    const result = deriveRemovalOutcome({
      records: [makeRecord({ id: 'a', lifecycle: 'closed' })],
      activeId: 'a',
      removedSessionId: 'a',
      urlSessionId: undefined,
      projectId: 'project-1',
    })

    expect(result.nextRecords).toEqual([])
    expect(result.nextActiveId).toBe('')
    expect(result.navigateTo).toBe('/project/project-1/terminal')
  })
})

describe('deriveUpdateOutcome', () => {
  it('keeps the existing active session when one is already selected', () => {
    const result = deriveUpdateOutcome({
      records: [makeRecord({ id: 'a' })],
      activeId: 'a',
      record: makeRecord({ id: 'b', updatedAt: 200 }),
      urlSessionId: undefined,
      projectId: 'project-1',
    })

    expect(result.nextRecords.map((record) => record.id)).toEqual(['b', 'a'])
    expect(result.nextActiveId).toBe('a')
    expect(result.navigateTo).toBeNull()
  })

  it('activates the url session when that session record arrives and nothing is selected yet', () => {
    const record = makeRecord({ id: 'wanted', updatedAt: 200 })

    const result = deriveUpdateOutcome({
      records: [],
      activeId: '',
      record,
      urlSessionId: 'wanted',
      projectId: 'project-1',
    })

    expect(result.nextRecords).toEqual([record])
    expect(result.nextActiveId).toBe('wanted')
    expect(result.navigateTo).toBeNull()
  })

  it('navigates to the first live session when no session is active and a live record arrives', () => {
    const record = makeRecord({ id: 'live-1', lifecycle: 'live', updatedAt: 200 })

    const result = deriveUpdateOutcome({
      records: [],
      activeId: '',
      record,
      urlSessionId: undefined,
      projectId: 'project-1',
    })

    expect(result.nextRecords).toEqual([record])
    expect(result.nextActiveId).toBe('live-1')
    expect(result.navigateTo).toBe('/project/project-1/terminal/live-1')
  })
})
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `pnpm test -- src/renderer/pages/__tests__/terminal-page-state.test.ts`

Expected: FAIL because `../terminal-page-state` does not exist yet.

- [ ] **Step 3: Implement the minimal pure helpers**

Create `src/renderer/pages/terminal-page-state.ts`:

```ts
import { removeSessionRecord, upsertSessionRecord } from '../stores/session-records'

type DeriveUpdateOutcomeArgs = {
  records: SessionRecord[]
  activeId: string
  record: SessionRecord
  urlSessionId?: string
  projectId: string
}

type UpdateOutcome = {
  nextRecords: SessionRecord[]
  nextActiveId: string
  navigateTo: string | null
}

type DeriveRemovalOutcomeArgs = {
  records: SessionRecord[]
  activeId: string
  removedSessionId: string
  urlSessionId?: string
  projectId: string
}

type RemovalOutcome = {
  nextRecords: SessionRecord[]
  nextActiveId: string
  navigateTo: string | null
  removedExisted: boolean
}

export function deriveUpdateOutcome({
  records,
  activeId,
  record,
  urlSessionId,
  projectId,
}: DeriveUpdateOutcomeArgs): UpdateOutcome {
  const nextRecords = upsertSessionRecord(records, record)

  if (activeId) {
    return {
      nextRecords,
      nextActiveId: activeId,
      navigateTo: null,
    }
  }

  if (urlSessionId && record.id === urlSessionId) {
    return {
      nextRecords,
      nextActiveId: urlSessionId,
      navigateTo: null,
    }
  }

  if (record.lifecycle === 'live') {
    return {
      nextRecords,
      nextActiveId: record.id,
      navigateTo: `/project/${projectId}/terminal/${record.id}`,
    }
  }

  return {
    nextRecords,
    nextActiveId: activeId,
    navigateTo: null,
  }
}

export function deriveRemovalOutcome({
  records,
  activeId,
  removedSessionId,
  urlSessionId,
  projectId,
}: DeriveRemovalOutcomeArgs): RemovalOutcome {
  if (!records.some((record) => record.id === removedSessionId)) {
    return {
      nextRecords: records,
      nextActiveId: activeId,
      navigateTo: null,
      removedExisted: false,
    }
  }

  const nextRecords = removeSessionRecord(records, removedSessionId)
  const nextLive = nextRecords.filter((record) => record.lifecycle === 'live')

  if (activeId !== removedSessionId) {
    return {
      nextRecords,
      nextActiveId: activeId,
      navigateTo: null,
      removedExisted: true,
    }
  }

  if (urlSessionId && nextRecords.some((record) => record.id === urlSessionId)) {
    return {
      nextRecords,
      nextActiveId: urlSessionId,
      navigateTo: null,
      removedExisted: true,
    }
  }

  if (nextLive.length > 0) {
    const next = nextLive[0].id
    return {
      nextRecords,
      nextActiveId: next,
      navigateTo: `/project/${projectId}/terminal/${next}`,
      removedExisted: true,
    }
  }

  return {
    nextRecords,
    nextActiveId: '',
    navigateTo: `/project/${projectId}/terminal`,
    removedExisted: true,
  }
}
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `pnpm test -- src/renderer/pages/__tests__/terminal-page-state.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/pages/terminal-page-state.ts src/renderer/pages/__tests__/terminal-page-state.test.ts
git commit -m "test: cover terminal page session event state transitions"
```

### Task 2: Make TerminalPage Session Listeners Stable

**Files:**
- Modify: `src/renderer/pages/terminal-page.tsx`
- Test: `src/renderer/pages/__tests__/terminal-page-state.test.ts`

- [ ] **Step 1: Add latest-state refs and keep them synchronized**

In `src/renderer/pages/terminal-page.tsx`, add refs near state:

```ts
const recordsRef = useRef<SessionRecord[]>([])
const activeIdRef = useRef('')

useEffect(() => {
  recordsRef.current = records
}, [records])

useEffect(() => {
  activeIdRef.current = activeId
}, [activeId])
```

These refs let IPC callbacks read current state without putting `records` or `activeId` in the listener effect dependency array.

- [ ] **Step 2: Refactor `session.onRemoved` to use the pure helper**

Inside the session-listener effect:

```ts
const unsubscribeRemoved = window.electronAPI.session.onRemoved((sessionId) => {
  const outcome = deriveRemovalOutcome({
    records: recordsRef.current,
    activeId: activeIdRef.current,
    removedSessionId: sessionId,
    urlSessionId,
    projectId,
  })

  if (!outcome.removedExisted) {
    return
  }

  recordsRef.current = outcome.nextRecords
  activeIdRef.current = outcome.nextActiveId

  setRecords(outcome.nextRecords)
  setActiveId(outcome.nextActiveId)

  destroyTerminalView(sessionId)

  if (outcome.navigateTo) {
    navigate(outcome.navigateTo, { replace: true })
  }
})
```

Rules:
- Do not compute next state through leaked outer locals.
- Do not put `navigate` or `destroyTerminalView` inside `setState` updaters.
- Keep `destroyTerminalView` idempotent by only calling it when `removedExisted` is true.

- [ ] **Step 3: Refactor `session.onUpdated` to use the pure helper too**

Update the `session.onUpdated` callback so it follows the same “derive first, then write” pattern:

```ts
const outcome = deriveUpdateOutcome({
  records: recordsRef.current,
  activeId: activeIdRef.current,
  record,
  urlSessionId,
  projectId,
})

recordsRef.current = outcome.nextRecords
activeIdRef.current = outcome.nextActiveId

setRecords(outcome.nextRecords)
setActiveId(outcome.nextActiveId)

if (outcome.navigateTo) {
  navigate(outcome.navigateTo, { replace: true })
}
```

Keep the current `projectId` guard and current navigation behavior. Do not write refs from inside React state updater functions.

- [ ] **Step 4: Narrow the listener effect dependencies**

Change the effect dependency list from:

```ts
[projectId, urlSessionId, navigate, records, activeId]
```

to:

```ts
[projectId, urlSessionId, navigate]
```

This ensures:
- one subscription lifetime per project scope
- no unsubscribe / resubscribe churn on every state update
- no event-loss window between back-to-back session events

Add an inline comment in the effect noting that `urlSessionId` stays in the dependency array deliberately so callbacks observe the latest route selection. That still causes a brief resubscribe during user-driven tab navigation, but that churn is acceptable because it is route-driven and far less frequent than state-driven resubscribe churn.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm test -- src/renderer/pages/__tests__/terminal-page-state.test.ts
pnpm test -- src/preload/__tests__/index.test.ts src/renderer/stores/__tests__/session-records.test.ts src/renderer/stores/__tests__/terminal-view-store.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/pages/terminal-page.tsx src/renderer/pages/terminal-page-state.ts src/renderer/pages/__tests__/terminal-page-state.test.ts
git commit -m "fix: stabilize terminal page session subscriptions"
```

### Task 3: Verify End-to-End Safety Nets Still Hold

**Files:**
- Modify: none unless verification exposes a regression

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`

Expected: PASS across existing Vitest suites.

- [ ] **Step 2: Run the renderer build**

Run: `pnpm build`

Expected: PASS for main, preload, and renderer bundles.

- [ ] **Step 3: Manual smoke test in Electron**

Check these flows:

1. Open project A terminal, switch tabs within A.
2. Switch to project B, then back to A.
3. Remove a non-active historical session and confirm it disappears immediately.
4. Remove the active session and confirm selection/navigate falls back correctly.
5. Watch DevTools console and confirm no duplicate `session:removed` handling or React warnings.

- [ ] **Step 4: Commit verification-only follow-ups if needed**

```bash
git add <files>
git commit -m "fix: address terminal page event regression"
```

## Notes

- This plan intentionally does **not** migrate `TerminalPage` to `useReducer`.
- This plan intentionally does **not** move side effects into React state updater functions.
- If this area regresses again after the stable-listener refactor, the next escalation should be a `useReducer` or dedicated page-state hook, not more ad-hoc event logic inside `TerminalPage`.
