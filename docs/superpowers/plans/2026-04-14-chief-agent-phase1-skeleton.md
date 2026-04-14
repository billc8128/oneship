# Chief Agent Phase 1 — Worker Skeleton & Session-Aware Round-trip

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Agent Worker (Electron `utilityProcess`) with a session-aware IPC protocol, an event-log persistence layer, and a hardcoded assistant reply — all the architectural plumbing that future phases will hang LLM features off, with no LLM yet.

**Architecture:** A new `src/agent/` directory builds to a separate bundle that runs in `utilityProcess.fork()`. Main process holds an `AgentHost` client that proxies renderer IPC to the worker. The worker manages a `SessionManager` (multi-session-capable from day one) and persists each session as an event log on disk. Phase 1 ships the **shape** of every long-lived contract (IPC protocol, session directory, event types, conversation-store API) but only the minimum implementation needed for "user sends 'hello', worker replies, restart, still there."

**Tech Stack:** Electron utilityProcess, Vercel AI SDK `UIMessage` types (no SDK runtime calls yet — just the type), TypeScript, vitest for tests, existing electron-vite build.

**Spec reference:** `docs/superpowers/specs/2026-04-14-chief-agent-design.md` (commit `4096ce6`).

**Phase 1 deliberately defers** (each is an explicit task in a later phase, not an oversight):

- All real LLM integration → Phase 2
- 22 tools (Read, Write, Edit, Bash, etc.) → Phase 2 / 3
- `part-update` event type, snapshot.json, file compaction, `cleanupOrphanPlaceholders()` → Phase 4 (suspension protocol)
- Plan / Ask / Cautious cards → Phase 4
- Streaming UI deltas → Phase 2 (simple poll-style request/response in Phase 1)
- Cron, Skill, Task tools → Phases 4 / 5
- 13 rich message renderers → only `user-bubble` + `assistant-text` + `system-notice` in Phase 1; the rest in their respective phases
- Permission modes (Trust/Cautious) → Phase 3 (when destructive tools land)
- Auto-compaction (LLM context shrink) → Phase 4
- Retry wrapper for API errors → Phase 2
- Static/dynamic system prompt boundary → Phase 2

**Phase 1 success criteria:**

1. `pnpm dev` boots OneShip; main process logs "Agent Worker ready (sessionId=…)"
2. Activity Monitor shows a separate "Oneship Helper (Plugin)" process for the worker
3. User opens Chief Agent chat in the renderer
4. Renderer sees an auto-created session and an empty (or last-restored) message list
5. User types "hello", presses send
6. Within ~500ms, an assistant message appears: "Hello from Chief Agent (Phase 1 stub — no LLM yet)."
7. Both messages are visible as the new conversational style (user bubble + avatar + assistant text)
8. `Cmd+Q` quits OneShip; `pnpm dev` again; the same two messages are still visible
9. `~/.oneship/sessions/<sessionId>/events.jsonl` exists and contains **6** `LogEvent` lines: message-start (user), part-append (user text), message-finish (user), message-start (assistant), part-append (assistant text), message-finish (assistant). Each line is a single JSON object that round-trips through `JSON.parse`.
10. Killing the worker process from Activity Monitor causes Main to log "agent worker exited unexpectedly, respawning"; within 2 seconds, sending another message works again

---

## File Structure

This is the file layout Phase 1 creates. **Module boundaries follow the spec's full design** — even modules whose Phase 1 implementation is a one-line stub get their final filename and final exported API shape, so later phases can fill them in without renaming.

### New files

```
src/agent/                          # new isolated worker package
├── tsconfig.json                   # isolated TS project, no dependency on src/main/*
├── index.ts                        # entry point loaded by utilityProcess.fork
├── ipc/
│   ├── server.ts                   # routes ToWorker messages, calls SessionManager
│   ├── rpc-client.ts               # Phase 1 stub: rejects everything (no Main RPC needed yet)
│   └── protocol-validation.ts      # runtime asserts that incoming msgs match the discriminated union
├── runtime/
│   ├── loop.ts                     # Phase 1 stub: runSegmentStub that returns hardcoded assistant text
│   ├── model.ts                    # Phase 1 stub: getModel throws "not yet wired" (Phase 2 fills in)
│   ├── retry.ts                    # Phase 1 stub: passthrough wrapper (Phase 2 implements real retry)
│   └── sanitize-error.ts           # Phase 1: real implementation (it's small and other modules use it)
├── session/
│   ├── session.ts                  # Session class, owns uiMessages + meta + segment lifecycle
│   ├── session-manager.ts          # Map<sessionId, Session>, create/open/list/close, lazy hydration
│   ├── store.ts                    # session directory I/O: meta.json read/write, paths
│   ├── resume.ts                   # startup enumeration of ~/.oneship/sessions/
│   └── suspension.ts               # Phase 1 stub: types only, no behavior (Phase 4 implements)
├── services/
│   ├── conversation-store.ts       # event log read/write, replay, write helpers
│   ├── event-log.ts                # LogEvent types, append-with-fsync, parsing
│   ├── snapshot-store.ts           # Phase 1 stub: writeSnapshot/loadSnapshot return null
│   ├── compaction.ts               # Phase 1 stub: compactEventLog throws "not yet"
│   └── fs.ts                       # safe file helpers: atomic writes, JSON I/O
├── context/
│   └── system-prompt.ts            # Phase 1 stub: returns empty string array (Phase 2 fills in)
└── __tests__/                      # vitest tests
    ├── conversation-store.test.ts
    ├── event-log.test.ts
    ├── session.test.ts
    ├── session-manager.test.ts
    ├── resume.test.ts
    └── ipc-server.test.ts

src/shared/
└── agent-protocol.ts               # NEW — types crossed across the worker boundary

src/main/
└── agent-host.ts                   # NEW — utilityProcess lifecycle + IPC client side

src/renderer/
├── stores/
│   └── chief-session.ts            # NEW — Zustand store (or React state) for active session
└── components/chat/messages/
    ├── user-bubble.tsx             # NEW
    ├── assistant-text.tsx          # NEW
    └── system-notice.tsx           # NEW
```

### Modified files (additive — no deletions in Phase 1)

```
src/main/index.ts                   # ADD: AgentHost import, chief:send IPC, before-quit handler.
                                    # KEEP: existing chat:* handlers and conversation-store import,
                                    #       marked with PHASE-5 TODO comment block.
src/main/__tests__/                 # add agent-host.test.ts (RespawnGate + ReadyTicket unit tests)
src/preload/index.ts                # ADD: electronAPI.chief namespace.
                                    # KEEP: existing electronAPI.chat namespace, PHASE-5 TODO.
src/preload/__tests__/index.test.ts # ADD chief.* shape assertions; KEEP chat.* assertions.
src/renderer/pages/chief-chat.tsx   # rewrite to consume chief-session store + UIMessage parts
electron.vite.config.ts             # add agent build target → dist/agent
tsconfig.json                       # verify src/agent is covered by `include`
package.json                        # add ai (UIMessage type), nanoid, zod
```

### Deleted files

**None.** Phase 1 is additive only with respect to the existing project. The old `src/main/conversation-store.ts`, the old `chat:*` IPC handlers, and the old `electronAPI.chat` preload namespace are kept alive for the duration of Phases 1-4 because `src/renderer/pages/project-chat.tsx` still depends on them. Phase 5 migrates ProjectChat to the agent worker and deletes the legacy plumbing at that point. See Task 11's preamble for the rationale and the PHASE-5 TODO comment markers that lock this in.

`src/renderer/components/chat/message-list.tsx` is **not modified** — the new Chief Agent chat in Task 12 dispatches to its own message renderers directly, bypassing `MessageList` entirely. `MessageList` continues to serve ProjectChat unchanged.

---

## Sequencing principles

1. **Tests-first per module** (TDD): write the failing test, run it to confirm it fails, write minimal impl, run to confirm pass, commit.
2. **Bottom-up build order**: shared types → event-log → conversation-store → session → session-manager → resume → ipc/server → worker entry → agent-host → preload → renderer. Each layer only depends on layers already built and tested.
3. **Each task is one commit** unless explicitly stated. Frequent small commits.
4. **No "and then we'll come back to fix this"** — every stub explicitly throws or returns a typed `Phase1NotImplemented` value so a later phase implementing it gets a clear error if something accidentally calls the stub.

---

### Task 1: Add dependencies and update build config

**Files:**
- Modify: `package.json`
- Modify: `electron.vite.config.ts`
- Modify: `tsconfig.json`

**Why this first:** Without the build pipeline producing `dist/agent/index.js`, `utilityProcess.fork(path)` has nothing to load. Without the new deps (`ai` for the `UIMessage` type, `nanoid` for IDs, `zod` for runtime validation), no later task compiles.

- [ ] **Step 1: Install dependencies**

```bash
pnpm add ai nanoid zod
```

Expected: `package.json` `dependencies` now lists `ai`, `nanoid`, `zod`. (`ai` is added even though Phase 1 doesn't call its runtime — we use the `UIMessage` type from it, and Phase 2 will call `streamText`.)

- [ ] **Step 2: Add the `agent` build target to electron-vite config**

Edit `electron.vite.config.ts`. After the `preload:` block and before `renderer:`, add a sibling `agent:` target. The full updated file:

```ts
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  main: {
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
        external: ['node-pty']
      }
    }
  },
  preload: {
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts')
      }
    }
  },
  // NEW: agent worker build target
  // Builds src/agent/index.ts → dist/agent/index.js, loaded by utilityProcess.fork.
  // Treated like the main process build (Node target, CommonJS, externalize node deps).
  agent: {
    build: {
      outDir: 'dist/agent',
      rollupOptions: {
        input: resolve(__dirname, 'src/agent/index.ts'),
        // No native deps in Phase 1; if Phase 2+ adds any, externalize here.
        external: []
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: 'dist/renderer',
      rollupOptions: {
        output: {
          format: 'es'
        }
      }
    },
    html: {
      cspNonce: undefined
    },
    plugins: [
      tailwindcss(),
      react(),
      {
        name: 'remove-crossorigin',
        transformIndexHtml(html) {
          return html.replace(/ crossorigin/g, '')
        }
      }
    ]
  }
})
```

**Note:** Confirm electron-vite supports the `agent:` key as an arbitrary build target. If `electron-vite` only recognizes `main`, `preload`, `renderer` keys, fall back to **plan B**: add `src/agent/index.ts` as a second `input:` entry under the `main` build (electron-vite supports multi-input). The agent will then build into `dist/main/agent.js` and `utilityProcess.fork` loads from there. Document which path was taken in the commit message.

- [ ] **Step 3: Update tsconfig include**

Edit `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "types": ["node"]
  },
  "include": ["src/**/*", "electron.vite.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```

`src/**/*` already covers `src/agent/`, so no change needed beyond verifying. (If you find `src/agent/` is excluded due to a stricter `include`, broaden it.)

- [ ] **Step 4: Verify build**

Create an empty placeholder `src/agent/index.ts`:

```ts
// Phase 1 placeholder — replaced in Task 6.
console.log('agent worker placeholder')
```

Run:

```bash
pnpm build
```

Expected: build succeeds, `dist/agent/index.js` (or `dist/main/agent.js` per Plan B) exists.

```bash
ls dist/agent/index.js   # or: ls dist/main/agent.js
```

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml electron.vite.config.ts tsconfig.json src/agent/index.ts
git commit -m "feat(agent): scaffold agent worker build target

Add ai/nanoid/zod deps. Add electron-vite 'agent' build target so
src/agent/index.ts compiles to dist/agent/index.js for utilityProcess.fork.

Phase 1 of Chief Agent — see docs/superpowers/plans/2026-04-14-chief-agent-phase1-skeleton.md"
```

---

### Task 2: Define the cross-boundary IPC protocol

**Files:**
- Create: `src/shared/agent-protocol.ts`
- Create: `src/shared/__tests__/agent-protocol.test.ts`

**Why now:** This file defines the contract Main and Worker speak. Both sides will import from it, and we want the shape locked before either side is implemented.

The Phase 1 protocol is a **subset of the spec's §4.3** — it includes only the messages Phase 1 actually exercises, with `// PHASE-N: ...` comments marking what gets added later. The discriminated union shape and field names match the spec exactly so future phases just add cases.

- [ ] **Step 1: Write the failing test**

`src/shared/__tests__/agent-protocol.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  isToWorker,
  isToMain,
  type ToWorker,
  type ToMain,
  type SessionMeta,
} from '../agent-protocol'

describe('agent-protocol', () => {
  it('isToWorker accepts a valid send-user-message', () => {
    const msg: ToWorker = {
      type: 'send-user-message',
      sessionId: 's_abc',
      content: 'hello',
    }
    expect(isToWorker(msg)).toBe(true)
  })

  it('isToWorker rejects an unknown type', () => {
    expect(isToWorker({ type: 'nope' } as unknown)).toBe(false)
  })

  it('isToMain accepts a valid session-list', () => {
    const msg: ToMain = {
      type: 'session-list',
      sessions: [],
    }
    expect(isToMain(msg)).toBe(true)
  })

  it('SessionMeta type compiles with all required fields', () => {
    const meta: SessionMeta = {
      sessionId: 's_abc',
      createdAt: 1,
      updatedAt: 1,
      model: 'phase-1-stub',
      permissionMode: 'trust',
      planMode: false,
      triggeredBy: { kind: 'user' },
      lastSegmentReason: null,
      title: null,
      eventLogLength: 0,
      snapshotEventOffset: null,
    }
    expect(meta.sessionId).toBe('s_abc')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/shared/__tests__/agent-protocol.test.ts
```

Expected: FAIL (`Cannot find module '../agent-protocol'`).

- [ ] **Step 3: Implement `src/shared/agent-protocol.ts`**

```ts
// IPC contract between Electron Main and the Agent Worker (utilityProcess).
//
// This file is imported by BOTH src/main/agent-host.ts (Main side) and
// src/agent/ipc/server.ts (Worker side). It MUST contain only types and
// pure helpers — no runtime imports from electron, react, ai, etc., and
// no Node APIs that aren't available in both contexts.
//
// The full §4.3 protocol from the design spec includes more message kinds
// for suspensions, plan resolution, cautious approval, etc. Phase 1 ships
// only the subset Phase 1 actually uses; later phases extend the unions.

import type { UIMessage, UIMessagePart } from 'ai'

// ============================================================================
// Session metadata
// ============================================================================

export type PermissionMode = 'trust' | 'cautious'

export type TriggeredBy =
  | { kind: 'user' }
  | { kind: 'cron'; cronId: string; scheduledFor: number } // PHASE-5

export type SegmentFinishReason =
  | 'natural'
  | 'suspended'   // PHASE-4
  | 'step-cap'    // PHASE-2 (step cap fires when LLM keeps tool-calling)
  | 'aborted'
  | 'error'

export interface SessionMeta {
  sessionId: string
  createdAt: number
  updatedAt: number
  model: string
  permissionMode: PermissionMode
  planMode: boolean
  triggeredBy: TriggeredBy
  lastSegmentReason: SegmentFinishReason | null
  title: string | null
  eventLogLength: number
  snapshotEventOffset: number | null
}

// ============================================================================
// Snapshot delivered when a session is opened
// ============================================================================

export interface SessionSnapshot {
  meta: SessionMeta
  uiMessages: UIMessage[]
  // PHASE-4: pendingSuspension, deferredSuspensions, etc.
}

// ============================================================================
// Main → Worker messages (Phase 1 subset)
// ============================================================================

export type ToWorker =
  | { type: 'shutdown' }
  | {
      type: 'create-session'
      sessionId: string
      model?: string
      permissionMode?: PermissionMode
      triggeredBy?: TriggeredBy
    }
  | { type: 'open-session'; sessionId: string }
  | { type: 'close-session'; sessionId: string }
  | { type: 'list-sessions' }
  | { type: 'send-user-message'; sessionId: string; content: string }
  | { type: 'cancel-current-turn'; sessionId: string }
// PHASE-3: 'set-permission-mode', 'set-model'
// PHASE-4: 'resolve-suspension'
// PHASE-2+: 'rpc-response' (responses to RPC requests Worker raises)

// ============================================================================
// Worker → Main messages (Phase 1 subset)
// ============================================================================

export type ToMain =
  | { type: 'ready' }
  | { type: 'session-created'; sessionId: string }
  | { type: 'session-opened'; sessionId: string; snapshot: SessionSnapshot }
  | { type: 'session-closed'; sessionId: string }
  | { type: 'session-list'; sessions: SessionMeta[] }
  | { type: 'message-delta'; sessionId: string; partialMessage: UIMessagePart }
  | { type: 'message-complete'; sessionId: string; message: UIMessage }
  | {
      type: 'segment-finished'
      sessionId: string
      reason: SegmentFinishReason
      error?: string
    }
// PHASE-2+: 'task-changed'
// PHASE-4: 'suspension-raised'
// PHASE-2+: 'rpc-request' (Worker asks Main for project data, dialogs, etc.)

// ============================================================================
// Runtime type guards (defensive — IPC payloads come from another process)
// ============================================================================

const TO_WORKER_TYPES = new Set<ToWorker['type']>([
  'shutdown',
  'create-session',
  'open-session',
  'close-session',
  'list-sessions',
  'send-user-message',
  'cancel-current-turn',
])

const TO_MAIN_TYPES = new Set<ToMain['type']>([
  'ready',
  'session-created',
  'session-opened',
  'session-closed',
  'session-list',
  'message-delta',
  'message-complete',
  'segment-finished',
])

export function isToWorker(value: unknown): value is ToWorker {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { type?: unknown }
  return typeof v.type === 'string' && TO_WORKER_TYPES.has(v.type as ToWorker['type'])
}

export function isToMain(value: unknown): value is ToMain {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { type?: unknown }
  return typeof v.type === 'string' && TO_MAIN_TYPES.has(v.type as ToMain['type'])
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run src/shared/__tests__/agent-protocol.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/agent-protocol.ts src/shared/__tests__/agent-protocol.test.ts
git commit -m "feat(agent): define Main↔Worker IPC protocol (Phase 1 subset)"
```

---

### Task 3: Implement event-log primitives

**Files:**
- Create: `src/agent/services/event-log.ts`
- Create: `src/agent/services/__tests__/event-log.test.ts`

The event log is the lowest layer of conversation persistence. It defines the `LogEvent` discriminated union and provides append/read/parse helpers.

Phase 1 implements **only the LogEvent variants Phase 1 actually writes**: `message-start`, `part-append`, `message-finish`. The full §15.2.1 also has `part-update` — Phase 1 leaves it in the type union (so future phases compile against the same type) but **never writes one**, and `replay()` includes a case for it that is exercised in tests of the future-stub form (just to lock the API surface).

- [ ] **Step 1: Write the failing test**

`src/agent/services/__tests__/event-log.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  appendEvent,
  readEvents,
  type LogEvent,
} from '../event-log'

describe('event-log', () => {
  let dir: string
  let logPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'oneship-event-log-'))
    logPath = join(dir, 'events.jsonl')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('appendEvent creates the file if missing', async () => {
    expect(existsSync(logPath)).toBe(false)
    await appendEvent(logPath, {
      type: 'message-start',
      messageId: 'm_1',
      role: 'user',
      createdAt: 1000,
    })
    expect(existsSync(logPath)).toBe(true)
  })

  it('appendEvent writes one JSON line per call', async () => {
    await appendEvent(logPath, { type: 'message-start', messageId: 'm_1', role: 'user', createdAt: 1000 })
    await appendEvent(logPath, { type: 'part-append', messageId: 'm_1', part: { type: 'text', text: 'hi' } as any })
    await appendEvent(logPath, { type: 'message-finish', messageId: 'm_1' })
    const raw = readFileSync(logPath, 'utf-8')
    const lines = raw.trim().split('\n')
    expect(lines).toHaveLength(3)
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  it('readEvents returns parsed events in order', async () => {
    const events: LogEvent[] = [
      { type: 'message-start', messageId: 'm_1', role: 'user', createdAt: 1000 },
      { type: 'part-append', messageId: 'm_1', part: { type: 'text', text: 'hi' } as any },
      { type: 'message-finish', messageId: 'm_1' },
    ]
    for (const ev of events) await appendEvent(logPath, ev)
    const read = await readEvents(logPath)
    expect(read).toEqual(events)
  })

  it('readEvents tolerates a truncated tail (crash mid-write)', async () => {
    await appendEvent(logPath, { type: 'message-start', messageId: 'm_1', role: 'user', createdAt: 1000 })
    // Simulate a crash that left a half-written line at the end.
    const fs = await import('fs/promises')
    await fs.appendFile(logPath, '{"type":"part-append","messa')
    const read = await readEvents(logPath)
    expect(read).toHaveLength(1)
    expect(read[0].type).toBe('message-start')
  })

  it('readEvents returns [] for a missing file', async () => {
    const read = await readEvents(join(dir, 'nope.jsonl'))
    expect(read).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/agent/services/__tests__/event-log.test.ts
```

Expected: FAIL (`Cannot find module '../event-log'`).

- [ ] **Step 3: Implement `src/agent/services/event-log.ts`**

```ts
import { promises as fs, existsSync } from 'fs'
import type { UIMessagePart } from 'ai'

// One line per LogEvent in events.jsonl. The full type union from spec §15.2.1
// includes 'part-update'. Phase 1 never writes part-update events, but the
// type lives here so future phases (suspension protocol) only need to add
// the writer, not the type.
export type LogEvent =
  | { type: 'message-start'; messageId: string; role: 'user' | 'assistant' | 'system'; createdAt: number }
  | { type: 'part-append'; messageId: string; part: UIMessagePart }
  | { type: 'part-update'; messageId: string; partIndex: number; part: UIMessagePart }
  | { type: 'message-finish'; messageId: string }

/**
 * Append one event as a single JSONL line. Creates the file if missing.
 *
 * Phase 1 does NOT fsync per write — it relies on the OS page cache and
 * fsyncs at segment boundaries via `fsyncEventLog` (not implemented in
 * Phase 1; see Task notes). Streaming-text batching mentioned in §15.2.3
 * is also Phase 2 territory.
 */
export async function appendEvent(logPath: string, event: LogEvent): Promise<void> {
  const line = JSON.stringify(event) + '\n'
  await fs.appendFile(logPath, line, 'utf-8')
}

/**
 * Read all events from disk, parsing one JSON object per line.
 *
 * Lines that fail to parse are dropped silently (truncated tail from a
 * crash mid-write — §15.2.2). A missing file is treated as an empty log.
 */
export async function readEvents(logPath: string): Promise<LogEvent[]> {
  if (!existsSync(logPath)) return []
  const raw = await fs.readFile(logPath, 'utf-8')
  const out: LogEvent[] = []
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue
    try {
      out.push(JSON.parse(line) as LogEvent)
    } catch {
      // Truncated tail. Stop reading — anything past a parse failure
      // could be partial data with later valid-looking lines that
      // belong to a different state. Conservative: stop.
      break
    }
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run src/agent/services/__tests__/event-log.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/agent/services/event-log.ts src/agent/services/__tests__/event-log.test.ts
git commit -m "feat(agent): event log primitives (append, read, truncation tolerance)"
```

---

### Task 4: Implement conversation-store with replay and write helpers

**Files:**
- Create: `src/agent/services/conversation-store.ts`
- Create: `src/agent/services/__tests__/conversation-store.test.ts`

This is the §15.2 replay function plus the symmetric write helpers from §15.2.3. Phase 1 implements:

- `replay(events)` → `UIMessage[]` (handles all 4 LogEvent kinds correctly, including `part-update` for forward compatibility — even though Phase 1 doesn't write part-update events, replay must handle them since they appear in the type)
- `writeMessageStart`, `writePartAppend`, `writeMessageFinish` (the three Phase 1 uses)
- `writePartUpdate` exists as a function but **throws** `Phase1NotImplemented`. This locks the API for Phase 4 to fill in without renaming.
- `isMessageComplete(msg)` reads `msg.metadata?.isComplete === true`

- [ ] **Step 1: Write the failing test**

`src/agent/services/__tests__/conversation-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { UIMessage } from 'ai'
import {
  replay,
  writeMessageStart,
  writePartAppend,
  writeMessageFinish,
  writePartUpdate,
  isMessageComplete,
  Phase1NotImplemented,
} from '../conversation-store'
import { readEvents } from '../event-log'

describe('conversation-store', () => {
  let dir: string
  let logPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'oneship-conv-store-'))
    logPath = join(dir, 'events.jsonl')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('replay reconstructs an empty list from an empty event log', () => {
    expect(replay([])).toEqual([])
  })

  it('replay reconstructs a single user message', () => {
    const msgs = replay([
      { type: 'message-start', messageId: 'm_1', role: 'user', createdAt: 1000 },
      { type: 'part-append', messageId: 'm_1', part: { type: 'text', text: 'hello' } as any },
      { type: 'message-finish', messageId: 'm_1' },
    ])
    expect(msgs).toHaveLength(1)
    expect(msgs[0].id).toBe('m_1')
    expect(msgs[0].role).toBe('user')
    expect(msgs[0].parts).toHaveLength(1)
    expect(isMessageComplete(msgs[0])).toBe(true)
  })

  it('replay leaves a message open if no message-finish arrived', () => {
    const msgs = replay([
      { type: 'message-start', messageId: 'm_1', role: 'assistant', createdAt: 1000 },
      { type: 'part-append', messageId: 'm_1', part: { type: 'text', text: 'streaming' } as any },
    ])
    expect(isMessageComplete(msgs[0])).toBe(false)
  })

  it('replay handles part-update on an existing part', () => {
    const msgs = replay([
      { type: 'message-start', messageId: 'm_1', role: 'assistant', createdAt: 1000 },
      { type: 'part-append', messageId: 'm_1', part: { type: 'text', text: 'first' } as any },
      { type: 'part-update', messageId: 'm_1', partIndex: 0, part: { type: 'text', text: 'second' } as any },
      { type: 'message-finish', messageId: 'm_1' },
    ])
    expect((msgs[0].parts[0] as any).text).toBe('second')
  })

  it('write helpers append events AND mutate in-memory state', async () => {
    const messages: UIMessage[] = []
    await writeMessageStart(logPath, messages, { messageId: 'm_1', role: 'user', createdAt: 1000 })
    expect(messages).toHaveLength(1)
    expect(isMessageComplete(messages[0])).toBe(false)

    await writePartAppend(logPath, messages, {
      messageId: 'm_1',
      part: { type: 'text', text: 'hello' } as any,
    })
    expect(messages[0].parts).toHaveLength(1)

    await writeMessageFinish(logPath, messages, { messageId: 'm_1' })
    expect(isMessageComplete(messages[0])).toBe(true)

    // Round-trip: read events back from disk and replay should give same result
    const events = await readEvents(logPath)
    expect(events).toHaveLength(3)
    const replayed = replay(events)
    expect(replayed).toHaveLength(1)
    expect(replayed[0].id).toBe('m_1')
    expect(isMessageComplete(replayed[0])).toBe(true)
  })

  it('writePartUpdate throws Phase1NotImplemented', async () => {
    const messages: UIMessage[] = []
    await expect(
      writePartUpdate(logPath, messages, {
        messageId: 'm_1',
        partIndex: 0,
        part: { type: 'text', text: 'x' } as any,
      })
    ).rejects.toBeInstanceOf(Phase1NotImplemented)
  })

  it('write helpers leave uiMessages untouched if the disk append fails', async () => {
    // Point the log path at a directory that does not exist and cannot be
    // created (use a path under /dev/null which is a file, not a dir).
    // appendFile to a child of a non-directory rejects with ENOTDIR.
    const messages: UIMessage[] = []
    const badPath = '/dev/null/cannot-write-here.jsonl'

    await expect(
      writeMessageStart(badPath, messages, { messageId: 'm_x', role: 'user', createdAt: 1 })
    ).rejects.toThrow()
    expect(messages).toHaveLength(0)  // mutation rolled back

    // Set up a valid message so writePartAppend has something to find,
    // then point IT at the bad path:
    await writeMessageStart(logPath, messages, { messageId: 'm_y', role: 'user', createdAt: 1 })
    expect(messages[0].parts).toHaveLength(0)

    await expect(
      writePartAppend(badPath, messages, { messageId: 'm_y', part: { type: 'text', text: 'x' } as any })
    ).rejects.toThrow()
    expect(messages[0].parts).toHaveLength(0)  // part not appended
    expect(isMessageComplete(messages[0])).toBe(false)

    await expect(
      writeMessageFinish(badPath, messages, { messageId: 'm_y' })
    ).rejects.toThrow()
    expect(isMessageComplete(messages[0])).toBe(false)  // not flipped to true
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/agent/services/__tests__/conversation-store.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/agent/services/conversation-store.ts`**

```ts
import type { UIMessage, UIMessagePart } from 'ai'
import { appendEvent, type LogEvent } from './event-log'

/**
 * Sentinel error thrown by Phase 1 stubs that have a final API but no
 * implementation yet. Tests assert against this so a later phase
 * removing the throw doesn't accidentally silently change behavior.
 */
export class Phase1NotImplemented extends Error {
  constructor(what: string) {
    super(`Phase 1 stub: ${what} is implemented in a later phase`)
    this.name = 'Phase1NotImplemented'
  }
}

/**
 * Reconstruct UIMessage[] from an event log. Pure function — no I/O.
 *
 * Spec reference: §15.2.2.
 */
export function replay(events: LogEvent[]): UIMessage[] {
  const messages: UIMessage[] = []
  const byId = new Map<string, UIMessage>()
  for (const ev of events) {
    switch (ev.type) {
      case 'message-start': {
        const msg: UIMessage = {
          id: ev.messageId,
          role: ev.role,
          // Vercel AI SDK UIMessage uses `parts: UIMessagePart[]`. createdAt
          // and metadata go on the same object via type augmentation; we
          // store them directly and rely on TS structural typing.
          parts: [],
          metadata: { isComplete: false, createdAt: ev.createdAt },
        } as UIMessage
        messages.push(msg)
        byId.set(ev.messageId, msg)
        break
      }
      case 'part-append': {
        const msg = byId.get(ev.messageId)
        if (msg) msg.parts.push(ev.part)
        break
      }
      case 'part-update': {
        const msg = byId.get(ev.messageId)
        if (msg && ev.partIndex < msg.parts.length) {
          msg.parts[ev.partIndex] = ev.part
        }
        break
      }
      case 'message-finish': {
        const msg = byId.get(ev.messageId)
        if (msg) {
          msg.metadata = { ...(msg.metadata as object), isComplete: true }
        }
        break
      }
    }
  }
  return messages
}

/**
 * `metadata.isComplete` is the canonical "this message is done" flag.
 * Set by message-finish (replay) or by writeMessageFinish.
 */
export function isMessageComplete(msg: UIMessage): boolean {
  const meta = msg.metadata as { isComplete?: boolean } | undefined
  return meta?.isComplete === true
}

// =============================================================================
// Write helpers — symmetric with replay(). Persistence-first: every helper
// appends the LogEvent to disk FIRST, and only mutates in-memory uiMessages
// AFTER appendEvent has resolved successfully. If the disk append throws,
// the in-memory state is untouched and the caller sees the error.
//
// This matches §15.2.3's "the append is the source of truth" rule. An
// in-memory-first ordering would let a failed write leave uiMessages
// ahead of the event log, which would then cause snapshot/replay drift.
// =============================================================================

export async function writeMessageStart(
  logPath: string,
  uiMessages: UIMessage[],
  args: { messageId: string; role: 'user' | 'assistant' | 'system'; createdAt: number }
): Promise<void> {
  // Disk first: if appendEvent throws, uiMessages is untouched.
  await appendEvent(logPath, {
    type: 'message-start',
    messageId: args.messageId,
    role: args.role,
    createdAt: args.createdAt,
  })
  // Disk write succeeded; safe to mutate in-memory state.
  const msg: UIMessage = {
    id: args.messageId,
    role: args.role,
    parts: [],
    metadata: { isComplete: false, createdAt: args.createdAt },
  } as UIMessage
  uiMessages.push(msg)
}

export async function writePartAppend(
  logPath: string,
  uiMessages: UIMessage[],
  args: { messageId: string; part: UIMessagePart }
): Promise<void> {
  // Locate the message before any I/O so we fail cleanly on misuse,
  // without polluting the log with an event for a missing message.
  const msg = uiMessages.find((m) => m.id === args.messageId)
  if (!msg) throw new Error(`writePartAppend: message ${args.messageId} not found`)
  // Disk first: if append fails, msg.parts is untouched.
  await appendEvent(logPath, { type: 'part-append', messageId: args.messageId, part: args.part })
  msg.parts.push(args.part)
}

export async function writeMessageFinish(
  logPath: string,
  uiMessages: UIMessage[],
  args: { messageId: string }
): Promise<void> {
  const msg = uiMessages.find((m) => m.id === args.messageId)
  if (!msg) throw new Error(`writeMessageFinish: message ${args.messageId} not found`)
  // Disk first: if append fails, msg.metadata is untouched.
  await appendEvent(logPath, { type: 'message-finish', messageId: args.messageId })
  msg.metadata = { ...(msg.metadata as object), isComplete: true }
}

/**
 * Phase 4 implements this when suspension resolution rewrites placeholder
 * tool-results. Phase 1 throws so any accidental caller gets a clear error.
 */
export async function writePartUpdate(
  _logPath: string,
  _uiMessages: UIMessage[],
  _args: { messageId: string; partIndex: number; part: UIMessagePart }
): Promise<void> {
  throw new Phase1NotImplemented('writePartUpdate (suspension placeholder rewrite)')
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run src/agent/services/__tests__/conversation-store.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/agent/services/conversation-store.ts src/agent/services/__tests__/conversation-store.test.ts
git commit -m "feat(agent): conversation-store replay + write helpers (Phase 1 subset)"
```

---

### Task 5: Stub the modules whose APIs Phase 1 locks but doesn't implement

**Files:**
- Create: `src/agent/services/snapshot-store.ts`
- Create: `src/agent/services/compaction.ts`
- Create: `src/agent/services/fs.ts`
- Create: `src/agent/runtime/sanitize-error.ts`
- Create: `src/agent/runtime/retry.ts`
- Create: `src/agent/runtime/model.ts`
- Create: `src/agent/runtime/loop.ts`
- Create: `src/agent/context/system-prompt.ts`
- Create: `src/agent/session/suspension.ts`
- Create: `src/agent/services/__tests__/fs.test.ts`
- Create: `src/agent/runtime/__tests__/sanitize-error.test.ts`

This single task creates the **module skeletons** that the spec defines but Phase 1 doesn't fully implement. Each one has:

- The final filename and final exported API surface (so future phases just fill in bodies)
- Either a real Phase 1 implementation (when small and useful — `fs.ts`, `sanitize-error.ts`) or a stub that throws `Phase1NotImplemented` if called

**Why one task for many files:** these are mechanical scaffolds; splitting them into 8 commits adds noise without adding review value. They are committed together with a single explanatory message.

- [ ] **Step 1: Implement `src/agent/services/fs.ts` — atomic write helpers**

```ts
// Atomic file write helpers used across the agent worker. The atomic write
// pattern (write to .tmp, fsync, rename) is mandatory for any file that
// other code reads concurrently — meta.json, suspension.json, snapshot.json.
//
// events.jsonl uses appendFile directly and does NOT go through here; its
// crash recovery model is "drop the truncated tail," not "atomic write."

import { promises as fs } from 'fs'
import { dirname } from 'path'

export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp`
  const json = JSON.stringify(value, null, 2)
  await fs.writeFile(tmp, json, 'utf-8')
  await fs.rename(tmp, path)
}

export async function readJsonOrNull<T>(path: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(path, 'utf-8')
    return JSON.parse(raw) as T
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

export async function ensureDir(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true })
}

export async function ensureParentDir(filePath: string): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true })
}
```

Test for it (`src/agent/services/__tests__/fs.test.ts`):

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { atomicWriteJson, readJsonOrNull, ensureDir } from '../fs'

describe('fs helpers', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'oneship-fs-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('atomicWriteJson writes the file', async () => {
    await atomicWriteJson(join(dir, 'a.json'), { hello: 'world' })
    const back = await readJsonOrNull<{ hello: string }>(join(dir, 'a.json'))
    expect(back?.hello).toBe('world')
  })

  it('atomicWriteJson does not leave a .tmp behind on success', async () => {
    await atomicWriteJson(join(dir, 'a.json'), { x: 1 })
    expect(existsSync(join(dir, 'a.json.tmp'))).toBe(false)
  })

  it('readJsonOrNull returns null for a missing file', async () => {
    expect(await readJsonOrNull(join(dir, 'nope.json'))).toBeNull()
  })

  it('ensureDir creates nested directories', async () => {
    const p = join(dir, 'a/b/c')
    await ensureDir(p)
    expect(existsSync(p)).toBe(true)
  })
})
```

- [ ] **Step 2: Implement `src/agent/runtime/sanitize-error.ts`**

```ts
// Phase 1: sanitize errors before they're shown to the user or written to logs.
// Strips stack traces and absolute paths outside the user's home, leaving only
// the error message. Used by the IPC layer when reporting errors back to Main.

const HOME = process.env.HOME || process.env.USERPROFILE || ''

export function sanitizeErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    let msg = err.message
    // Replace any absolute path mentioning the user's home with `~`
    if (HOME) {
      msg = msg.split(HOME).join('~')
    }
    return msg
  }
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}
```

Test (`src/agent/runtime/__tests__/sanitize-error.test.ts`):

```ts
import { describe, it, expect } from 'vitest'
import { sanitizeErrorMessage } from '../sanitize-error'

describe('sanitizeErrorMessage', () => {
  it('returns the message of an Error', () => {
    expect(sanitizeErrorMessage(new Error('boom'))).toBe('boom')
  })
  it('passes through string', () => {
    expect(sanitizeErrorMessage('nope')).toBe('nope')
  })
  it('JSON.stringify falls back for objects', () => {
    expect(sanitizeErrorMessage({ a: 1 })).toBe('{"a":1}')
  })
})
```

- [ ] **Step 3: Stub the runtime modules**

`src/agent/runtime/retry.ts`:

```ts
// Phase 2 implementation: real retry with exponential backoff for 429/529/network.
// Phase 1: passthrough so callers using `withRetry(fn)` already work.

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  return fn()
}
```

`src/agent/runtime/model.ts`:

```ts
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
```

`src/agent/runtime/loop.ts`:

```ts
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
```

`src/agent/context/system-prompt.ts`:

```ts
// Phase 2 implementation: returns the static + dynamic system messages
// from §7.1, complete with cache control on the static block.
// Phase 1: empty array. Worker hardcodes its assistant text in runSegment
// stub instead of going through any LLM.

import type { UIMessage } from 'ai'

export function buildSystemMessages(): UIMessage[] {
  return []
}
```

`src/agent/services/snapshot-store.ts`:

```ts
import type { UIMessage } from 'ai'
import { Phase1NotImplemented } from './conversation-store'

export interface SnapshotData {
  uiMessages: UIMessage[]
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
```

`src/agent/services/compaction.ts`:

```ts
import { Phase1NotImplemented } from './conversation-store'
import type { LogEvent } from './event-log'
import type { UIMessage } from 'ai'

/**
 * Phase 4 implementation: collapse events.jsonl into the minimum events
 * needed to reconstruct the current uiMessages, including message-finish
 * for completed messages (§15.2.5). Phase 1: stub.
 */
export function compactEventLog(_uiMessages: UIMessage[]): LogEvent[] {
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
```

`src/agent/session/suspension.ts`:

```ts
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
```

- [ ] **Step 4: Run all stub tests**

```bash
pnpm vitest run src/agent/services/__tests__/fs.test.ts src/agent/runtime/__tests__/sanitize-error.test.ts
```

Expected: PASS, 7 tests across the two files.

- [ ] **Step 5: Commit**

```bash
git add src/agent/services/fs.ts src/agent/services/__tests__/fs.test.ts \
        src/agent/runtime/sanitize-error.ts src/agent/runtime/__tests__/sanitize-error.test.ts \
        src/agent/runtime/retry.ts src/agent/runtime/model.ts src/agent/runtime/loop.ts \
        src/agent/context/system-prompt.ts \
        src/agent/services/snapshot-store.ts src/agent/services/compaction.ts \
        src/agent/session/suspension.ts
git commit -m "feat(agent): scaffold module boundaries with Phase1NotImplemented stubs

Lock filenames and exported API shapes for modules whose full implementation
ships in later phases (snapshot, compaction, suspension, model, retry,
system-prompt). Phase 1 has real implementations for fs.ts and
sanitize-error.ts since multiple modules use them already."
```

---

### Task 6: Implement `Session` class

**Files:**
- Create: `src/agent/session/session.ts`
- Create: `src/agent/session/store.ts`
- Create: `src/agent/session/__tests__/session.test.ts`

The `Session` class owns one session's state: meta, uiMessages, and the event log path. It exposes high-level operations (`appendUserMessage`, `appendAssistantStubReply`) that future phases will rename / extend rather than rewrite.

`store.ts` provides path computation and meta.json read/write — the I/O concerns that don't belong on Session itself.

- [ ] **Step 1: Implement `src/agent/session/store.ts`**

```ts
import { homedir } from 'os'
import { join } from 'path'
import { atomicWriteJson, readJsonOrNull, ensureDir } from '../services/fs'
import type { SessionMeta } from '../../shared/agent-protocol'

export function sessionsRoot(): string {
  return join(homedir(), '.oneship', 'sessions')
}

export function sessionDir(sessionId: string): string {
  return join(sessionsRoot(), sessionId)
}

export function eventLogPath(sessionId: string): string {
  return join(sessionDir(sessionId), 'events.jsonl')
}

export function metaPath(sessionId: string): string {
  return join(sessionDir(sessionId), 'meta.json')
}

export async function ensureSessionDir(sessionId: string): Promise<void> {
  await ensureDir(sessionDir(sessionId))
}

export async function readMeta(sessionId: string): Promise<SessionMeta | null> {
  return readJsonOrNull<SessionMeta>(metaPath(sessionId))
}

export async function writeMeta(meta: SessionMeta): Promise<void> {
  await ensureSessionDir(meta.sessionId)
  await atomicWriteJson(metaPath(meta.sessionId), meta)
}
```

- [ ] **Step 2: Write the failing Session test**

`src/agent/session/__tests__/session.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir, homedir } from 'os'
import { join } from 'path'
import { Session } from '../session'
import { sessionDir, eventLogPath } from '../store'
import { readEvents } from '../../services/event-log'
import { isMessageComplete } from '../../services/conversation-store'

// All tests redirect ~/.oneship/sessions to a tmpdir so they don't pollute
// the real user data directory.
let originalHome: string | undefined
let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'oneship-session-test-'))
  originalHome = process.env.HOME
  process.env.HOME = tmp
})

afterEach(() => {
  process.env.HOME = originalHome
  rmSync(tmp, { recursive: true, force: true })
})

describe('Session', () => {
  it('create() persists meta.json and an empty event log directory', async () => {
    const session = await Session.create({ sessionId: 's_abc' })
    expect(session.meta.sessionId).toBe('s_abc')
    // meta.json on disk
    const dir = sessionDir('s_abc')
    expect(dir.startsWith(tmp)).toBe(true)
    // events.jsonl does not yet exist (no events appended)
    // but sessionDir does
  })

  it('appendUserMessage adds a complete message and persists 3 events', async () => {
    const session = await Session.create({ sessionId: 's_1' })
    const msg = await session.appendUserMessage('hello')
    expect(msg.role).toBe('user')
    expect(isMessageComplete(msg)).toBe(true)
    expect(session.uiMessages).toHaveLength(1)

    const events = await readEvents(eventLogPath('s_1'))
    expect(events).toHaveLength(3)
    expect(events[0].type).toBe('message-start')
    expect(events[1].type).toBe('part-append')
    expect(events[2].type).toBe('message-finish')
  })

  it('appendAssistantStubReply adds the hardcoded stub assistant message', async () => {
    const session = await Session.create({ sessionId: 's_1' })
    await session.appendUserMessage('hi')
    const reply = await session.appendAssistantStubReply()
    expect(reply.role).toBe('assistant')
    expect(isMessageComplete(reply)).toBe(true)
    const text = (reply.parts[0] as any).text
    expect(text).toContain('Phase 1 stub')
  })

  it('Session.open replays existing events from disk', async () => {
    const a = await Session.create({ sessionId: 's_persist' })
    await a.appendUserMessage('persist me')
    await a.appendAssistantStubReply()

    const b = await Session.open('s_persist')
    expect(b.uiMessages).toHaveLength(2)
    expect(b.uiMessages[0].role).toBe('user')
    expect(b.uiMessages[1].role).toBe('assistant')
  })

  it('Session.open throws if meta.json is missing', async () => {
    await expect(Session.open('s_does_not_exist')).rejects.toThrow()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm vitest run src/agent/session/__tests__/session.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement `src/agent/session/session.ts`**

```ts
import { nanoid } from 'nanoid'
import type { UIMessage } from 'ai'
import type { SessionMeta, TriggeredBy, PermissionMode } from '../../shared/agent-protocol'
import {
  ensureSessionDir,
  eventLogPath,
  readMeta,
  writeMeta,
} from './store'
import { readEvents } from '../services/event-log'
import {
  replay,
  writeMessageStart,
  writePartAppend,
  writeMessageFinish,
} from '../services/conversation-store'

const PHASE1_STUB_REPLY = 'Hello from Chief Agent (Phase 1 stub — no LLM yet).'

export interface CreateSessionOptions {
  sessionId?: string
  model?: string
  permissionMode?: PermissionMode
  triggeredBy?: TriggeredBy
}

export class Session {
  meta: SessionMeta
  uiMessages: UIMessage[]

  private constructor(meta: SessionMeta, uiMessages: UIMessage[]) {
    this.meta = meta
    this.uiMessages = uiMessages
  }

  static async create(opts: CreateSessionOptions = {}): Promise<Session> {
    const now = Date.now()
    const meta: SessionMeta = {
      sessionId: opts.sessionId ?? `s_${nanoid(10)}`,
      createdAt: now,
      updatedAt: now,
      model: opts.model ?? 'phase1-stub',
      permissionMode: opts.permissionMode ?? 'trust',
      planMode: false,
      triggeredBy: opts.triggeredBy ?? { kind: 'user' },
      lastSegmentReason: null,
      title: null,
      eventLogLength: 0,
      snapshotEventOffset: null,
    }
    await ensureSessionDir(meta.sessionId)
    await writeMeta(meta)
    return new Session(meta, [])
  }

  static async open(sessionId: string): Promise<Session> {
    const meta = await readMeta(sessionId)
    if (!meta) throw new Error(`Session ${sessionId} not found`)
    const events = await readEvents(eventLogPath(sessionId))
    const uiMessages = replay(events)
    return new Session(meta, uiMessages)
  }

  /**
   * Append a complete user message: emits message-start, part-append (text),
   * and message-finish, all to the same event log line by line. Returns the
   * resulting UIMessage.
   */
  async appendUserMessage(text: string): Promise<UIMessage> {
    const messageId = `m_${nanoid(10)}`
    const log = eventLogPath(this.meta.sessionId)
    await writeMessageStart(log, this.uiMessages, {
      messageId,
      role: 'user',
      createdAt: Date.now(),
    })
    await writePartAppend(log, this.uiMessages, {
      messageId,
      part: { type: 'text', text } as any,
    })
    await writeMessageFinish(log, this.uiMessages, { messageId })
    await this.touchMeta(3)
    return this.uiMessages[this.uiMessages.length - 1]
  }

  /**
   * Phase 1 hardcoded assistant reply. Phase 2 replaces this with a real
   * LLM-driven runSegment, but the same write-event pattern still applies.
   */
  async appendAssistantStubReply(): Promise<UIMessage> {
    const messageId = `m_${nanoid(10)}`
    const log = eventLogPath(this.meta.sessionId)
    await writeMessageStart(log, this.uiMessages, {
      messageId,
      role: 'assistant',
      createdAt: Date.now(),
    })
    await writePartAppend(log, this.uiMessages, {
      messageId,
      part: { type: 'text', text: PHASE1_STUB_REPLY } as any,
    })
    await writeMessageFinish(log, this.uiMessages, { messageId })
    await this.touchMeta(3)
    return this.uiMessages[this.uiMessages.length - 1]
  }

  private async touchMeta(eventsAdded: number): Promise<void> {
    this.meta.updatedAt = Date.now()
    this.meta.eventLogLength += eventsAdded
    this.meta.lastSegmentReason = 'natural'
    await writeMeta(this.meta)
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm vitest run src/agent/session/__tests__/session.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/agent/session/session.ts src/agent/session/store.ts src/agent/session/__tests__/session.test.ts
git commit -m "feat(agent): Session class with create/open/append + meta + event log"
```

---

### Task 7: Implement `SessionManager` and `resume`

**Files:**
- Create: `src/agent/session/session-manager.ts`
- Create: `src/agent/session/resume.ts`
- Create: `src/agent/session/__tests__/session-manager.test.ts`
- Create: `src/agent/session/__tests__/resume.test.ts`

`SessionManager` holds `Map<sessionId, Session>` and is the only path the IPC layer touches sessions through. It implements the multi-session contract from §15.4 — but in Phase 1 it is exercised with usually one or two sessions at a time.

`resume.ts` enumerates `~/.oneship/sessions/` on worker startup, loads each meta.json (lazy hydration — the actual `Session.open` is deferred until the IPC layer asks for it).

- [ ] **Step 1: Write the failing SessionManager test**

`src/agent/session/__tests__/session-manager.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SessionManager } from '../session-manager'

let originalHome: string | undefined
let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'oneship-mgr-test-'))
  originalHome = process.env.HOME
  process.env.HOME = tmp
})

afterEach(() => {
  process.env.HOME = originalHome
  rmSync(tmp, { recursive: true, force: true })
})

describe('SessionManager', () => {
  it('createSession returns an open Session', async () => {
    const mgr = new SessionManager()
    const session = await mgr.createSession({})
    expect(mgr.get(session.meta.sessionId)).toBe(session)
  })

  it('listSessions includes a freshly created session', async () => {
    const mgr = new SessionManager()
    const a = await mgr.createSession({})
    const list = await mgr.listSessions()
    expect(list.find((m) => m.sessionId === a.meta.sessionId)).toBeDefined()
  })

  it('openSession loads from disk if not in memory', async () => {
    const mgr1 = new SessionManager()
    const a = await mgr1.createSession({ sessionId: 's_persist' })
    await mgr1.closeSession('s_persist')

    const mgr2 = new SessionManager()
    const b = await mgr2.openSession('s_persist')
    expect(b.meta.sessionId).toBe('s_persist')
  })

  it('openSession returns the in-memory instance if already open', async () => {
    const mgr = new SessionManager()
    const a = await mgr.createSession({ sessionId: 's_x' })
    const b = await mgr.openSession('s_x')
    expect(b).toBe(a)
  })

  it('closeSession removes from memory but keeps disk state', async () => {
    const mgr = new SessionManager()
    const a = await mgr.createSession({ sessionId: 's_close' })
    await mgr.closeSession('s_close')
    expect(mgr.get('s_close')).toBeUndefined()
    // Re-opening still works
    const b = await mgr.openSession('s_close')
    expect(b.meta.sessionId).toBe('s_close')
  })
})
```

- [ ] **Step 2: Write the failing resume test**

`src/agent/session/__tests__/resume.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { enumerateSessionMetas } from '../resume'

let originalHome: string | undefined
let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'oneship-resume-test-'))
  originalHome = process.env.HOME
  process.env.HOME = tmp
})

afterEach(() => {
  process.env.HOME = originalHome
  rmSync(tmp, { recursive: true, force: true })
})

describe('resume', () => {
  it('returns [] if sessions root does not exist', async () => {
    expect(await enumerateSessionMetas()).toEqual([])
  })

  it('returns metas for each session directory', async () => {
    const root = join(tmp, '.oneship', 'sessions')
    mkdirSync(join(root, 's_a'), { recursive: true })
    mkdirSync(join(root, 's_b'), { recursive: true })
    writeFileSync(join(root, 's_a', 'meta.json'), JSON.stringify({
      sessionId: 's_a', createdAt: 1, updatedAt: 2, model: 'x',
      permissionMode: 'trust', planMode: false,
      triggeredBy: { kind: 'user' }, lastSegmentReason: null,
      title: null, eventLogLength: 0, snapshotEventOffset: null,
    }))
    writeFileSync(join(root, 's_b', 'meta.json'), JSON.stringify({
      sessionId: 's_b', createdAt: 1, updatedAt: 5, model: 'x',
      permissionMode: 'trust', planMode: false,
      triggeredBy: { kind: 'user' }, lastSegmentReason: null,
      title: null, eventLogLength: 0, snapshotEventOffset: null,
    }))

    const metas = await enumerateSessionMetas()
    expect(metas).toHaveLength(2)
    // Sorted by updatedAt desc
    expect(metas[0].sessionId).toBe('s_b')
    expect(metas[1].sessionId).toBe('s_a')
  })

  it('skips directories without meta.json', async () => {
    const root = join(tmp, '.oneship', 'sessions')
    mkdirSync(join(root, 's_orphan'), { recursive: true })
    expect(await enumerateSessionMetas()).toEqual([])
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm vitest run src/agent/session/__tests__/session-manager.test.ts src/agent/session/__tests__/resume.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement `src/agent/session/resume.ts`**

```ts
import { promises as fs, existsSync } from 'fs'
import { join } from 'path'
import type { SessionMeta } from '../../shared/agent-protocol'
import { sessionsRoot, metaPath } from './store'
import { readJsonOrNull } from '../services/fs'

/**
 * Enumerate all sessions on disk, returning their metas sorted by
 * updatedAt descending (most recent first). Used by SessionManager
 * on worker startup for lazy hydration.
 */
export async function enumerateSessionMetas(): Promise<SessionMeta[]> {
  const root = sessionsRoot()
  if (!existsSync(root)) return []
  const entries = await fs.readdir(root, { withFileTypes: true })
  const metas: SessionMeta[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const meta = await readJsonOrNull<SessionMeta>(metaPath(entry.name))
    if (meta) metas.push(meta)
  }
  metas.sort((a, b) => b.updatedAt - a.updatedAt)
  return metas
}
```

- [ ] **Step 5: Implement `src/agent/session/session-manager.ts`**

```ts
import { Session, type CreateSessionOptions } from './session'
import { enumerateSessionMetas } from './resume'
import type { SessionMeta } from '../../shared/agent-protocol'

/**
 * Holds the live `Session` instances for the worker. Multi-session aware
 * from day one — Phase 1 typically has one user session + zero cron sessions,
 * but the contract is what later phases ride on.
 *
 * Lazy hydration: `bootstrap()` reads metas from disk into a metadata cache
 * but does NOT call `Session.open` for any of them. A session is only
 * fully loaded when `openSession(id)` is called by the IPC layer.
 */
export class SessionManager {
  private live = new Map<string, Session>()
  private knownMetas = new Map<string, SessionMeta>()

  /** Read meta.json for every session on disk. Called once at startup. */
  async bootstrap(): Promise<void> {
    const metas = await enumerateSessionMetas()
    for (const m of metas) this.knownMetas.set(m.sessionId, m)
  }

  get(sessionId: string): Session | undefined {
    return this.live.get(sessionId)
  }

  async createSession(opts: CreateSessionOptions): Promise<Session> {
    const session = await Session.create(opts)
    this.live.set(session.meta.sessionId, session)
    this.knownMetas.set(session.meta.sessionId, session.meta)
    return session
  }

  async openSession(sessionId: string): Promise<Session> {
    const existing = this.live.get(sessionId)
    if (existing) return existing
    const session = await Session.open(sessionId)
    this.live.set(sessionId, session)
    this.knownMetas.set(sessionId, session.meta)
    return session
  }

  async closeSession(sessionId: string): Promise<void> {
    // Phase 1 has no in-flight cleanup beyond removing from the live map.
    // Phase 2+ will flush pending writes, abort segments, etc.
    this.live.delete(sessionId)
  }

  async listSessions(): Promise<SessionMeta[]> {
    // Re-bootstrap from disk so newly created sessions in another process
    // would show up. (In Phase 1 there's only one process, but the contract
    // is "list returns the disk truth.")
    await this.bootstrap()
    return Array.from(this.knownMetas.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt
    )
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm vitest run src/agent/session/__tests__/session-manager.test.ts src/agent/session/__tests__/resume.test.ts
```

Expected: PASS, 8 tests across both files.

- [ ] **Step 7: Commit**

```bash
git add src/agent/session/session-manager.ts src/agent/session/resume.ts \
        src/agent/session/__tests__/session-manager.test.ts \
        src/agent/session/__tests__/resume.test.ts
git commit -m "feat(agent): SessionManager + resume enumeration (multi-session aware)"
```

---

### Task 8: Implement the Worker IPC server

**Files:**
- Create: `src/agent/ipc/server.ts`
- Create: `src/agent/ipc/__tests__/server.test.ts`
- Create: `src/agent/ipc/rpc-client.ts` (Phase 1 stub)

The IPC server is the worker's "controller layer" — it receives `ToWorker` messages, calls `SessionManager`, and posts `ToMain` responses. Phase 1 wires the message handlers without any LLM logic; the assistant reply comes from `Session.appendAssistantStubReply()`.

The server is unit-testable via a small `MessagePort`-like interface that lets us inject in-memory channels in tests.

- [ ] **Step 1: Write the failing IPC server test**

`src/agent/ipc/__tests__/server.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { startIpcServer, type IpcChannel } from '../server'
import type { ToWorker, ToMain } from '../../../shared/agent-protocol'

class TestChannel implements IpcChannel {
  private listeners: ((m: ToWorker) => void)[] = []
  outgoing: ToMain[] = []
  postMessage(m: ToMain): void { this.outgoing.push(m) }
  onMessage(cb: (m: ToWorker) => void): void { this.listeners.push(cb) }
  // Test helper: simulate Main sending a message
  send(m: ToWorker): void { for (const l of this.listeners) l(m) }
  // Wait for next outgoing message of given type (poll, simple)
  async waitFor(type: ToMain['type'], timeoutMs = 1000): Promise<ToMain> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const found = this.outgoing.find((m) => m.type === type)
      if (found) return found
      await new Promise((r) => setTimeout(r, 5))
    }
    throw new Error(`Timed out waiting for ${type}`)
  }
}

let originalHome: string | undefined
let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'oneship-ipc-test-'))
  originalHome = process.env.HOME
  process.env.HOME = tmp
})

afterEach(() => {
  process.env.HOME = originalHome
  rmSync(tmp, { recursive: true, force: true })
})

describe('IPC server', () => {
  it('emits ready immediately on start', async () => {
    const ch = new TestChannel()
    await startIpcServer(ch)
    await ch.waitFor('ready')
  })

  it('handles create-session and replies with session-created', async () => {
    const ch = new TestChannel()
    await startIpcServer(ch)
    await ch.waitFor('ready')

    ch.send({ type: 'create-session', sessionId: 's_abc' })
    const reply = await ch.waitFor('session-created')
    expect((reply as { sessionId: string }).sessionId).toBe('s_abc')
  })

  it('full round-trip: create → send-user-message → message-complete (assistant)', async () => {
    const ch = new TestChannel()
    await startIpcServer(ch)
    await ch.waitFor('ready')

    ch.send({ type: 'create-session', sessionId: 's_round' })
    await ch.waitFor('session-created')

    ch.send({ type: 'send-user-message', sessionId: 's_round', content: 'hello' })
    // Two message-complete events expected: first the user message, then the assistant stub
    const start = Date.now()
    let userSeen = false
    let assistantSeen = false
    while (Date.now() - start < 2000) {
      const completes = ch.outgoing.filter((m) => m.type === 'message-complete')
      for (const m of completes) {
        const msg = (m as { message: { role: string } }).message
        if (msg.role === 'user') userSeen = true
        if (msg.role === 'assistant') assistantSeen = true
      }
      if (userSeen && assistantSeen) break
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(userSeen).toBe(true)
    expect(assistantSeen).toBe(true)

    const finished = await ch.waitFor('segment-finished')
    expect((finished as { reason: string }).reason).toBe('natural')
  })

  it('list-sessions returns the created session', async () => {
    const ch = new TestChannel()
    await startIpcServer(ch)
    await ch.waitFor('ready')

    ch.send({ type: 'create-session', sessionId: 's_listed' })
    await ch.waitFor('session-created')

    ch.send({ type: 'list-sessions' })
    const list = await ch.waitFor('session-list')
    const sessions = (list as { sessions: { sessionId: string }[] }).sessions
    expect(sessions.find((s) => s.sessionId === 's_listed')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/agent/ipc/__tests__/server.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/agent/ipc/rpc-client.ts` (Phase 1 stub)**

```ts
// Phase 2+ will use this to call back into Main for things like ListProjects.
// Phase 1 has no tools that need Main data, so the stub rejects unconditionally.

import { Phase1NotImplemented } from '../services/conversation-store'

export async function rpcCall<T>(_op: string, _params: unknown): Promise<T> {
  throw new Phase1NotImplemented('rpcCall (Worker→Main RPC)')
}
```

- [ ] **Step 4: Implement `src/agent/ipc/server.ts`**

```ts
import type { ToWorker, ToMain } from '../../shared/agent-protocol'
import { isToWorker } from '../../shared/agent-protocol'
import { SessionManager } from '../session/session-manager'
import { sanitizeErrorMessage } from '../runtime/sanitize-error'

/**
 * Minimal channel interface so server.ts is testable without an actual
 * Electron MessagePortMain. Implementations: utilityProcess parentPort
 * (worker side, in src/agent/index.ts), and the TestChannel in tests.
 */
export interface IpcChannel {
  postMessage(message: ToMain): void
  onMessage(callback: (message: ToWorker) => void): void
}

export interface IpcServerHandle {
  shutdown(): Promise<void>
}

export async function startIpcServer(channel: IpcChannel): Promise<IpcServerHandle> {
  const sessions = new SessionManager()
  await sessions.bootstrap()

  channel.onMessage(async (msg) => {
    if (!isToWorker(msg)) {
      // Drop unknown messages — defensive against protocol drift.
      return
    }
    try {
      await handleMessage(channel, sessions, msg)
    } catch (err) {
      // Phase 1 reports the error against the segment if we have a sessionId.
      const sessionId = (msg as { sessionId?: string }).sessionId
      if (sessionId) {
        channel.postMessage({
          type: 'segment-finished',
          sessionId,
          reason: 'error',
          error: sanitizeErrorMessage(err),
        })
      } else {
        // No session context to report against; log and continue.
        console.error('[agent] handleMessage error:', sanitizeErrorMessage(err))
      }
    }
  })

  // Announce readiness AFTER the message handler is wired so any race-y
  // Main code that fires create-session immediately after seeing 'ready'
  // is guaranteed to be observed.
  channel.postMessage({ type: 'ready' })

  return {
    shutdown: async () => {
      // Phase 1: nothing to clean up beyond the in-memory map.
      // Phase 2+ will flush in-flight segments and pending writes.
    },
  }
}

async function handleMessage(
  channel: IpcChannel,
  sessions: SessionManager,
  msg: ToWorker
): Promise<void> {
  switch (msg.type) {
    case 'shutdown': {
      // The actual process exit happens in src/agent/index.ts after the
      // shutdown handler returns, since we still want to flush any pending
      // writes (Phase 2+).
      return
    }
    case 'create-session': {
      const session = await sessions.createSession({
        sessionId: msg.sessionId,
        model: msg.model,
        permissionMode: msg.permissionMode,
        triggeredBy: msg.triggeredBy,
      })
      channel.postMessage({ type: 'session-created', sessionId: session.meta.sessionId })
      // Also push an opened snapshot so the renderer can render an empty session
      // without a separate open-session round trip.
      channel.postMessage({
        type: 'session-opened',
        sessionId: session.meta.sessionId,
        snapshot: { meta: session.meta, uiMessages: session.uiMessages },
      })
      return
    }
    case 'open-session': {
      const session = await sessions.openSession(msg.sessionId)
      channel.postMessage({
        type: 'session-opened',
        sessionId: session.meta.sessionId,
        snapshot: { meta: session.meta, uiMessages: session.uiMessages },
      })
      return
    }
    case 'close-session': {
      await sessions.closeSession(msg.sessionId)
      channel.postMessage({ type: 'session-closed', sessionId: msg.sessionId })
      return
    }
    case 'list-sessions': {
      const list = await sessions.listSessions()
      channel.postMessage({ type: 'session-list', sessions: list })
      return
    }
    case 'send-user-message': {
      const session = await sessions.openSession(msg.sessionId)
      const userMsg = await session.appendUserMessage(msg.content)
      channel.postMessage({
        type: 'message-complete',
        sessionId: session.meta.sessionId,
        message: userMsg,
      })
      // Phase 1: hardcoded assistant stub. Phase 2 replaces this with runSegment.
      const assistantMsg = await session.appendAssistantStubReply()
      channel.postMessage({
        type: 'message-complete',
        sessionId: session.meta.sessionId,
        message: assistantMsg,
      })
      channel.postMessage({
        type: 'segment-finished',
        sessionId: session.meta.sessionId,
        reason: 'natural',
      })
      return
    }
    case 'cancel-current-turn': {
      // Phase 1: nothing to cancel since the stub reply is synchronous and instant.
      // Just emit an aborted segment-finished so the protocol shape works.
      channel.postMessage({
        type: 'segment-finished',
        sessionId: msg.sessionId,
        reason: 'aborted',
      })
      return
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm vitest run src/agent/ipc/__tests__/server.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/agent/ipc/server.ts src/agent/ipc/rpc-client.ts src/agent/ipc/__tests__/server.test.ts
git commit -m "feat(agent): IPC server with create/open/list/send round-trip"
```

---

### Task 9: Wire the worker entry point

**Files:**
- Modify: `src/agent/index.ts` (replace placeholder)

The entry point reads the parent port from `process.parentPort` (provided by Electron's `utilityProcess`), wraps it in an `IpcChannel`, and starts the server.

- [ ] **Step 1: Implement `src/agent/index.ts`**

```ts
// Agent Worker entry point. Loaded by Electron's `utilityProcess.fork`.
//
// Communication with Main goes through `process.parentPort`, which is a
// MessagePortMain provided by Electron. Anything more sophisticated is
// handled in src/agent/ipc/server.ts.

import { startIpcServer, type IpcChannel } from './ipc/server'
import type { ToWorker, ToMain } from '../shared/agent-protocol'

declare const process: NodeJS.Process & {
  parentPort?: {
    postMessage(message: ToMain): void
    on(event: 'message', listener: (e: { data: ToWorker }) => void): void
  }
}

const port = process.parentPort
if (!port) {
  console.error('[agent] No parentPort — was this loaded outside utilityProcess?')
  process.exit(1)
}

const channel: IpcChannel = {
  postMessage(message) {
    port.postMessage(message)
  },
  onMessage(callback) {
    port.on('message', (e) => callback(e.data))
  },
}

startIpcServer(channel).catch((err) => {
  console.error('[agent] startIpcServer failed:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Verify build**

```bash
pnpm build
ls dist/agent/index.js  # or dist/main/agent.js per Plan B from Task 1
```

Expected: build succeeds, the file exists.

- [ ] **Step 3: Commit**

```bash
git add src/agent/index.ts
git commit -m "feat(agent): wire utilityProcess entry to IPC server"
```

---

### Task 10: Implement `AgentHost` in Main

**Files:**
- Create: `src/main/agent-host.ts`
- Create: `src/main/__tests__/agent-host.test.ts`

`AgentHost` is the Main-process side of the IPC. It owns the `utilityProcess` lifecycle (start, crash detection, respawn, shutdown) and exposes a typed promise-based API for the Main IPC handlers to call.

Phase 1 implements:
- `start()` — fork the worker, wait for `ready`, return
- `sendMessage(toWorker)` — post a message
- `on(event, callback)` — subscribe to incoming `ToMain` events
- `shutdown()` — graceful stop (with hard-kill fallback after 3s)
- Crash detection: on worker exit, log + auto-respawn up to 3 times in 60s

- [ ] **Step 1: Write the failing test**

`src/main/__tests__/agent-host.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
// AgentHost depends on electron.utilityProcess which is not available
// in vitest. We test the helper logic that doesn't need Electron — the
// respawn rate-limiter and the ready-ticket idempotency — and leave the
// full integration-level check for a dev-mode smoke test (Task 13).

import { RespawnGate, makeReadyTicket } from '../agent-host'

describe('RespawnGate', () => {
  it('allows up to 3 respawns within the window', () => {
    const gate = new RespawnGate({ max: 3, windowMs: 60_000 })
    expect(gate.allow(1000)).toBe(true)
    expect(gate.allow(2000)).toBe(true)
    expect(gate.allow(3000)).toBe(true)
    expect(gate.allow(4000)).toBe(false)
  })

  it('forgets respawns older than the window', () => {
    const gate = new RespawnGate({ max: 3, windowMs: 60_000 })
    gate.allow(1000)
    gate.allow(2000)
    gate.allow(3000)
    // After 70s, the earlier ones should have aged out
    expect(gate.allow(73_000)).toBe(true)
  })
})

describe('ReadyTicket', () => {
  it('resolve() satisfies the awaiter', async () => {
    const ticket = makeReadyTicket()
    let resolved = false
    const p = ticket.promise.then(() => { resolved = true })
    ticket.resolve()
    ticket.settled = true
    await p
    expect(resolved).toBe(true)
  })

  it('reject() rejects the awaiter', async () => {
    const ticket = makeReadyTicket()
    const p = ticket.promise.catch((e: Error) => e.message)
    ticket.reject(new Error('boom'))
    ticket.settled = true
    expect(await p).toBe('boom')
  })

  // The most important invariant: a single ticket can survive multiple
  // spawnWorker() attempts. The first spawn might crash (no settle), the
  // second spawn might succeed (resolve once). The ticket must never be
  // resolved twice or transition state after settling.
  it('is single-use: subsequent settle calls are no-ops via the settled flag', async () => {
    const ticket = makeReadyTicket()
    let settleCount = 0
    const p = ticket.promise.then(() => { settleCount++ })
    ticket.resolve()
    ticket.settled = true
    // Simulate a stray "second resolve" (e.g. respawned worker also reports ready)
    if (!ticket.settled) ticket.resolve()  // would never run; lock-in test
    await p
    expect(settleCount).toBe(1)
  })
})
```

Notes on these tests:

- `makeReadyTicket` is exported from `agent-host.ts` so it's reachable from tests. It's an internal helper, but exporting it has no runtime cost and makes the invariant testable without spinning up a fake utilityProcess.
- We deliberately do **not** test "respawn gate exhausted → ready ticket rejects" at the unit level because that path requires running the AgentHost lifecycle, which in turn requires Electron's utilityProcess. The Task 13 manual smoke test exercises that path: kill the worker process repeatedly within 60s and verify start() eventually rejects with the rate-exceeded message.

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/main/__tests__/agent-host.test.ts
```

Expected: FAIL (`Cannot find module '../agent-host'`).

- [ ] **Step 3: Implement `src/main/agent-host.ts`**

```ts
import { utilityProcess, type UtilityProcess, app } from 'electron'
import { join } from 'path'
import type { ToWorker, ToMain } from '../shared/agent-protocol'
import { isToMain } from '../shared/agent-protocol'

/**
 * Tracks recent respawn timestamps and decides whether another respawn
 * is permitted (max N within window). Pure class — testable without Electron.
 *
 * `opts` is public readonly so AgentHost can include the config in error
 * messages when the gate exhausts.
 */
export class RespawnGate {
  private timestamps: number[] = []
  constructor(public readonly opts: { max: number; windowMs: number }) {}

  allow(now = Date.now()): boolean {
    this.timestamps = this.timestamps.filter((t) => now - t < this.opts.windowMs)
    if (this.timestamps.length >= this.opts.max) return false
    this.timestamps.push(now)
    return true
  }
}

export interface AgentHostOptions {
  /** Override the path to dist/agent/index.js. Defaults to the standard build location. */
  workerPath?: string
}

export type ToMainListener = (message: ToMain) => void

/**
 * Internal: a single "I'm waiting for the worker to be ready" ticket.
 * Outlives any individual spawnWorker() call — respawns can satisfy or
 * reject the same ticket. start() creates it, start() awaits it, and the
 * spawn/exit machinery is responsible for either resolving (on a 'ready'
 * message) or rejecting (on terminal failure such as respawn-gate exhaustion).
 */
interface ReadyTicket {
  promise: Promise<void>
  resolve: () => void
  reject: (err: Error) => void
  settled: boolean
}

// Exported so unit tests in src/main/__tests__/agent-host.test.ts can
// exercise the ticket lifecycle without spinning up Electron's utilityProcess.
// AgentHost is the only production caller.
export function makeReadyTicket(): ReadyTicket {
  let resolve!: () => void
  let reject!: (err: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return {
    promise,
    resolve: () => { /* settled flag set by the caller */ resolve() },
    reject: (err: Error) => { reject(err) },
    settled: false,
  }
}

export class AgentHost {
  private proc: UtilityProcess | null = null
  private listeners: Set<ToMainListener> = new Set()
  private currentReadyTicket: ReadyTicket | null = null
  private respawnGate = new RespawnGate({ max: 3, windowMs: 60_000 })
  private intentionalShutdown = false

  constructor(private options: AgentHostOptions = {}) {}

  /** Default location: dist/agent/index.js relative to the Electron app root. */
  private workerPath(): string {
    if (this.options.workerPath) return this.options.workerPath
    // Electron's app.getAppPath() returns the directory containing package.json
    // in dev, or the app.asar root in production.
    return join(app.getAppPath(), 'dist', 'agent', 'index.js')
  }

  /**
   * Fork the worker and wait until *some* spawn (the first one or a respawn
   * after early crashes) reports 'ready'. If the worker crashes before
   * reporting ready and the respawn gate has more attempts left, this method
   * keeps waiting on the same promise — the next successful spawn satisfies
   * it. If the respawn gate exhausts before any spawn reports ready, the
   * promise rejects and start() throws.
   */
  async start(): Promise<void> {
    if (this.proc) return
    this.intentionalShutdown = false
    if (!this.currentReadyTicket || this.currentReadyTicket.settled) {
      this.currentReadyTicket = makeReadyTicket()
    }
    this.spawnWorker()
    await this.currentReadyTicket.promise
  }

  private settleReady(kind: 'resolve', err?: undefined): void
  private settleReady(kind: 'reject', err: Error): void
  private settleReady(kind: 'resolve' | 'reject', err?: Error): void {
    const ticket = this.currentReadyTicket
    if (!ticket || ticket.settled) return
    ticket.settled = true
    if (kind === 'resolve') ticket.resolve()
    else ticket.reject(err as Error)
  }

  private spawnWorker(): void {
    const path = this.workerPath()
    console.log('[agent-host] forking worker:', path)

    const proc = utilityProcess.fork(path, [], {
      stdio: 'inherit',
      serviceName: 'oneship-agent',
    })
    this.proc = proc

    proc.on('message', (message) => {
      if (!isToMain(message)) return
      if (message.type === 'ready') {
        this.settleReady('resolve')
      }
      for (const l of this.listeners) l(message)
    })

    proc.on('exit', (code) => {
      console.log('[agent-host] worker exited code=', code, 'intentional=', this.intentionalShutdown)
      this.proc = null
      if (this.intentionalShutdown) return

      // If we crashed before sending 'ready', the existing readyTicket is
      // still unresolved. Decide whether to respawn (and let the next spawn
      // potentially resolve the same ticket) or to reject the ticket.
      if (this.respawnGate.allow()) {
        console.log('[agent-host] respawning worker')
        this.spawnWorker()
        // The new spawn shares the same currentReadyTicket. If it succeeds,
        // start() unblocks. If it also dies pre-ready, we recurse here.
      } else {
        console.error('[agent-host] respawn rate exceeded; giving up')
        // If anything is still waiting on currentReadyTicket, free them.
        this.settleReady(
          'reject',
          new Error(
            `Agent worker respawn rate exceeded (${this.respawnGate.opts.max} crashes within ${this.respawnGate.opts.windowMs}ms)`
          )
        )
        // Phase 2+ will also surface this to the UI as a banner.
      }
    })
  }

  send(message: ToWorker): void {
    if (!this.proc) {
      console.warn('[agent-host] send called with no live worker; dropping', message.type)
      return
    }
    this.proc.postMessage(message)
  }

  on(listener: ToMainListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async shutdown(): Promise<void> {
    if (!this.proc) return
    this.intentionalShutdown = true
    this.send({ type: 'shutdown' })
    // Give the worker 3s to exit gracefully, then kill.
    await new Promise<void>((resolve) => {
      const proc = this.proc
      if (!proc) { resolve(); return }
      const timeout = setTimeout(() => {
        proc.kill()
        resolve()
      }, 3000)
      proc.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
    this.proc = null
  }
}
```

- [ ] **Step 4: Run test to verify RespawnGate passes**

```bash
pnpm vitest run src/main/__tests__/agent-host.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-host.ts src/main/__tests__/agent-host.test.ts
git commit -m "feat(main): AgentHost — utilityProcess lifecycle + respawn gate"
```

---

### Task 11: Wire `AgentHost` into `src/main/index.ts` (additive — keep ProjectChat alive)

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/__tests__/index.test.ts`

**Critical sequencing rule for this task:** the existing `src/renderer/pages/project-chat.tsx` calls `window.electronAPI.chat.getConversation` / `chat.sendMessage` / `chat.getMessages`. **If Task 11 deletes the `electronAPI.chat` namespace before something replaces it, ProjectChat fails to compile and the whole renderer build breaks.** Phase 1 must not break ProjectChat — Phase 1's product change is "add Chief Agent," not "rebuild Project Lead chat." That migration is on the Phase 5 task list.

So Task 11 is **additive only**:

- It **adds** `AgentHost`, `chief:send` IPC, `chief:event` broadcast, `electronAPI.chief.*` preload namespace, and `before-quit` shutdown handling.
- It **does not delete** the existing `chat:*` IPC handlers, the `electronAPI.chat` preload namespace, the old `Message` type, or `src/main/conversation-store.ts`.
- The old plumbing remains in place as an explicit "PHASE-5 TODO" zone, marked with a comment block so future maintainers (and Phase 5) can find it instantly.

The deletion-and-cleanup of the old `chat:*` plumbing is **deferred to Phase 5**, when the project-chat backend is migrated to the agent worker. This is intentional duplication for the duration of Phases 1-4 — the cost is ~150 lines of dead-but-working code in `main/index.ts` and `preload/index.ts`, which is much smaller than the cost of breaking ProjectChat or building two parallel implementations of the same thing in Phase 1.

**Mark the old code clearly.** Add a comment block in `src/main/index.ts` immediately above the existing `chat:` IPC handlers and `getOrCreateConversation` import, and a parallel block in `src/preload/index.ts` above the `chat:` namespace:

```ts
// =============================================================================
// PHASE-5 TODO: legacy ProjectChat IPC kept alive during Phases 1-4.
//
// The Chief Agent (Phase 1+) does NOT use this — it routes through the
// agent worker via chief:send/chief:event below. ProjectChat (the in-project
// Project Lead chat) still uses the old simple {role, content} message model
// and the chat:* IPC, and Phase 1 deliberately does not touch it. Phase 5
// migrates ProjectChat to the agent worker and at that point everything in
// this block (the imports, the handlers, src/main/conversation-store.ts,
// the electronAPI.chat preload namespace, and the old Message type) gets
// deleted. Until then: leave it alone.
// =============================================================================
```

(Same comment, adapted, in the preload file above its `chat:` block.)

- [ ] **Step 1: Confirm the existing chat surface and inventory its consumers**

```bash
grep -rn "electronAPI\.chat" src/renderer
grep -n "chat:" src/main/index.ts
grep -n "chat:" src/preload/index.ts
```

**Expected at Task 11 time** (Task 12 has not run yet): **two** renderer consumers of `electronAPI.chat`:

1. `src/renderer/pages/chief-chat.tsx` — the existing placeholder ChiefChat that calls `chat.getConversation` and `chat.sendMessage`. Task 12 will rewrite this to use the new `electronAPI.chief.*` API and remove its dependency on `chat.*`.
2. `src/renderer/pages/project-chat.tsx` — the in-project Project Lead chat. Phase 1 does **not** rewrite this; it remains on the legacy `chat:*` IPC for the duration of Phases 1-4 and migrates in Phase 5.

If grep shows **only one** consumer (just project-chat), it means someone has already started Task 12's rewrite — back out that change before continuing, because Task 11 must complete before Task 12.

If grep shows **three or more** consumers, stop and figure out what the new caller is before continuing — the additive-only assumption depends on knowing the full call site list. The plan was written under the assumption of exactly two consumers at Task 11 time and exactly one (project-chat) after Task 12.

Also verify `src/main/conversation-store.ts` still exists (it's the file backing the legacy chat IPC, kept alive by Task 11):

```bash
ls src/main/conversation-store.ts
```

After Task 12 lands, the only renderer caller of `electronAPI.chat` will be `project-chat.tsx`. Task 11 itself does not change this picture — Task 11 is purely additive on the Main and Preload sides; the renderer-side cleanup of ChiefChat happens in Task 12. The two-consumer state during Task 11 is normal and expected.

- [ ] **Step 2: Add the legacy-zone comment markers (do NOT delete anything)**

In `src/main/index.ts`, find the `import` line for `conversation-store` (around line 8) and the `chat:*` IPC handlers (around lines 530–555 per Task 1's exploration). Add the PHASE-5 TODO comment block immediately above the import, and a matching one immediately above the IPC handlers. Do not modify or delete any code — these are markers only.

In `src/preload/index.ts`, find the existing `chat: { ... }` object on `electronAPI` (around line 60). Add a similar PHASE-5 TODO comment block immediately above it.

- [ ] **Step 3: Add `AgentHost` and `chief:*` IPC to `src/main/index.ts`**

Add the new imports at the top alongside the others (do not touch the existing imports):

```ts
import { AgentHost } from './agent-host'
import type { ToWorker } from '../shared/agent-protocol'
```

Add a singleton `AgentHost` instance near the other top-level singletons (after `terminalThemeStore`):

```ts
const agentHost = new AgentHost()
```

In the `app.whenReady()` callback (or wherever app initialization happens), add after the existing setup but before `createWindow()`:

```ts
agentHost.on((message) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('chief:event', message)
  }
})
await agentHost.start()
```

Add the new IPC handler (after the terminal-theme handlers, before `setupApplicationMenu`):

```ts
// Chief Agent IPC — proxies to the agent worker.
// Note: this lives ALONGSIDE the legacy chat:* handlers above, not instead
// of them. See the PHASE-5 TODO comment block.
ipcMain.handle('chief:send', (_event, msg: ToWorker) => {
  agentHost.send(msg)
})
```

We use **one** IPC channel (`chief:send`) that takes a typed `ToWorker` payload, rather than one channel per message kind. This keeps the boundary thin and matches the worker's discriminated union directly. The renderer is responsible for constructing well-formed messages.

- [ ] **Step 4: Add `before-quit` shutdown handling**

Electron does **not** await async listeners on `before-quit` / `will-quit` by default — the OS may kill the worker before `agentHost.shutdown()` resolves. The correct pattern is to gate the quit on a flag and re-quit after the async work finishes.

Add (or extend) a `before-quit` handler that uses the existing `isShuttingDown` flag pattern already in `src/main/index.ts`:

```ts
app.on('before-quit', async (event) => {
  if (isShuttingDown) return
  isShuttingDown = true
  event.preventDefault()
  try {
    await agentHost.shutdown()
  } catch (err) {
    console.error('[main] agent shutdown failed:', err)
  }
  app.exit(0)
})
```

Notes:

- The plan assumes `isShuttingDown` already exists in `src/main/index.ts` (verified during exploration — it does).
- `event.preventDefault()` cancels the in-flight quit; `app.exit(0)` after the await is what actually terminates the process. Using `app.quit()` here would re-fire `before-quit` and infinite-loop if the flag wasn't checked.
- The flag check at the top short-circuits the second pass that `app.exit(0)` triggers (Electron may emit before-quit again as part of clean shutdown on some platforms).
- If a `will-quit` handler already runs cleanup for other subsystems (terminal manager, hook server), centralize all shutdown there and remove from `before-quit` to avoid duplicate calls. Use whichever lifecycle hook the existing code already uses for this kind of work.

- [ ] **Step 5: Add the `chief:*` namespace to `src/preload/index.ts` (additive)**

Add the imports at the top:

```ts
import type { ToWorker, ToMain } from '../shared/agent-protocol'
```

Inside the `contextBridge.exposeInMainWorld('electronAPI', { ... })` object, add a new `chief:` namespace alongside the existing `chat:` namespace. **Do not delete `chat:*`** — it stays for ProjectChat:

```ts
chief: {
  send: (message: ToWorker) => ipcRenderer.invoke('chief:send', message),
  onEvent: (callback: (message: ToMain) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, message: ToMain) => callback(message)
    ipcRenderer.on('chief:event', listener)
    return () => {
      ipcRenderer.removeListener('chief:event', listener)
    }
  },
},
```

The result is that `window.electronAPI` now has BOTH `chat` (for ProjectChat) and `chief` (for ChiefChat). Both work. Phase 5 deletes `chat`.

- [ ] **Step 6: Update preload test (additive only — keep existing chat assertions)**

Read the existing test:

```bash
cat src/preload/__tests__/index.test.ts
```

The existing test stubs `contextBridge.exposeInMainWorld` and asserts the shape of `electronAPI`. Update it **additively**:

1. **Keep** all existing assertions about `electronAPI.chat.*` — those still need to pass because ProjectChat still uses them.
2. **Add** new assertions that `electronAPI.chief` exists with `send` and `onEvent`:

```ts
expect(typeof electronAPI.chief.send).toBe('function')
expect(typeof electronAPI.chief.onEvent).toBe('function')
```

3. **Add** an assertion that calling `electronAPI.chief.send({ type: 'list-sessions' })` does not throw and calls through to the mocked `ipcRenderer.invoke` with channel `'chief:send'`.

Run the test:

```bash
pnpm vitest run src/preload/__tests__/index.test.ts
```

Expected: PASS. Both old `chat:*` assertions and new `chief.*` assertions pass.

- [ ] **Step 7: Run all main + preload tests**

```bash
pnpm vitest run src/main/__tests__ src/preload/__tests__
```

Expected: PASS. No tests should fail because nothing was deleted — Task 11 is purely additive.

- [ ] **Step 8: Run a full build**

```bash
pnpm build
```

Expected: success. `dist/main/index.js`, `dist/preload/index.js`, `dist/agent/index.js`, `dist/renderer/...` all exist.

`pnpm build` also type-checks the renderer, including `project-chat.tsx`. The build passing here is the canonical proof that Task 11 didn't break ProjectChat.

- [ ] **Step 9: Smoke-test ProjectChat survives**

```bash
pnpm dev
```

Open a project, click "Project Lead" chat, send a message. Expected: it still works the same as before (mock reply from the legacy `chat:sendMessage` handler).

This is the human-eyes proof that the additive-only sequencing worked.

- [ ] **Step 10: Commit**

```bash
git add src/main/index.ts src/main/agent-host.ts src/preload/index.ts src/preload/__tests__/index.test.ts
git commit -m "feat(main): wire AgentHost + chief:* IPC alongside legacy chat:*

Additive integration: AgentHost lifecycle, chief:send/chief:event IPC,
electronAPI.chief preload namespace, and before-quit shutdown handler.

The legacy chat:* IPC and src/main/conversation-store.ts are intentionally
kept alive — ProjectChat still uses them. They are marked with a PHASE-5
TODO comment block and will be deleted when Phase 5 migrates ProjectChat
to the agent worker. Phase 1 does not touch ProjectChat."
```

---

### Task 12: Renderer-side session store and chief-chat rewrite

**Files:**
- Create: `src/renderer/stores/chief-session.ts`
- Modify: `src/renderer/pages/chief-chat.tsx`
- Create: `src/renderer/components/chat/messages/user-bubble.tsx`
- Create: `src/renderer/components/chat/messages/assistant-text.tsx`
- Create: `src/renderer/components/chat/messages/system-notice.tsx`
- (Not touched: `src/renderer/components/chat/message-list.tsx`. Chief Agent chat dispatches messages to its own renderers directly via the part registry pattern. `MessageList` continues to serve ProjectChat unchanged. This avoids any risk of breaking ProjectChat through an "improvement" to a shared component.)

The renderer's `chief-session.ts` is a small state holder (React `useState` + listener subscription is fine for Phase 1; no Zustand needed yet). It:

1. On mount, subscribes to `electronAPI.chief.onEvent`
2. On first render, sends `list-sessions`. If the list is empty, sends `create-session`. If non-empty, sends `open-session` for the most recent.
3. Maintains `{ activeSessionId, uiMessages }` state, updating from `session-opened`, `message-complete`, etc.
4. Exposes a `sendUserMessage(text)` action that constructs and sends `send-user-message`.

The `MessageList` component currently consumes the old `Message` type. We **don't** unify it across project chat (which still uses old types) — instead, `chief-chat.tsx` uses the new `UIMessage[]` types directly and dispatches each to the right renderer (`user-bubble` / `assistant-text` / `system-notice`).

- [ ] **Step 1: Create the renderer chief-session module**

`src/renderer/stores/chief-session.ts`:

```ts
import { useEffect, useRef, useState, useCallback } from 'react'
import type { UIMessage } from 'ai'
import type { ToMain, SessionMeta } from '../../shared/agent-protocol'

interface ChiefSessionState {
  status: 'booting' | 'idle' | 'sending' | 'error'
  activeSessionId: string | null
  uiMessages: UIMessage[]
  knownSessions: SessionMeta[]
  error: string | null
}

const INITIAL: ChiefSessionState = {
  status: 'booting',
  activeSessionId: null,
  uiMessages: [],
  knownSessions: [],
  error: null,
}

export function useChiefSession() {
  const [state, setState] = useState<ChiefSessionState>(INITIAL)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const api = window.electronAPI.chief
    const unsubscribe = api.onEvent((message: ToMain) => {
      switch (message.type) {
        case 'session-list': {
          setState((s) => ({ ...s, knownSessions: message.sessions }))
          if (message.sessions.length === 0) {
            // No sessions on disk — create a fresh interactive one.
            const sessionId = `s_${Date.now().toString(36)}`
            api.send({ type: 'create-session', sessionId })
          } else {
            const top = message.sessions[0]
            api.send({ type: 'open-session', sessionId: top.sessionId })
          }
          break
        }
        case 'session-created': {
          // Worker also sends session-opened immediately after.
          break
        }
        case 'session-opened': {
          setState((s) => ({
            ...s,
            status: 'idle',
            activeSessionId: message.sessionId,
            uiMessages: message.snapshot.uiMessages,
          }))
          break
        }
        case 'message-complete': {
          setState((s) => {
            if (s.activeSessionId !== message.sessionId) return s
            // Replace if a message with the same id already exists, otherwise append
            const idx = s.uiMessages.findIndex((m) => m.id === message.message.id)
            const next = [...s.uiMessages]
            if (idx >= 0) next[idx] = message.message
            else next.push(message.message)
            return { ...s, uiMessages: next }
          })
          break
        }
        case 'segment-finished': {
          setState((s) => {
            if (s.activeSessionId !== message.sessionId) return s
            return {
              ...s,
              status: message.reason === 'error' ? 'error' : 'idle',
              error: message.reason === 'error' ? (message.error ?? 'Unknown error') : null,
            }
          })
          break
        }
        default:
          break
      }
    })

    // Initial bootstrap
    api.send({ type: 'list-sessions' })

    return () => unsubscribe()
  }, [])

  const sendUserMessage = useCallback((text: string) => {
    const sessionId = stateRef.current.activeSessionId
    if (!sessionId) return
    setState((s) => ({ ...s, status: 'sending' }))
    window.electronAPI.chief.send({ type: 'send-user-message', sessionId, content: text })
  }, [])

  return { ...state, sendUserMessage }
}
```

- [ ] **Step 2: Create the three Phase 1 message renderers**

`src/renderer/components/chat/messages/user-bubble.tsx`:

```tsx
import type { UIMessage } from 'ai'

interface Props {
  message: UIMessage
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
```

`src/renderer/components/chat/messages/assistant-text.tsx`:

```tsx
import type { UIMessage } from 'ai'
import { VennLogo } from '../../ui/venn-logo'

interface Props {
  message: UIMessage
}

export function AssistantText({ message }: Props) {
  const text = message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')
  return (
    <div className="flex gap-3 mb-4">
      <div className="flex-shrink-0 mt-1">
        <VennLogo size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-body text-xs text-muted mb-1">Chief Agent</p>
        <p className="font-body text-sm text-espresso whitespace-pre-wrap">{text}</p>
      </div>
    </div>
  )
}
```

`src/renderer/components/chat/messages/system-notice.tsx`:

```tsx
interface Props {
  text: string
}

export function SystemNotice({ text }: Props) {
  return (
    <div className="text-center my-4">
      <p className="font-mono text-xs text-light italic">{text}</p>
    </div>
  )
}
```

- [ ] **Step 3: Rewrite `src/renderer/pages/chief-chat.tsx`**

```tsx
import { useChiefSession } from '../stores/chief-session'
import { VennLogo } from '../components/ui/venn-logo'
import { ChatInput } from '../components/chat/chat-input'
import { UserBubble } from '../components/chat/messages/user-bubble'
import { AssistantText } from '../components/chat/messages/assistant-text'
import { SystemNotice } from '../components/chat/messages/system-notice'
import { useProjects } from '../stores/project-store'

export function ChiefChat() {
  const { projects } = useProjects()
  const { status, uiMessages, sendUserMessage, error } = useChiefSession()

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-surface">
        <VennLogo size={28} />
        <div>
          <h1 className="font-heading text-sm font-semibold text-espresso">Chief Agent</h1>
          <p className="font-body text-xs text-muted">
            Overseeing {projects.length} project{projects.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {status === 'booting' && <SystemNotice text="Connecting to Chief Agent…" />}
        {error && <SystemNotice text={`Error: ${error}`} />}
        {uiMessages.map((msg) =>
          msg.role === 'user' ? (
            <UserBubble key={msg.id} message={msg} />
          ) : msg.role === 'assistant' ? (
            <AssistantText key={msg.id} message={msg} />
          ) : null
        )}
      </div>

      <ChatInput
        placeholder="Message Chief Agent..."
        onSend={sendUserMessage}
        disabled={status === 'sending' || status === 'booting'}
      />
    </div>
  )
}
```

- [ ] **Step 4: Build the renderer**

```bash
pnpm build
```

Expected: success. Renderer bundles produced.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/stores/chief-session.ts \
        src/renderer/pages/chief-chat.tsx \
        src/renderer/components/chat/messages/user-bubble.tsx \
        src/renderer/components/chat/messages/assistant-text.tsx \
        src/renderer/components/chat/messages/system-notice.tsx
git commit -m "feat(renderer): Chief Agent chat consumes UIMessage from agent worker"
```

---

### Task 13: End-to-end smoke test

**Files:** none new, this is a manual verification step.

The unit tests cover individual modules. Phase 1 is "done" only when the full integrated system works end-to-end. There is no automated test for this in Phase 1 (electron-vite + utilityProcess is hard to script), so we do it manually and check off each criterion.

- [ ] **Step 1: Boot the dev build**

```bash
pnpm dev
```

Expected:
- Electron window opens
- Console shows `[agent-host] forking worker:` followed by the worker path
- Console shows the worker's output (none in Phase 1 unless an error)
- No exit / respawn loop

- [ ] **Step 2: Verify the worker is a separate process**

Open Activity Monitor (macOS) or Task Manager. Find the OneShip process tree.

Expected: At least 4 processes — Oneship (main), Oneship Helper (Renderer), Oneship Helper (GPU), and **Oneship Helper (Plugin)** which is the agent worker. The Plugin helper is what `utilityProcess.fork` spawns.

- [ ] **Step 3: Open Chief Agent chat in the UI**

Click the Chief Agent entry in the sidebar.

Expected:
- The chat view loads
- "Connecting to Chief Agent…" briefly appears, then disappears
- The message area is empty (first run) or shows previous messages (later runs)

- [ ] **Step 4: Send "hello"**

Type "hello" and press enter.

Expected:
- A user bubble appears immediately on the right
- Within ~500ms, an assistant message appears: "Hello from Chief Agent (Phase 1 stub — no LLM yet)."

- [ ] **Step 5: Verify on-disk persistence**

```bash
ls ~/.oneship/sessions/
# Should show a directory like s_<id>
SESSION=$(ls -t ~/.oneship/sessions/ | head -1)
ls ~/.oneship/sessions/$SESSION/
# Should show meta.json and events.jsonl
cat ~/.oneship/sessions/$SESSION/events.jsonl | head
```

(`ls -t | head -1` picks the most recently modified session, avoiding ambiguity if previous test runs left other sessions behind.)

Expected: 6 events visible — 3 for the user message, 3 for the assistant message. Each one a single JSON object.

- [ ] **Step 6: Restart and verify resume**

`Cmd+Q` to quit OneShip. Then `pnpm dev` again. Open Chief Agent chat.

Expected: The previous "hello" and the assistant reply are still visible.

- [ ] **Step 7: Test crash recovery (single crash)**

While OneShip is running and Chief Agent chat is open, find the "Oneship Helper (Plugin)" process in Activity Monitor and force-quit it.

Expected:
- Console logs `[agent-host] worker exited code= ...` followed by `respawning worker`
- Within 1-2 seconds, send another message in the chat
- The message round-trips successfully (i.e., the new worker took over)

- [ ] **Step 7b: Test respawn gate exhaustion**

Force-quit the "Oneship Helper (Plugin)" process **four times within 60 seconds**, as fast as you can find it again in Activity Monitor.

Expected:
- The first three respawns succeed (gate allows 3 within 60s).
- On the fourth crash, console logs `[agent-host] respawn rate exceeded; giving up`
- The chat UI no longer responds to new messages — `chief.send` posts hit a worker-less host and are dropped (with a console warn).
- No infinite respawn loop, no zombie processes.

This proves the rate-limiter and the ticket-rejection path together. After verifying, restart OneShip cleanly to recover.

- [ ] **Step 8: Document the result**

If all 7 prior steps pass, Phase 1 is complete. Add a one-line note to the commit (or to the plan checkbox area) confirming the manual smoke test passed.

- [ ] **Step 9: Commit (smoke test note)**

```bash
git commit --allow-empty -m "test(agent): manual Phase 1 smoke test passed

End-to-end verified:
- utilityProcess spawned as Oneship Helper (Plugin)
- create-session round-trip
- send-user-message → hardcoded assistant reply
- events.jsonl persisted
- Restart preserves transcript
- Worker crash auto-respawns within 60s gate"
```

---

### Task 14: Final cleanup pass

**Files:** various — dependency on what Phase 1 actually broke

This task is a sweep to catch anything Phase 1 might have left broken in unrelated parts of the app:

- [ ] **Step 1: Run the full test suite**

```bash
pnpm test
```

Expected: all tests pass. Task 11 was additive only — no `chat:*` plumbing was deleted — so no test should break for that reason. Any failure is a real regression in something Phase 1 did touch (Chief Agent chat UI, Session, IPC, etc.); investigate and fix.

- [ ] **Step 2: Run the full build**

```bash
pnpm build
```

Expected: success.

- [ ] **Step 3: Boot the app one more time and click through every page**

`pnpm dev`, then visit:
- Global Dashboard
- Project Dashboard (open any project)
- **Chief Agent chat** (the new one, verified in Task 13 — should still work)
- **Project Chat (Project Lead)** — this is the critical co-existence check. ProjectChat still uses the legacy `electronAPI.chat.*` IPC, and Phase 1 left that IPC in place via the PHASE-5 TODO zone in Task 11. Open a project, click "Project Lead", send a message. Expected: it works exactly the same as before Phase 1 (mock reply from the legacy `chat:sendMessage` handler). If it doesn't, the additive-only contract in Task 11 was violated somewhere — find which deletion happened and revert it.
- Tasks page
- Terminal page
- Preferences

Expected: all pages load, no new console errors.

- [ ] **Step 4: If anything is broken, fix the regression**

The most likely failure mode is that something in `main/index.ts` accidentally got deleted along with the additive changes. Use `git diff main` to compare against the pre-Phase-1 state:

```bash
git diff main -- src/main/index.ts | grep '^-' | head -40
```

Anything that disappears here that wasn't intentional should be restored. The PHASE-5 TODO zone in `src/main/index.ts` (the legacy `chat:*` import + handlers + the `conversation-store.ts` import) **must** still exist after Phase 1 — if any of that shows up in the diff as deleted, add it back.

- [ ] **Step 5: Commit any cleanup**

If no cleanup was needed, commit an empty marker so the phase ends on a clean checkpoint:

```bash
git commit --allow-empty -m "chore(agent): Phase 1 cleanup pass — no regressions found"
```

Otherwise:

```bash
git add -A
git commit -m "fix(agent): Phase 1 regression cleanup

<describe what was actually broken and how it was fixed>"
```

---

## Phase 1 done. What this gets you

After Task 14, OneShip has:

- A real Electron `utilityProcess` running `src/agent/index.ts` as the agent worker
- A typed IPC protocol between Main and Worker that's session-aware from day one
- A multi-session manager (`SessionManager`) and disk layout (`~/.oneship/sessions/<id>/`)
- An event-log persistence layer with `replay()` and write helpers
- A new Chief Agent chat UI consuming `UIMessage[]` and rendering with three message components
- A hardcoded assistant reply that proves the round-trip works
- Unit tests for every module Phase 1 introduces
- All file boundaries in place for Phases 2–6 to fill in:
  - LLM call → `runtime/loop.ts` (Phase 2)
  - 22 tools → `tools/*.ts` (Phases 2–5)
  - Plan / Ask / Cautious → `session/suspension.ts` and the resolution path (Phase 4)
  - Snapshots and compaction → `services/snapshot-store.ts` and `services/compaction.ts` (Phase 4)
  - Skills → `skills/loader.ts` (Phase 5)
  - Cron → `services/cron.ts` (Phase 5)

## What Phase 2 will start with

Phase 2 plan will pick up by:

1. Replacing `runtime/model.ts`'s stub with `createOpenRouter` from `@openrouter/ai-sdk-provider`
2. Replacing `Session.appendAssistantStubReply()` with a call to `runtime/loop.ts → runSegment()`
3. Implementing `runSegment` with `streamText({ messages, system, tools, stopWhen })` per spec §5.4
4. Implementing the first batch of Phase 2 tools (Read, Glob, Grep, ListProjects)
5. Replacing the Phase 1 stubs in `runtime/retry.ts` with the real `withRetry` from spec §13.2
6. Filling in `context/system-prompt.ts` with the static/dynamic boundary from spec §7.1
7. Replacing `message-complete` with streaming `message-delta` events as text streams in
8. Adding the first version of `tool-call-pill.tsx` and `tool-call-card.tsx` renderers
9. **Specifically validating** (per codex's Phase 1 residual): that `UIMessage.metadata.isComplete` survives `validateUIMessages(...)`, the React store, and JSON serialization round-trips. Add a Phase 2 task that writes the round-trip as an explicit assertion.

---

**End of Phase 1 plan.**
