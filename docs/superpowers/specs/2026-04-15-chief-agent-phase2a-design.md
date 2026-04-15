# Chief Agent Phase 2a — Design Spec

**Scope:** First usable LLM-driven slice of Chief Agent. Real OpenRouter streaming, seven tools, permission + suspension framework, minimal UI, stub cleanup.

**Parent spec:** `2026-04-14-chief-agent-design.md` (§1–§16 remain the long-term architectural authority). This document is a delta: it specifies what Phase 2a builds, what it defers, and where it tightens the parent spec.

**Tightenings against the parent spec:** §6.3a in the parent (added in this phase) is authoritative for tool execution topology, descriptor structure, and approval-class semantics. This Phase 2a spec references §6.3a rather than duplicating it.

---

## 1. Goals

By the end of Phase 2a, a user with a valid OpenRouter API key can:

1. Open Chief Agent, configure the API key + model + default permission mode in Preferences.
2. Send a message like "read `src/agent/runtime/loop.ts` and tell me what Phase 1 left as stubs." Chief Agent calls the `Read` tool, streams assistant text back, and finishes the segment naturally.
3. Send a message like "write `hello world` to `/tmp/test.txt`." In normal mode, a Permission card appears, the user clicks Allow, the file is written, and Chief Agent confirms the result in a follow-up text part.
4. Send a message like "ask me: REST or GraphQL?" Chief Agent calls `AskUserQuestion`, an Ask card appears, the user selects a choice, and the loop resumes with the answer threaded into the conversation.

Phase 2a is the minimum viable LLM-driven Chief Agent. Everything else in the parent spec §18.1 MVP checklist is Phase 2b or later.

## 2. Non-Goals

The following are explicitly out of scope for Phase 2a and deferred to Phase 2b:

- Skills system (loader, Skill tool, sub-agent fork)
- Task tools (TaskCreate / TaskUpdate / TaskList / TaskGet) and task-store persistence
- Cron tools (CronCreate / CronList / CronDelete) and scheduler
- Agent tool (generic LLM sub-agent fork)
- Plan Mode tools (EnterPlanMode / ExitPlanMode) and Plan Mode mask
- Long-running Bash (`run_in_background` / BashOutput / Monitor)
- ListProjects tool
- WebSearch tool
- Auto-compaction (§7.2 of parent)
- Session memory V1 (§7.4 of parent)
- Stop hook (§14)
- Context budget allocator (§7.5)
- Thinking blocks, richer tool cards, plan cards, task chips, system notices — every UI component in §16.3 other than the five listed in §10 below
- Sidebar upgrades beyond what Phase 1 already has
- Project-local skills directory
- OS keychain (keytar)

Phase 2a establishes the **framework** for some of these — for example, the suspension protocol is fully built in 2a with all six resolution kinds defined, but only the three kinds Phase 2a actually exercises (`question`, `permission-allow(-always)`, `permission-deny`) have implementations; the three plan-mode kinds throw `Phase2bNotImplemented`.

## 3. Success Criteria

Phase 2a is complete when **all six** of the following hold:

1. With OpenRouter key + `anthropic/claude-sonnet-4.6` configured, the user can read a file via Chief Agent: "read `src/agent/runtime/loop.ts` and tell me what Phase 1 left as stubs" produces a streaming assistant response that includes at least one visible Read tool-call card and a natural finish.
2. In normal mode, `write hello world to /tmp/test.txt` triggers a PermissionCard (approvalClass=write); clicking Allow writes the file; the loop resumes and confirms the write.
3. `ask me whether REST or GraphQL is better` triggers `AskUserQuestion` → AskCard → user selects a choice → loop resumes → assistant message acknowledges the answer.
4. Permission-mode toggle works: trust mode runs (2) without prompting; strict mode prompts on (1) before the Read is allowed.
5. `grep -rn "Phase1NotImplemented\|appendAssistantStubReply" src/` returns no matches. All Phase 1 stub scaffolding is gone.
6. `pnpm test` is fully green (expected ~170+ tests, up from Phase 1's 140). `pnpm test:smoke` runs manually and passes.

## 4. Deltas from the Parent Spec

Phase 2a tightens or clarifies the following points in the parent spec:

1. **§6.3a is authoritative** for tool execution topology, descriptor schema, and approval-class semantics. Tool descriptors MUST declare `execution` and `approvalClass`; there is no context-dependent third mode. Security logic (path guards etc.) lives in `src/shared/tool-guards/`.
2. **Permission is unified with the suspension protocol.** The parent spec §15.5 already puts permission on the suspension path ("cautious"); Phase 2a confirms this and rejects the alternative of a separate synchronous RPC for permission. Both `AskUserQuestion` and permission prompts raise a `SuspensionSpec`, end the segment, and resume via `resolve-suspension` + a synthetic user message.
3. **Permission check runs in the worker.** `checkPermission(mode, approvalClass, allowlist, singleUse)` is a pure function local to the worker. Main owns the policy source of truth (the default permission mode in Preferences, and the `set-permission-mode` IPC), but runtime evaluation happens where the tool is about to execute. This keeps the worker from having to round-trip to main on every `read`-class tool call in trust/normal modes (which is the common case).
4. **Event log adds `part-rewrite`.** Parent spec §15.2.1 defines four `LogEvent` types. Phase 2a adds a fifth, `part-rewrite`, used by `cleanupOrphanPlaceholders` to replace `{__suspended: true}` placeholders with their resolved value (`{resolved: true}` or `{error: 'user-denied'}`). Replay must handle this new event type.
5. **Streaming text persistence uses 250ms time-window flush with a final merge.** Parent spec does not specify the flush policy. Phase 2a pins it: `TextFlushScheduler` buffers `text-delta` fragments in memory, flushes a `part-update` event every 250ms, and merges any residual buffer into the final write that precedes `message-finish`. `message-finish` is the only event in the assistant-text path that forces `fsync`.
6. **Tool call and tool result are stored as two separate parts.** Parent spec §15.2.1 lists `part-append` for tool parts but doesn't explicitly address pairing. Phase 2a pins: `tool-call` and `tool-result` are separate `part-append` events (one each), paired in the UI layer by `toolCallId`. This follows the native shape of Vercel AI SDK `fullStream` and avoids a transformation step in the worker.
7. **Live tool-exec status is renderer-only.** Phase 2a adds a `tool-exec-status { toolCallId, state: 'running' | 'done' | 'error' }` message sent from worker to main to renderer. It is NOT persisted to the event log. On replay, a tool-call without a corresponding tool-result is rendered as "recovering..." rather than "running".
8. **Permission `ui` class is pass-through.** `AskUserQuestion` has `approvalClass: 'ui'`, and the permission truth table (§6.3a) routes `ui` to `allow` without prompting. AskCard is raised by the tool itself via the suspension protocol, not by permission gating.
9. **Single session is strictly serial.** Parent spec §15.4 permits concurrent segments with a semaphore cap of 4. Phase 2a pins one session to one runLoop at a time. A second user message while a runLoop is in flight is rejected with a UI notice. Cross-session concurrency is allowed but not exercised in Phase 2a.

## 5. Architecture Overview

### 5.1 Execution flow for a typical turn

1. **User sends a message.** Renderer → main → worker as `chief:send` IPC. Worker's `Session.appendUserMessage` writes `message-start` + `part-append(text)` + `message-finish` to the event log, then triggers `runLoop(session, abort)`.
2. **runLoop calls runSegment.** `runSegment` calls `cleanupOrphanPlaceholders(session)` first, then builds system messages via `buildSystemMessages(session)`, builds the tool set via `allTools(session)`, and calls `streamText({ model, messages, tools, stopWhen: stepCountIs(50), abortSignal: combined })`.
3. **Worker consumes `fullStream`.** For each part type:
   - `text-delta`: append to `TextFlushScheduler` buffer; flush every 250ms as `part-update`.
   - `tool-call`: write `part-append(tool-call)`; send `tool-exec-status { state: 'running' }` to main.
   - `tool-result`: write `part-append(tool-result)`; send `tool-exec-status { state: 'done' | 'error' }`.
   - `finish`: note `finishReason`.
4. **Tool call execution.** When Vercel AI SDK invokes `tool.execute(args, ctx)`:
   - `manifest-wrapper` looks up the manifest entry, validates args against the schema, computes `summary`.
   - `checkPermission(session.meta.permissionMode, manifest.approvalClass, session.allowOnceClasses, session.singleUseApprovals)` returns `allow` / `deny` / `prompt-needed`.
   - **allow**: for `execution: 'local'`, run the inner executor; for `execution: 'rpc'`, send `rpc.request { kind: 'tool.exec' }` and await the response.
   - **deny**: return `{ error: 'user-denied' }` as tool-result (no prompt).
   - **prompt-needed**: push a `permission` SuspensionSpec to `session.pendingSuspension`, write a `{__suspended: true}` placeholder tool-result, throw `SuspensionSignal`. `runSegment` catches the signal, persists `suspension.json`, and returns `{ reason: 'suspended' }`.
5. **Suspending tools (AskUserQuestion).** Same pattern as prompt-needed, but the SuspensionSpec has `kind: 'question'` and the placeholder is written by the tool's own executor, not by the permission wrapper.
6. **runLoop follows finish reason.** `tool-calls` → continue to next segment. Anything else → persist `lastSegmentReason` and return.
7. **Suspension resolution.** Main's `suspension-router` receives `suspension-raised`, looks at `spec.kind`, dispatches `permission.prompt` or `ask.prompt` to the renderer. Renderer shows the appropriate card. User action → `resolve-suspension` IPC back to main → main updates session state (allowlist additions, singleUseApproval entries) → main forwards `resolve-suspension` to worker → worker appends a synthetic user message to the session history describing the resolution, deletes `suspension.json`, clears `pendingSuspension`, and calls `cleanupOrphanPlaceholders` (which rewrites the `__suspended` placeholder as a `part-rewrite` event) → worker triggers a new `runLoop` iteration.

### 5.2 Deferred decisions (flagged not designed)

These are intentionally not pinned in Phase 2a; they'll be decided when their consumers land:

- **Inline `rpc.progress` messages for long-running Bash**: Phase 2a Bash blocks until completion and streams nothing intermediate. Phase 2b may add progress streaming.
- **Long-running Bash via `run_in_background`**: deferred to Phase 2b along with BashOutput and Monitor.
- **Permission policy for cross-project tool calls**: Phase 2a has only one project context per session; multi-project scoping is a V1 question.

## 6. Tool System

### 6.1 Shared manifest layer

`src/shared/tool-manifest.ts`:

```ts
import { z } from 'zod'

export type ExecutionLocation = 'local' | 'rpc'
export type ApprovalClass = 'read' | 'write' | 'exec' | 'ui'

export interface ToolManifest {
  name: string
  description: string
  inputSchema: z.ZodTypeAny
  execution: ExecutionLocation
  approvalClass: ApprovalClass
  summarize: (args: unknown) => string
}

export const TOOL_MANIFESTS: Record<string, ToolManifest> = {
  Read: { ... execution: 'local', approvalClass: 'read', ... },
  Glob: { ... execution: 'local', approvalClass: 'read', ... },
  Grep: { ... execution: 'local', approvalClass: 'read', ... },
  WebFetch: { ... execution: 'local', approvalClass: 'read', ... },
  Write: { ... execution: 'local', approvalClass: 'write', ... },
  Edit: { ... execution: 'local', approvalClass: 'write', ... },
  Bash: { ... execution: 'rpc', approvalClass: 'exec', ... },
  AskUserQuestion: { ... execution: 'rpc', approvalClass: 'ui', ... },
}
```

Worker imports `TOOL_MANIFESTS` to build its `allTools()` registry (filtering by `execution === 'local'`). Main imports `TOOL_MANIFESTS` to build the `tool-executors` registry (filtering by `execution === 'rpc'`).

### 6.2 Worker tool wrapper

`src/agent/tools/manifest-wrapper.ts` takes a `ToolManifest` and an inner `execute` function (for `local` tools) or a RPC executor (for `rpc` tools) and returns a Vercel AI SDK `tool()` object. The wrapper is where `checkPermission` is invoked and where suspension signals are thrown.

```ts
export function wrapLocalTool(
  manifest: ToolManifest,
  inner: (args: any, ctx: ExecContext) => Promise<unknown>,
): Tool {
  return tool({
    description: manifest.description,
    inputSchema: manifest.inputSchema,
    execute: async (args, ctx) => {
      const session = ctx.experimental_context.session as Session
      const decision = checkPermission(session, manifest.approvalClass, manifest.name, args)
      if (decision === 'allow') {
        guardArgs(manifest, args)  // shared tool-guards
        return await inner(args, ctx)
      }
      if (decision === 'deny') {
        return { error: 'user-denied' }
      }
      // prompt-needed
      const suspensionId = nanoid()
      session.pendingSuspension = {
        kind: 'permission',
        suspensionId,
        messageId: session.currentMessageId,
        partIndex: session.currentPartIndex + 1,
        toolCallId: ctx.toolCallId,
        toolName: manifest.name,
        approvalClass: manifest.approvalClass,
        summary: manifest.summarize(args),
        args,
      }
      await appendEvent({
        type: 'part-append',
        messageId: session.currentMessageId,
        part: { type: 'tool-result', toolCallId: ctx.toolCallId, result: { __suspended: true, suspensionId } },
      })
      throw new SuspensionSignal(suspensionId)
    },
  })
}

export function wrapRpcTool(manifest: ToolManifest): Tool {
  // Same permission-check prelude as local; on allow, send rpc.request and await.
}
```

### 6.3 RPC envelope

One envelope, two kinds (per §6.3a):

```ts
type RpcRequest<K extends string, P> = {
  type: 'rpc.request'
  kind: K  // 'tool.exec'
  requestId: string
  payload: P
}
type RpcResponse<R> = {
  type: 'rpc.response'
  requestId: string
  result: { ok: true; data: R } | { ok: false; error: string }
}
type RpcCancel = { type: 'rpc.cancel'; requestId: string }
```

Shared correlation table in `AgentHost`: `requestId → { resolve, reject, timeout, abortSignal }`. Worker-side uses the mirror correlation in `rpc-client.ts`.

Phase 2a only uses `kind: 'tool.exec'`. The envelope is general so Phase 2b can add kinds without re-plumbing correlation.

### 6.4 Shared guards

`src/shared/tool-guards/path-guard.ts`:

- Enforces absolute paths for all file operations.
- Enforces workspace bounds: the allowed set is the current project directory (if session is in project context) plus `/tmp`. User home directory dotfiles (`~/.ssh`, `~/.aws`, `~/.oneship`, `~/.claude`, `~/.codex`) are always denied, regardless of workspace bounds.
- Throws `PathGuardError(reason)`. The tool wrapper catches it and returns `{ error: 'path-guard: <reason>' }` as the tool-result (no permission prompt needed — the guard is a hard deny).

The path guard is **not** a substitute for permission approval. A Write in `normal` mode still triggers a permission prompt even if the path passes the guard. The guard is the first line of defense against egregious mistakes; permission is the second line.

### 6.5 Tool implementations

Each of the seven tools gets its own file. Phase 2a implementations are MVP-shaped (no advanced features):

- **Read** (`src/agent/tools/read.ts`): file_path (required), offset, limit. Returns file contents as a string. Honors path guard.
- **Glob** (`src/agent/tools/glob.ts`): pattern (required), path (optional). Returns matching paths. Uses `fast-glob` (already in dependency tree? — verify during plan).
- **Grep** (`src/agent/tools/grep.ts`): pattern (required), path, glob filter, `-i`, `-C`, `output_mode`. Uses `rg` if available, falls back to Node regex. Returns match lines.
- **WebFetch** (`src/agent/tools/web-fetch.ts`): url (required), optional prompt for summarization. Returns HTML → markdown-converted text. No LLM re-summarization in 2a (that's a Phase 2b refinement).
- **Write** (`src/agent/tools/write.ts`): file_path (required), content (required). Always overwrites. Honors path guard. Triggers write approval.
- **Edit** (`src/agent/tools/edit.ts`): file_path (required), old_string (required), new_string (required), replace_all (optional). Honors path guard. Triggers write approval.
- **Bash** (`src/main/tool-executors/bash.ts`): cmd (required), cwd (optional, defaults to project root). Uses the existing `TerminalManager` — Phase 2a adds a `runOneShot` method to TerminalManager if one doesn't already exist. Streams stdout/stderr into a string buffer, returns `{ stdout, stderr, exitCode }` when the command exits. Honors an abort signal passed through the rpc envelope. Triggers exec approval.
- **AskUserQuestion** (`src/main/tool-executors/ask-user-question.ts`): the rpc executor only builds the `ask.prompt` message and forwards it; the actual "ask" logic is the suspension protocol. The rpc tool executor never directly returns — it waits for a `resolve-suspension` message that resolves the tool call. Actually — **re-check**: for `ui` class (pass-through permission), the worker tool wrapper still runs the permission check (which returns `allow`), then sends `rpc.request { kind: 'tool.exec' }` to main, main raises the suspension there. This means `AskUserQuestion` suspends from main-side, not worker-side — matching the design that the executor owns its UI mediation. The SuspensionSpec is constructed in main and sent to the worker via a new `suspension-raised-by-main` message, which the worker records in its own session state. **TODO in plan phase**: decide whether suspension raising for ui-class tools happens on worker or main. Tentative: main raises it and relays via an IPC message.

(The last bullet above flags a real ambiguity that we should resolve during plan writing. The two options are: (a) worker wraps the AskUserQuestion rpc tool and raises suspension worker-side before even sending to main, or (b) main's executor raises suspension on behalf of the worker. I lean (a) — it keeps suspension raising colocated with the tool wrapper and keeps the worker as the single source of truth for `session.pendingSuspension`. Plan task T-05 will finalize this.)

## 7. Runtime

### 7.1 `runSegment` flow

`src/agent/runtime/run-segment.ts`:

```ts
export async function runSegment(
  session: Session,
  externalAbort: AbortSignal,
): Promise<RunSegmentResult> {
  await cleanupOrphanPlaceholders(session)

  const suspensionController = new AbortController()
  const combined = AbortSignal.any([externalAbort, suspensionController.signal])
  const flusher = new TextFlushScheduler(session)

  try {
    const result = await streamText({
      model: getModel(session.meta.model),
      messages: buildSystemMessages(session).concat(session.uiMessages.toCoreMessages()),
      tools: allTools(session),
      stopWhen: stepCountIs(50),
      abortSignal: combined,
      experimental_context: { session },
    })
    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta': await flusher.append(part.textDelta); break
        case 'tool-call': await handleToolCall(session, part); break
        case 'tool-result': await handleToolResult(session, part); break
        case 'finish': return finishSegment(session, flusher, part.finishReason)
      }
    }
  } catch (err) {
    if (err instanceof SuspensionSignal) {
      await flusher.finalFlush()
      await persistSuspension(session, session.pendingSuspension!)
      await appendMessageFinish(session)
      return { reason: 'suspended' }
    }
    if (err.name === 'AbortError' && externalAbort.aborted) {
      await flusher.finalFlush()
      await appendAbortNotice(session)
      return { reason: 'aborted' }
    }
    return classifyAndMaybeRetry(session, err, flusher)
  }
}
```

### 7.2 `runLoop` flow

```ts
export async function runLoop(session: Session, externalAbort: AbortSignal): Promise<void> {
  while (true) {
    const result = await runSegment(session, externalAbort)
    session.meta.lastSegmentReason = result.reason
    await session.persistMeta()
    if (result.reason === 'tool-calls') continue
    return
  }
}
```

Single while-loop. The rule "tool-calls means continue" is the only continuation condition.

### 7.3 `TextFlushScheduler`

`src/agent/runtime/text-flush.ts`:

- `append(delta)`: adds to internal buffer; if no timer is running, starts a 250ms setTimeout.
- `flush()`: writes `part-update { messageId, partIndex, delta }` event with the current buffer; clears buffer and timer.
- `finalFlush()`: clears any pending timer; calls `flush()` synchronously; used at segment end.
- Per-message-part state: the scheduler is recreated per assistant message; each text part gets its own `partIndex`.

Unit tests (fake timers): short delta → final merge writes once; long delta → multiple flushes at 250ms intervals + final merge; zero delta → no write.

### 7.4 Error retry

`src/agent/runtime/retry.ts` (Phase 1 stub → Phase 2a real):

Retryable: HTTP 429, HTTP 529, network timeouts (ECONNRESET, ETIMEDOUT), fetch errors labeled as transient.

Non-retryable: HTTP 401, 403, 400, invalid API key errors (OpenRouter error code: `invalid_api_key`), abort signals, `prompt_too_long` (Phase 2a: fail; Phase 2b: auto-compact and retry), `SuspensionSignal` (not an error, just a control signal).

Backoff: 200ms, 800ms, 3200ms. Max 3 retries. Each retry logs to stderr for smoke-testing observability.

Wrapped around the `streamText` call inside `runSegment`; errors are caught, classified, and either re-thrown (`runSegment` handles them in its outer catch) or retried inline.

### 7.5 Error sanitization

Phase 1 already has `sanitize-error.ts` with a basic test. Phase 2a verifies it handles OpenRouter-specific error shapes (the `error.message` field from the OpenRouter HTTP response).

## 8. Permission System

### 8.1 `checkPermission` (pure, worker-local)

`src/agent/tools/check-permission.ts`:

```ts
export function checkPermission(
  session: Session,
  approvalClass: ApprovalClass,
  toolName: string,
  args: unknown,
): 'allow' | 'deny' | 'prompt-needed' {
  if (approvalClass === 'ui') return 'allow'   // pass-through

  const mode = session.meta.permissionMode
  if (mode === 'trust') return 'allow'

  // allowlist is approvalClass-level, session-scoped
  if (session.allowOnceClasses.has(approvalClass)) return 'allow'

  // singleUseApprovals is (toolName + argsHash)-level, consumed on hit
  const key = singleUseKey(toolName, args)
  if (session.singleUseApprovals.has(key)) {
    session.singleUseApprovals.delete(key)
    return 'allow'
  }

  if (mode === 'normal' && approvalClass === 'read') return 'allow'
  return 'prompt-needed'
}

export function singleUseKey(toolName: string, args: unknown): string {
  return `${toolName}:${hashJSON(args)}`
}
```

`session.allowOnceClasses: Set<ApprovalClass>` — persists per runtime session, not persisted to disk.
`session.singleUseApprovals: Set<string>` — single-use tokens keyed by `toolName:argsHash`; consumed on hit.

### 8.2 Resolution flow

When `checkPermission` returns `prompt-needed`:

1. Wrapper builds `SuspensionSpec { kind: 'permission', ... }` and pushes to `session.pendingSuspension`.
2. Wrapper writes `{__suspended: true, suspensionId}` placeholder tool-result event.
3. Wrapper throws `SuspensionSignal`.
4. `runSegment` catches → persists `suspension.json` → appends `message-finish` → returns `{reason: 'suspended'}`.
5. Worker sends `suspension-raised` IPC to main.
6. Main's `suspension-router` dispatches `permission.prompt` to renderer with the card payload.
7. Renderer shows PermissionCard; user clicks Allow / Allow Always / Deny.
8. Renderer sends `permission.respond { cardId, action }` to main.
9. Main updates session state based on action:
   - **Allow**: record `singleUseApprovals.add(key)` in worker (via a new `session-state-update` IPC message or by piggy-backing on `resolve-suspension`).
   - **Allow Always** (normal mode only, button hidden in strict): record `allowOnceClasses.add(approvalClass)`.
   - **Deny**: no state change.
10. Main sends `resolve-suspension { suspensionId, resolution: { kind: 'permission-allow' | 'permission-allow-always' | 'permission-deny' } }` to worker.
11. Worker appends a synthetic user message to the session: `"[User decision on prior tool call: allow|deny]"`. (Plan task will finalize exact wording; the key constraint is that the LLM sees a normal user turn, not an assistant correction.)
12. Worker calls `cleanupOrphanPlaceholders(session)` which emits a `part-rewrite` event replacing `{__suspended: true}` with `{resolved: true}` or `{error: 'user-denied'}`.
13. Worker deletes `suspension.json`, clears `pendingSuspension`.
14. Worker triggers a new `runLoop` iteration. If resolution was `allow` or `allow-always`, the LLM typically re-emits the same tool call, which this time passes `checkPermission` (via allowlist or single-use) and executes.

### 8.3 Single-use approval key collisions

`singleUseKey(toolName, args)` uses a stable JSON serialization of args. If the LLM re-emits a tool call with identical args, the key hits once and is then consumed. If the LLM re-emits with slightly different args (e.g., different surrounding whitespace), the key misses and a new prompt is raised — this is the safe behavior.

### 8.4 Mode switching mid-session

User can change permission mode on a session at any time via the UI. The IPC path is:

```
renderer → main (set-permission-mode { sessionId, mode }) → worker
```

Worker updates `session.meta.permissionMode`, persists meta.json, and clears `session.allowOnceClasses` (not `singleUseApprovals` — those are per-approved-action and shouldn't be invalidated by a mode change).

## 9. Suspension Framework

### 9.1 SuspensionSpec union

```ts
type SuspensionSpec =
  | { kind: 'question'; suspensionId; messageId; partIndex; toolCallId; question; choices? }
  | { kind: 'permission'; suspensionId; messageId; partIndex; toolCallId; toolName; approvalClass; summary; args }
  | { kind: 'plan-proposal'; suspensionId; messageId; partIndex; toolCallId; planText }

type SuspensionResolution =
  | { kind: 'question-answered'; answer: string | { __cancelled: true } }
  | { kind: 'permission-allow' }
  | { kind: 'permission-allow-always' }
  | { kind: 'permission-deny' }
  | { kind: 'plan-approved' }   // Phase 2b
  | { kind: 'plan-modified'; modifiedPlan: string }  // Phase 2b
  | { kind: 'plan-rejected'; reason?: string }  // Phase 2b
```

Phase 2a has real handlers for the four non-`plan-*` resolution kinds. The plan-* kinds exist in the type union and are matched in the switch with a branch that throws `Phase2bNotImplemented`.

### 9.2 `cleanupOrphanPlaceholders`

Runs at the start of every `runSegment`. Walks the session's uiMessages looking for `tool-result` parts where `result.__suspended === true` and `suspensionId` does not match the current `pendingSuspension.suspensionId`. For each orphan, emits a `part-rewrite` event that replaces the part with `{ error: 'suspension-orphaned' }` (this is a bug state — should never happen in a healthy run, but is recoverable).

The happy path is different: when a suspension is resolved, the worker explicitly emits a `part-rewrite` to replace that one placeholder with its real result (`{ resolved: true, answer: '...' }` for questions, `{ resolved: true }` or `{ error: 'user-denied' }` for permission). `cleanupOrphanPlaceholders` is the safety net for edge cases (crash during resolution, etc.).

### 9.3 `suspension.json` persistence

Written atomically (tmpfile + rename) when a SuspensionSignal is caught. Contains the full `SuspensionSpec`. Deleted after successful resolution.

On session open, if `suspension.json` exists, the session is in the "suspended" restart state and main re-raises the appropriate card without running any new segment.

## 10. UI

### 10.1 Chief-chat refactor

`src/renderer/src/components/chief-chat/chief-chat.tsx`: original Phase 1 code is rewritten in place to:

- Remove all dependence on the `appendAssistantStubReply` path.
- Subscribe to `chief:event` IPC for both persistent events (message-start/part-append/part-update/part-rewrite/message-finish) and renderer-only events (tool-exec-status).
- Maintain an in-memory message list built by replaying events since Phase 1 already has event-log→UIMessage replay logic — reuse it.
- Render each message via `message.tsx`, which reduces `parts[]` into `RenderNode[]` (pairing tool-call with tool-result by toolCallId) and renders each node with the appropriate component.

### 10.2 New components

```
src/renderer/src/components/chief-chat/
  message.tsx
  parts/
    text-part.tsx
    tool-call-pill.tsx
    tool-call-card.tsx
  cards/
    suspension-card-shell.tsx
    permission-card.tsx
    ask-card.tsx
  preferences/
    chief-agent-panel.tsx
```

### 10.3 `SuspensionCardShell` contract

Props:

```ts
interface SuspensionCardShellProps {
  title: string
  severity: 'info' | 'warning' | 'danger'
  actions: Array<{
    label: string
    kind: 'primary' | 'danger' | 'secondary'
    onClick: () => void
    shortcut?: 'enter' | 'escape'
  }>
  children: ReactNode
  onDismiss?: () => void
}
```

Responsibilities:
- Container styling by severity (info=blue, warning=amber, danger=red).
- Keyboard: Enter triggers the shortcut=enter action; Esc triggers onDismiss or shortcut=escape.
- Focus trap within the card while it is active.
- Single-submit protection: disables all actions after the first click until unmount.

### 10.4 `PermissionCard`

Title by approvalClass:
- read: "Chief Agent wants to read"
- write: "Chief Agent wants to write"
- exec: "Chief Agent wants to run"

Severity: read=info, write=warning, exec=danger.

Body: one-line `summary` from the manifest + collapsible "Show details" showing the full args.

Actions (left to right): Deny (secondary), Allow Always (secondary, only in normal mode), Allow (primary, Enter shortcut). Esc → Deny.

### 10.5 `AskCard`

Title: "Chief Agent is asking".
Severity: info.
Body: the question text + a radio list of choices (if provided) with an "Other (specify)" fallback input. Submit validates at least one choice or non-empty text.
Actions: Cancel (secondary, Esc shortcut), Submit (primary, Enter shortcut). Cancel sends `{ __cancelled: true }`.

### 10.6 `ToolCallPill` and `ToolCallCard`

Pill (compact): icon + tool name + 1–2 key args (e.g. "📖 Read src/foo.ts"). Click to expand into card.
Card (expanded): args JSON + result (if present) + status indicator (running / done / error).
Running state: rendered as pill by default with a subtle spinner; user can click to expand.

### 10.7 `TextPart`

Props: `text: string`, `isStreaming: boolean`. Renders text with a trailing blinking cursor when `isStreaming === true`. No markdown rendering in 2a (2b will add it). Text is escaped and rendered in monospace-friendly CSS.

`isStreaming` is derived: true if this is the last text part of the last assistant message AND the session has an active runLoop (session state from main).

### 10.8 Preferences panel

New `chief-agent-panel.tsx` in the Preferences layout:

- OpenRouter API Key: password input + Save button. Validates format (starts with `sk-or-`). On save, writes to secret-store.
- Model selector: dropdown populated from cached OpenRouter models list (`~/.oneship{,-dev}/cache/openrouter-models.json`, TTL 24h). Refresh button calls `/api/v1/models` and updates cache. Default selection: `anthropic/claude-sonnet-4.6`.
- Default Permission Mode: three radio buttons (Trust / Normal / Strict). Default: Normal.

### 10.9 Session-level permission mode toggle

A compact toggle in the chief-chat header shows the current session's mode and allows switching. Switching sends `set-permission-mode` IPC.

## 11. Main-side Subsystems

### 11.1 `secret-store.ts`

Abstraction layer: `getSecret(name)`, `setSecret(name, value)`, `deleteSecret(name)`. Phase 2a implementation backs onto `config.json` with file permissions `0600`. Phase V1 replacement (keytar) swaps only this file.

### 11.2 `chief-preferences.ts`

Reads and writes `config.chiefAgent` (distinct from `config.projects`). Exposes `getOpenRouterKey()`, `getModel()`, `getDefaultPermissionMode()`, and their setters.

### 11.3 `suspension-router.ts`

Subscribes to `suspension-raised` messages from worker. Dispatches by `spec.kind`:
- `question` → send `ask.prompt` to renderer
- `permission` → send `permission.prompt` to renderer
- `plan-proposal` → throw `Phase2bNotImplemented`

### 11.4 `tool-executors/bash.ts`

Calls into `TerminalManager` for one-shot command execution. Plan task should verify what API TerminalManager currently exposes — if it only has PTY-based interactive sessions, a thin wrapper for one-shot exec (child_process.spawn with the same env as the project shell) is added to TerminalManager.

Abort: the executor listens for `rpc.cancel` messages and kills the child process group.

### 11.5 `tool-executors/ask-user-question.ts`

Receives the tool-exec request, delegates to the suspension-router path (sends `ask.prompt` to renderer and suspends via worker's suspension channel, not by blocking). See §6.5 TODO for the final wiring decision.

## 12. IPC Protocol Extensions

New message types added to `src/shared/agent-protocol.ts`:

**Worker → Main**
- `suspension-raised { sessionId, spec: SuspensionSpec }`
- `rpc.request { kind: 'tool.exec', requestId, payload }`
- `rpc.cancel { requestId }`

**Main → Worker**
- `resolve-suspension { sessionId, suspensionId, resolution: SuspensionResolution }`
- `rpc.response { requestId, result: { ok, data | error } }`
- `set-permission-mode { sessionId, mode: PermissionMode }`
- `cancel-current-turn { sessionId }`

**Main → Renderer**
- `chief:event { ...LogEvent | tool-exec-status | permission.prompt | ask.prompt | permission.cancel | ask.cancel }`

**Renderer → Main**
- `permission.respond { cardId, action: 'allow' | 'allow-always' | 'deny' }`
- `ask.respond { cardId, answer: string | { __cancelled: true } }`
- `cancel-current-turn { sessionId }`
- `set-permission-mode { sessionId, mode }`

All RPC messages share one correlation table in `AgentHost` (keyed by `requestId`) with per-request timeout (default 60s, no timeout for in-flight Bash — the abort path handles those).

## 13. Persistence Deltas

### 13.1 New `part-rewrite` event

```ts
{ type: 'part-rewrite', messageId, partIndex, part: AgentUIMessagePart, timestamp }
```

Replay rule: on encountering `part-rewrite`, replace the part at `(messageId, partIndex)` entirely. If the message doesn't exist or the index is out of range, log a warning and skip (don't throw — replay must be tolerant).

### 13.2 `suspension.json` schema

One JSON file per session directory. Contains the full `SuspensionSpec`. Atomic write (tmpfile + rename). Deleted on resolution.

### 13.3 `SessionMeta` additions

Phase 1's SessionMeta already has `permissionMode`, `lastSegmentReason`, and `model`. Phase 2a:

- `model`: changes default from `'phase1-stub'` to whatever the session was opened with. New sessions read default from Preferences.
- `permissionMode`: actual runtime value, no longer hardcoded. New sessions read default from Preferences.
- No new fields in meta.json. `allowOnceClasses`, `singleUseApprovals`, `pendingSuspension` are in-memory only (except `pendingSuspension` which has its own `suspension.json`).

### 13.4 Single-session serialization

Session holds `currentRunPromise: Promise<void> | null`. `appendUserMessage + runLoop` checks this promise:
- null → claim it, run, finally clear.
- non-null → reject the new message with `{error: 'session-busy'}`; UI shows a toast "Chief Agent is still responding".

## 14. Testing Strategy

### 14.1 Unit tests (all green in CI)

Mock Vercel AI SDK `streamText` to return a controllable async iterator. Cover at minimum these branches in `runSegment` / `runLoop`:

1. Natural finish: text-delta events → finish with reason='stop' → segment returns natural.
2. Tool call happy path: text-delta → tool-call → local tool executes → tool-result → more text → finish='tool-calls' → runLoop continues → next segment finishes natural.
3. Suspension raised by permission prompt: tool-call → checkPermission returns prompt-needed → SuspensionSignal → runSegment returns suspended → runLoop returns.
4. Suspension raised by AskUserQuestion: same flow but kind='question'.
5. External abort: runSegment mid-stream → abortSignal fires → returns aborted.
6. Retryable error (429): streamText throws → retry layer backoff → second attempt succeeds.
7. Non-retryable error (401): streamText throws → returns error without retry.
8. Loop continuation rule: finishReason='tool-calls' without actual new tool_calls MUST still re-enter segment (invariant test).
9. Permission denied path: checkPermission returns prompt-needed → suspension → resolve-deny → cleanupOrphanPlaceholders rewrites to `{error: 'user-denied'}` → new segment.
10. `tool-exec-status` is sent but not persisted: assert the event log contains no `tool-exec-status` entries after a successful tool call.

Additional pure-function coverage:

- `checkPermission` truth table: 3 modes × 4 classes × (in allowlist, in single-use, neither) = 36 cases, all asserted.
- `TextFlushScheduler` timing: with fake timers, verify the 250ms flush, final merge, and zero-delta no-op behaviors.
- `singleUseKey(toolName, args)` stability: same args → same key; different args → different key.
- Path guard: allowed paths, denied paths (home dotfiles), relative path rejection, absolute path acceptance.
- Retry classification: 429, 529, 401, 400, network timeout, abort — each classified correctly.
- `cleanupOrphanPlaceholders`: orphan → rewrite to error; current suspension's placeholder → untouched.

### 14.2 Smoke test (opt-in, not in CI)

`src/agent/runtime/__tests__/phase2a-smoke.test.ts`:

- Reads `ONESHIP_OPENROUTER_TEST_KEY` from env. `it.skip` if absent.
- Test 1: sends a minimal "write a JS hello-world function" prompt with no tools → validates at least one text-delta received → finishReason='stop'.
- Test 2: sends "read /etc/hostname via the Read tool" with only Read registered → validates at least one tool-call received → validates args parseable as `{ file_path: '/etc/hostname' }` → validates tool-result received → finishReason='stop' or 'tool-calls'.
- Purpose: mock validity check. If this test fails, our streamText mock shape has drifted from the real SDK.
- Runs via `pnpm test:smoke` (new script).

### 14.3 Integration sketch (not in 2a — deferred to post-2a manual testing)

Full E2E testing via the Electron app is out of scope for automated testing in 2a. Validated by the six success criteria in §3 as manual smoke tests.

## 15. File Plan

### 15.1 New files

```
src/shared/
  tool-manifest.ts
  tool-guards/
    path-guard.ts
    index.ts

src/agent/runtime/
  run-segment.ts
  run-loop.ts
  text-flush.ts
  __tests__/
    run-segment.test.ts
    run-loop.test.ts
    text-flush.test.ts

src/agent/tools/
  registry.ts
  manifest-wrapper.ts
  check-permission.ts
  suspension-signal.ts
  read.ts
  glob.ts
  grep.ts
  web-fetch.ts
  write.ts
  edit.ts
  index.ts
  __tests__/
    check-permission.test.ts
    manifest-wrapper.test.ts
    read.test.ts
    write.test.ts
    edit.test.ts
    grep.test.ts
    glob.test.ts

src/main/
  chief-preferences.ts
  secret-store.ts
  suspension-router.ts
  permission-reconciler.ts
  tool-executors/
    bash.ts
    ask-user-question.ts
    index.ts
  __tests__/
    chief-preferences.test.ts
    secret-store.test.ts
    suspension-router.test.ts
    bash-executor.test.ts

src/renderer/src/components/chief-chat/
  message.tsx
  parts/
    text-part.tsx
    tool-call-pill.tsx
    tool-call-card.tsx
  cards/
    suspension-card-shell.tsx
    permission-card.tsx
    ask-card.tsx
  preferences/
    chief-agent-panel.tsx
```

### 15.2 Modified files

```
src/agent/runtime/loop.ts             # becomes re-export of run-loop
src/agent/runtime/model.ts            # fill in getModel with createOpenRouter
src/agent/runtime/retry.ts            # fill in withRetry
src/agent/context/system-prompt.ts    # fill in buildSystemMessages
src/agent/ipc/rpc-client.ts           # fill in rpcCall
src/agent/session/session.ts          # + allowOnceClasses / singleUseApprovals / pendingSuspension; DELETE appendAssistantStubReply
src/agent/services/event-log.ts       # + part-rewrite support
src/agent/services/conversation-store.ts  # DELETE (if not referenced) or strip Phase1NotImplemented
src/main/agent-host.ts                # + rpc handling, resolve-suspension, set-permission-mode
src/main/index.ts                     # register suspension-router, permission-reconciler, tool-executors; Preferences menu
src/shared/agent-protocol.ts          # + SuspensionSpec/Resolution/RpcRequest/etc.
src/renderer/src/components/chief-chat/chief-chat.tsx  # rewrite in place
```

### 15.3 Deletions

```
# Phase 1 stub scaffolding:
# - Phase1NotImplemented class definition and all throw sites
# - appendAssistantStubReply method and all call sites
# - Any Phase-1-stub loading indicators or fallback UI
# - Any test code that asserts on stub reply shape
```

Acceptance: `grep -rn "Phase1NotImplemented\|appendAssistantStubReply" src/` returns zero matches.

## 16. Risks

1. **Vercel AI SDK v6 `experimental_context` behavior in mocks.** Our tool executors rely on `ctx.experimental_context.session` being the real Session instance. If our mock of `streamText` passes this differently from the real SDK, unit tests pass but production fails. Mitigation: the smoke test in §14.2 validates that real SDK invocation still wires context through.
2. **OpenRouter tool-call quirks with Anthropic models.** OpenRouter proxies to provider APIs, and Anthropic's tool-calling format has some headers (e.g. prompt caching) that behave differently via OpenRouter than via direct Anthropic API. Phase 2a does NOT test cache-control behavior; §7.1 static prompt caching may silently not cache through OpenRouter. Mitigation: accept the uncached cost for Phase 2a; Phase 2b verifies cache hits via `x-openrouter-cost` headers.
3. **Bash abort propagation to child process.** `TerminalManager` may not currently expose a "kill just this child" API; if not, the plan must add one. Validation task in the plan.
4. **Ambiguity in AskUserQuestion suspension raising location (worker vs main).** Flagged in §6.5 — final decision deferred to plan task T-05.

## 17. Open Questions (must be resolved during plan writing)

1. Does `TerminalManager` already have a one-shot exec API? (§11.4 decision)
2. Does the AskUserQuestion tool raise its suspension worker-side or main-side? (§6.5 decision)
3. What exact wording does the synthetic user message take for each resolution kind? (§8.2 step 11)
4. Is `/tmp` the right "allowed outside workspace" path, or should it be more restrictive? (§6.4 decision)
5. Should the Preferences panel require an API key before enabling Chief Agent at all, or allow a read-only "no key configured" state? (UX decision)

## 18. References

- Parent spec: `docs/superpowers/specs/2026-04-14-chief-agent-design.md` (§5 runtime, §6 tools, §6.3a execution topology, §7 context, §12 permission, §15.5 suspension, §18.1 MVP checklist)
- Phase 1 plan: `docs/superpowers/plans/2026-04-14-chief-agent-phase1-skeleton.md`
- Vercel AI SDK v6 docs (external): `streamText` API, `fullStream` part shapes, `experimental_context`
- cc-src loop rule: "if last segment finished with tool-calls, continue next segment"
- OpenRouter API: `/api/v1/models`, `/api/v1/chat/completions`
