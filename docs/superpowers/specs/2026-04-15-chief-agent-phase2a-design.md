# Chief Agent Phase 2a — Design Spec

**Scope:** First usable LLM-driven slice of Chief Agent. Real OpenRouter streaming, eight tools (Read, Glob, Grep, WebFetch, Write, Edit, Bash, AskUserQuestion), permission + suspension framework, minimal UI, stub cleanup.

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
2. **Permission is unified with the suspension protocol.** The parent spec §15.5 already puts permission on the suspension path (historically "cautious"); Phase 2a confirms this and rejects the alternative of a separate synchronous RPC for permission. Both `AskUserQuestion` and permission prompts raise a `SuspensionSpec`, end the segment, and resume via `resolve-suspension` + a placeholder rewrite. **No synthetic user message is appended for question or permission resolutions** — the resolution is carried entirely by the rewritten `tool_result`, which is protocol-correct per the Anthropic tool_use/tool_result pairing invariant (§15.5). Only plan resolutions append a synthetic user message.
3. **Permission check runs in the worker.** `checkPermission(mode, approvalClass, allowlist, singleUse)` is a pure function local to the worker. Main owns the policy source of truth (the default permission mode in Preferences, and the `set-permission-mode` IPC), but runtime evaluation happens where the tool is about to execute. This keeps the worker from having to round-trip to main on every `read`-class tool call in trust/normal modes (which is the common case).
4. **Permission mode is widened from two values to three.** Parent spec §12.1 and §15.1 define `PermissionMode = 'trust' | 'cautious'`, and Phase 1 ships that exact type in `src/shared/agent-protocol.ts:36`. Phase 2a replaces it with `PermissionMode = 'trust' | 'normal' | 'strict'`. The rename is intentional: "cautious" was a single mode doing two jobs (prompt for write/exec, which `normal` now does; prompt for everything, which `strict` now does). The parent spec's §12.2 "cautious approval flow" is **retired and superseded by §8** of this document. Phase 2a plan must: widen the `PermissionMode` type in `src/shared/agent-protocol.ts`, retire any remaining `'cautious'` string literals, update the parent spec §12 to point at §8, and migrate any in-flight session meta.json that still carries `'cautious'` — Phase 1 hardcodes `'trust'` on session creation and never writes `'cautious'`, so no disk migration is required, only code migration.
5. **Event log stays at four event types; `part-update` does all placeholder rewrites and text-buffer flushes.** Parent spec §15.2.1 explicitly reserves `part-update` for "tool-result placeholder rewrites" and §15.2.3 explicitly names `part-update` as the event that gets batched for streaming text. Phase 1 already exports the `part-update` schema in `src/agent/services/event-log.ts` and already handles it in `replay()` in `src/agent/services/conversation-store.ts` with the exact bounds check Phase 2a needs. Phase 2a implements `writePartUpdate` (which Phase 1 stubs as `Phase1NotImplemented`) and uses it for both text-delta flushes and suspension-resolved placeholder rewrites. No new event type is introduced.
6. **Streaming text persistence uses the parent spec's 50ms time-window flush.** Parent §15.2.3 pins it: "the dispatcher batches consecutive `part-update` events targeting the same text part within a 50ms window into a single write". Phase 2a honors this window exactly. `TextFlushScheduler` buffers `text-delta` fragments in memory, flushes a `part-update` event (containing the **accumulated** text-part with all deltas so far) every 50ms, and merges any residual buffer into the final write that precedes `message-finish`. `message-finish` is the only event in the assistant-text path that forces `fsync`.
7. **Tool call and tool result are stored as two separate parts.** Parent spec §15.2.1 lists `part-append` for tool parts but doesn't explicitly address pairing. Phase 2a pins: `tool-call` and `tool-result` are separate `part-append` events (one each), paired in the UI layer by `toolCallId`. This follows the native shape of Vercel AI SDK `fullStream` and avoids a transformation step in the worker.
8. **Live tool-exec status is renderer-only.** Phase 2a adds a `tool-exec-status { toolCallId, state: 'running' | 'done' | 'error' }` message sent from worker to main to renderer. It is NOT persisted to the event log. On replay, a tool-call without a corresponding tool-result is rendered as "recovering..." rather than "running".
9. **Permission `ui` class is pass-through.** `AskUserQuestion` has `approvalClass: 'ui'`, and the permission truth table (§6.3a) routes `ui` to `allow` without prompting. AskCard is raised by the tool itself via the suspension protocol, not by permission gating.
10. **`SegmentFinishReason` must be widened to include `'tool-calls'`.** Parent spec §5.4 implies a `'tool-calls'` reason ("`runLoop` continues when the last segment finished via tool-calls"), but Phase 1 ships `SegmentFinishReason = 'natural' | 'suspended' | 'step-cap' | 'aborted' | 'error'` in `src/shared/agent-protocol.ts:42` — no `'tool-calls'` value. Phase 2a adds `'tool-calls'` to the union. This is the only field `runSegment` returns that `runLoop` uses to decide continuation. (The parent spec called it "the only continuation condition"; Phase 1 left the literal value out because it had no live LLM to emit it.)
11. **Single session is strictly serial.** Parent spec §15.4 permits concurrent segments with a semaphore cap of 4. Phase 2a pins one session to one runLoop at a time. A second user message while a runLoop is in flight is rejected with a UI notice. Cross-session concurrency is allowed but not exercised in Phase 2a.

## 5. Architecture Overview

### 5.1 Execution flow for a typical turn

1. **User sends a message.** Renderer → main → worker as `chief:send` IPC. Worker's `Session.appendUserMessage` writes `message-start` + `part-append(text)` + `message-finish` to the event log, then triggers `runLoop(session, abort)`.
2. **runLoop calls runSegment.** `runSegment` calls `cleanupOrphanPlaceholders(session)` first, then builds system messages via `buildSystemMessages(session)`, builds the tool set via `allTools(session)`, and calls `streamText({ model, messages, tools, stopWhen: stepCountIs(50), abortSignal: combined })`.
3. **Worker consumes `fullStream`.** For each part type:
   - `text-delta`: append to `TextFlushScheduler` buffer; flush every 50ms as `part-update` (per parent §15.2.3; the batched event carries the accumulated text part, not a delta).
   - `tool-call`: write `part-append(tool-call)`; send `tool-exec-status { state: 'running' }` to main.
   - `tool-result`: write `part-append(tool-result)`; send `tool-exec-status { state: 'done' | 'error' }`.
   - `finish`: note `finishReason`.
4. **Tool call execution.** When Vercel AI SDK invokes `tool.execute(args, ctx)`:
   - `manifest-wrapper` looks up the manifest entry, validates args against the schema, computes `summary`.
   - `checkPermission(session, manifest.approvalClass, manifest.name, args)` returns one of exactly two values: `allow` or `prompt-needed`. (There is no `deny` return — user denials live in the rewritten tool_result after a resolved suspension, not in a denial cache. See §8.1.)
   - **allow**: for `execution: 'local'`, run the inner executor; for `execution: 'rpc'`, send `rpc.request { kind: 'tool.exec' }` and await the response. Either path returns the raw tool output, or `{error, hint?}` if the executor throws.
   - **prompt-needed**: push a `permission` SuspensionSpec to `session.pendingSuspension`, write a `{__suspended: true}` placeholder tool-result via `part-append`, throw `SuspensionSignal`. `runSegment` catches the signal, persists `suspension.json`, and returns `{ reason: 'suspended' }`. The actual tool execution happens later, inside the resolution handler (§8.2 step 10b), not by retrying this code path.
5. **Suspending tools (AskUserQuestion).** `AskUserQuestion` is `execution: 'local'`, `approvalClass: 'ui'` per the parent spec §6.3a assignment (updated 2026-04-15). It is a worker-side control-flow tool, colocated with other suspending tools. When the LLM invokes it, the wrapper pushes a `{ kind: 'question' }` SuspensionSpec onto `session.pendingSuspension`, writes a `{__suspended: true}` placeholder via `part-append`, and throws `SuspensionSignal`. `runSegment` catches the signal and ends the segment through the same code path as permission suspensions. Main's `suspension-router` receives the `suspension-raised` IPC and dispatches `ask.prompt` to the renderer for UI mediation — main is never the executor of the tool, only the host of the card.
6. **runLoop follows finish reason.** `tool-calls` → continue to next segment. Anything else → persist `lastSegmentReason` and return.
7. **Suspension resolution.** Main's `suspension-router` receives `suspension-raised`, looks at `spec.kind`, dispatches `permission.prompt` or `ask.prompt` to the renderer. Renderer shows the appropriate card. User action → `resolve-suspension` IPC back to main → main builds the resolution + optional `stateUpdate` → main forwards `resolve-suspension` to worker → worker's resolution handler applies `stateUpdate`, then:
   - For **question-answered**: emits a `part-update` rewriting the `__suspended` placeholder to `{resolved: true, answer}`.
   - For **permission-allow / permission-allow-always**: **invokes the tool's real `execute(args)` now**, outside any `runSegment`, using a synthesized `ExecContext`. Captures the real output. Emits a `part-update` rewriting the placeholder to the actual tool output (or `{error, hint?}` if the executor throws).
   - For **permission-deny**: emits a `part-update` rewriting the placeholder to `{error: 'user-denied'}`.
   Worker deletes `suspension.json`, clears `pendingSuspension`, then triggers a new `runLoop` iteration. No synthetic user message is appended in any of these paths. (`cleanupOrphanPlaceholders` is a separate safety net for orphans from crashed sessions; see §9.2 — it does NOT perform the happy-path rewrite.)

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
  AskUserQuestion: { ... execution: 'local', approvalClass: 'ui', ... },
}
```

Worker imports `TOOL_MANIFESTS` to build its `allTools()` registry (filtering by `execution === 'local'`). Main imports `TOOL_MANIFESTS` to build the `tool-executors` registry (filtering by `execution === 'rpc'`).

### 6.1a Normative `ToolResult` shape

Phase 2a tool results are discriminated at the **top-level keys**, not wrapped in a success tag. A successful tool returns its raw payload; only non-success cases carry a discriminator. This matches cc-src's and Vercel AI SDK's convention — the LLM sees raw tool output in the success case, not a `{ok: true, data: ...}` envelope.

```ts
// The "happy" case is raw. These are the non-raw discriminators:
type ToolResultDiscriminator =
  | { __suspended: true; suspensionId: string }           // placeholder; replaced via part-update on resolution
  | { resolved: true; answer: string }                    // question-answered resolution; answer is REQUIRED and string
  | { error: string; hint?: string }                      // tool rejected, failed, or was cancelled
```

Rules:

- **Success** — the tool's inner `execute(args)` returns whatever the tool naturally produces (a string for `Read`, a `{stdout, stderr, exitCode}` object for `Bash`, an array for `Glob`, etc.). The wrapper in §6.2 passes this through unchanged; no envelope is added. The LLM sees the natural shape, as it would with any Claude Code tool.
- **Error** — the wrapper catches any thrown error (or intercepts pre-execution guard rejections) and returns `{error: <code>, hint?: <detail>}`. The `error` field is a stable short code; `hint` is optional freeform context (stdout tail, file path, etc.). User cancellations also use this shape.
- **Suspended** — the wrapper sets `{__suspended: true, suspensionId}` as the placeholder tool-result BEFORE throwing `SuspensionSignal`. This is written to the event log via `part-append`, then later replaced via `part-update` when the suspension resolves.
- **Resolved** — used **only** for `question-answered` resolutions where the user actually submitted an answer. Emits a `part-update` replacing the placeholder with `{resolved: true, answer: <string>}`. The `answer` field is required and is always a `string` — the user's selected choice label or freeform input. Cancellations of an AskUserQuestion do NOT use this shape; they go through the suspended-card cancel path (§13.4) and rewrite to `{error: 'user-cancelled-question'}` instead. Permission-allow resolutions do NOT use this shape either — they rewrite to the real tool output (see §8.2 step 10b). Permission-deny rewrites to `{error: 'user-denied'}`.

**Disambiguation guarantee**: a tool's natural success payload MUST NOT have any top-level key named `__suspended`, `resolved`, or `error`. For Phase 2a's eight tools this is trivially true (none have such keys). A lint/test rule is added that rejects any new tool whose manifest-defined output schema includes one of these reserved keys at top level. This preserves the "success = anything not matching a discriminator" invariant without a wrapper.

Error codes Phase 2a is expected to emit (non-exhaustive but all must be discriminable):
- `'user-denied'` — permission was denied via PermissionCard
- `'user-cancelled'` — permission card was cancelled (Stop) before the user clicked Allow/Deny
- `'user-cancelled-question'` — AskCard was cancelled (Stop or Cancel button) before the user submitted an answer
- `'suspension-orphaned'` — cleanupOrphanPlaceholders reclaimed a stale placeholder
- `'path-guard: <reason>'` — shared path-guard rejected the path (e.g. `'path-guard: outside workspace'`)
- `'invalid-args: <reason>'` — zod schema validation failed
- `'exec-failed: <reason>'` — Bash or similar tool exited with non-zero (hint carries stdout/stderr tail)
- any tool-specific runtime error, sanitized by sanitize-error.ts before the `error` field is filled in

UI renderers and replay code can always distinguish the four states with a single top-key probe: check `__suspended`, then `resolved`, then `error`, otherwise treat as raw success value (tool-specific shape).

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
        try {
          guardArgs(manifest, args)  // shared tool-guards; may throw PathGuardError
          return await inner(args, ctx)  // raw tool-specific payload — §6.1a success case
        } catch (err) {
          if (err instanceof PathGuardError) {
            return { error: `path-guard: ${err.reason}` }
          }
          return { error: sanitizeErrorCode(err), hint: sanitizeErrorHint(err) }
        }
      }

      // decision === 'prompt-needed' — raise a permission suspension.
      // (There is no 'deny' return from checkPermission; §12.2 / §8.1.)
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
  // Same permission-check prelude as wrapLocalTool. On allow: send
  // rpc.request { kind: 'tool.exec' } and await response. On success the
  // response payload is returned raw. On error the wrapper converts the
  // rpc.response error into { error, hint? } per §6.1a. On deny and
  // prompt-needed the wrapper behaves identically to wrapLocalTool.
}
```

**Return shape invariant (per §6.1a):** the allow-path returns exactly what `inner(args, ctx)` returns — no envelope, no `{ok: true, data: ...}` wrapping. Any error thrown by `inner` (including guard rejections and tool-specific runtime errors) is caught and turned into `{error, hint?}`. The LLM sees the raw natural shape on success and the discriminated error shape on failure. This matches cc-src/Claude Code conventions and Vercel AI SDK's default contract.

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

Each of the eight tools gets its own file. Phase 2a implementations are MVP-shaped (no advanced features):

- **Read** (`src/agent/tools/read.ts`): file_path (required), offset, limit. Returns file contents as a string. Honors path guard.
- **Glob** (`src/agent/tools/glob.ts`): pattern (required), path (optional). Returns matching paths. Uses `fast-glob` (already in dependency tree? — verify during plan).
- **Grep** (`src/agent/tools/grep.ts`): pattern (required), path, glob filter, `-i`, `-C`, `output_mode`. Uses `rg` if available, falls back to Node regex. Returns match lines.
- **WebFetch** (`src/agent/tools/web-fetch.ts`): url (required), optional prompt for summarization. Returns HTML → markdown-converted text. No LLM re-summarization in 2a (that's a Phase 2b refinement).
- **Write** (`src/agent/tools/write.ts`): file_path (required), content (required). Always overwrites. Honors path guard. Triggers write approval.
- **Edit** (`src/agent/tools/edit.ts`): file_path (required), old_string (required), new_string (required), replace_all (optional). Honors path guard. Triggers write approval.
- **Bash** (`src/main/tool-executors/bash.ts`): cmd (required), cwd (optional, defaults to project root). Uses the existing `TerminalManager` — Phase 2a adds a `runOneShot` method to TerminalManager if one doesn't already exist. Streams stdout/stderr into a string buffer, returns `{ stdout, stderr, exitCode }` when the command exits. Honors an abort signal passed through the rpc envelope. Triggers exec approval.
- **AskUserQuestion** (`src/agent/tools/ask-user-question.ts`): worker-side control-flow tool, `execution: 'local'`, `approvalClass: 'ui'`. Per the parent spec §6.3a assignment (updated 2026-04-15), `ui`-class tools pass through the permission check and run their own suspension instead. The tool wrapper pushes a `SuspensionSpec { kind: 'question', ... }` onto `session.pendingSuspension`, writes a `{__suspended: true, suspensionId}` placeholder tool-result via `part-append`, and throws `SuspensionSignal`. `runSegment` catches the signal and ends the segment. Main receives `suspension-raised`, dispatches `ask.prompt { cardId, question, choices }` to the renderer, waits for `ask.respond`, and sends `resolve-suspension { kind: 'question-answered', answer }` back to the worker. The worker emits a `part-update` replacing the placeholder with `{ resolved: true, answer }` per §8.2 step 12, then triggers a new `runLoop` iteration. No IPC round-trip for the suspension itself — it stays worker-raised.

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
        case 'finish': return await finishSegment(session, flusher, part.finishReason)
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

**`finishSegment(session, flusher, finishReason, stepCount)` mapping.** The SDK's `finishReason` alone is not enough to distinguish "natural tool-calls continuation" from "step cap reached", because Vercel AI SDK v6 reports both as `finishReason: 'tool-calls'` — the `stopWhen: stepCountIs(50)` mechanism stops the stream after emitting that finishReason. `finishSegment` therefore takes `stepCount` as an extra argument (read from `result.steps.length` on the streamText result, or tracked by `runSegment` incrementing a counter on each `tool-call` part) and uses it as a tiebreaker.

| SDK `finishReason` | Condition | Returns | Notes |
|---|---|---|---|
| `'stop'` | — | `{ reason: 'natural' }` | LLM emitted end-of-turn naturally |
| `'tool-calls'` | `stepCount < 50` | `{ reason: 'tool-calls' }` | runLoop continues to next segment |
| `'tool-calls'` | `stepCount >= 50` | `{ reason: 'step-cap' }` | stepCountIs(50) fired; matches Phase 1's existing `'step-cap'` enum value |
| `'length'` | — | `{ reason: 'error', error: 'context-length-exceeded' }` | max tokens reached mid-reply; Phase 2a treats as error (Phase 2b auto-compact) |
| `'content-filter'` | — | `{ reason: 'error', error: 'content-filter' }` | Anthropic content policy; surface to user |
| `'error'` | — | `{ reason: 'error', error: sanitized }` | some SDK versions emit this — sanitize via existing `sanitize-error.ts` before returning. Other versions surface errors via thrown exceptions caught in the outer catch; both paths are handled |
| `'other'` / unknown | — | `{ reason: 'error', error: 'unknown-finish-reason' }` | Safety fallback; logs the raw value |

In every case, `finishSegment` runs `await flusher.finalFlush()` and `await appendMessageFinish(session)` before returning, to ensure the last text buffer is persisted and the message is marked complete.

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

- `append(delta)`: accumulates the fragment into an internal string buffer; if no timer is running, starts a 50ms `setTimeout`.
- `flush()`: writes a `part-update { messageId, partIndex, part: { type: 'text', text: <accumulated> } }` event to the event log. The `part` carries the **full accumulated text of this text-part** (parent spec §15.2 shape — `part-update` replaces the part at `partIndex`, it is not a delta patch). Clears the buffer timer but KEEPS the accumulated string — subsequent appends continue to grow it so the next flush sees the whole string, not just new fragments.
- `finalFlush()`: clears any pending timer; calls `flush()` synchronously; used at segment end to merge residual buffer into the final write before `message-finish`.
- Per-message-part state: the scheduler is recreated per assistant text part; each text part gets its own `partIndex` and its own accumulated string.

Event-log shape note: because `part-update` carries the full text each time, crash-time replay automatically gets the latest snapshot of the streaming text up to the last successful flush, no reconciliation needed.

Unit tests (fake timers): short delta → final merge writes once; long delta → multiple flushes at 50ms intervals + final merge; zero delta → no write; accumulation across flushes → second flush carries full string, not just new fragment.

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
): 'allow' | 'prompt-needed' {
  // Pass-through for ui class, regardless of mode. AskUserQuestion is
  // ALREADY a user-interaction mechanism — layering a permission prompt on
  // top is a double interruption with zero information value. See §12.1.
  if (approvalClass === 'ui') return 'allow'

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

**No `deny` return value.** The permission system does not maintain a denial cache in Phase 2a. When a user denies a permission prompt, the resolved tool_result (rewritten from the `__suspended` placeholder) carries `{error: 'user-denied'}` — the LLM sees this in its next segment's history and decides how to react. A subsequent identical tool call would trigger a fresh permission prompt. YAGNI: single-use deny tokens would require a new data structure and a new UI button, and Phase 2a has no feature that needs them.

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
7. Renderer shows PermissionCard; user clicks Allow / Allow Always (normal mode only, hidden in strict) / Deny.
8. Renderer sends `permission.respond { cardId, action }` to main.
9. Main builds the resolution + optional `stateUpdate` and sends `resolve-suspension { suspensionId, resolution, stateUpdate? }` to worker:
   - **Allow** → `resolution: { kind: 'permission-allow' }`, no `stateUpdate` needed (the tool will be executed during resolution, so no need to cache an allow for "next time").
   - **Allow Always** → `resolution: { kind: 'permission-allow-always' }`, `stateUpdate: { addAllowOnceClass: <approvalClass> }`.
   - **Deny** → `resolution: { kind: 'permission-deny' }`, no `stateUpdate`.

   Note: `singleUseApprovals` is no longer used in the Allow flow under the current design — because the tool runs **during** resolution (step 10 below), there's no "next tool call" that needs a cached allow. `singleUseApprovals` remains in `checkPermission` only as an escape hatch for scenarios that send a stateUpdate for some reason (none in Phase 2a); the set will usually be empty.

10. Worker's **resolution handler** (not in any `runSegment`):
    a. Applies `stateUpdate` (if present) — adds `approvalClass` to `session.allowOnceClasses`.
    b. Builds the resolved tool_result according to the resolution kind:
       - **permission-allow / permission-allow-always**: creates a **new `AbortController` and assigns it to `session.currentResolutionAbortController`**. This is distinct from `session.currentAbortController`, which is `null` at this point (the previous `runLoop` that raised the suspension already returned and cleared it in its `finally`). Synthesizes an `ExecContext` using the session, the toolCallId from the SuspensionSpec, and the new controller's `signal`. **Invokes the tool's real executor** — for `execution: 'local'` tools, calls the inner function directly; for `execution: 'rpc'` tools, sends `rpc.request { kind: 'tool.exec' }` to main and awaits the response (the rpc envelope carries `rpc.cancel` plumbing so main can propagate abort to the child process). The resolved tool_result is the real output on success, or `{error, hint?}` on failure (the wrapper's normal error path, see §6.2). **The guard check (path-guard etc.) still runs** — the resolution handler reuses the same `wrap*Tool`-style preamble to ensure the deferred execution gets the same safety checks as a regular invocation. Regardless of outcome, the `finally` block clears `session.currentResolutionAbortController = null`.
       - **permission-deny**: resolved tool_result is `{error: 'user-denied'}`. No AbortController involvement — no tool executes.
    c. Emits a single `part-update` event at the placeholder's known `(messageId, partIndex)`, replacing `{__suspended: true, ...}` with the resolved tool_result.
    d. Deletes `suspension.json`, clears `pendingSuspension`.
11. Worker triggers a new `runLoop` iteration. The LLM's history now contains a normal `tool_use → tool_result` pair: either the real tool output (Allow / Allow Always) or `{error: 'user-denied'}` (Deny). **No synthetic user message is appended.** The Anthropic Messages API requires exactly one `tool_result` for each `tool_use`; the rewrite IS that `tool_result`, and appending a user message would violate the pairing invariant (parent spec §15.5).
12. On the next segment, the LLM decides what to do based entirely on the rewritten tool_result. For Allow, it sees the real output and continues. For Deny, it sees the error and typically chooses a different approach.

**Tool execution happens during resolution, not on a subsequent re-emit.** This is a deliberate choice: relying on the LLM to re-emit an identical tool call is fragile (it may re-emit with different args, or not re-emit at all). Executing during resolution guarantees that one user "Allow" click produces exactly one tool execution.

### 8.3 Single-use approval key — reserved for forward compat

`singleUseKey(toolName, args)` uses a stable JSON serialization of args to produce a deterministic per-call key. Phase 2a does not use this mechanism on the Allow path (Allow executes the tool immediately during resolution — see §8.2 step 10b — so there's no "next call" to cache for). The helper is kept in `check-permission.ts` and consulted on every call because a future scenario (Phase 2b+) may want to pre-approve an upcoming call without executing it yet. For Phase 2a the set is always empty in practice; `checkPermission`'s rule 4 is exercised only by the unit tests (§14.1).

### 8.4 Mode switching mid-session

User can change permission mode on a session at any time via the UI. The IPC path is:

```
renderer → main (set-permission-mode { sessionId, mode }) → worker
```

Worker updates `session.meta.permissionMode`, persists meta.json, and **clears both `session.allowOnceClasses` and `session.singleUseApprovals`**. Reason: changing the mode is the user declaring a new policy. The old allowlist was consented under the old mode; carrying it into the new mode creates a bypass (e.g., "I clicked Allow Always for exec in Normal, then switched to Strict — my Strict session silently allows exec without prompting"). Clearing both sets on every mode change makes the policy change deterministic and matches §12.1 of the parent spec.

## 9. Suspension Framework

### 9.1 SuspensionSpec union

```ts
type SuspensionSpec =
  | { kind: 'question'; suspensionId; messageId; partIndex; toolCallId; question; choices? }
  | { kind: 'permission'; suspensionId; messageId; partIndex; toolCallId; toolName; approvalClass; summary; args }
  | { kind: 'plan-proposal'; suspensionId; messageId; partIndex; toolCallId; planText }

type SuspensionResolution =
  | { kind: 'question-answered'; answer: string }   // user submitted; answer is REQUIRED string
  | { kind: 'permission-allow' }
  | { kind: 'permission-allow-always' }
  | { kind: 'permission-deny' }
  | { kind: 'plan-approved' }                       // Phase 2b
  | { kind: 'plan-modified'; modifiedPlan: string } // Phase 2b
  | { kind: 'plan-rejected'; reason?: string }      // Phase 2b
```

There is intentionally **no `question-cancelled` kind** in the union. AskCard cancellations don't go through `resolve-suspension` at all — they go through the `cancel-current-turn` IPC and the worker's `cancelSuspendedCard()` path (§13.4), which directly rewrites the placeholder to `{error: 'user-cancelled-question'}` without sending a fake "answer". Same for PermissionCard cancellations: they rewrite to `{error: 'user-cancelled'}`. This keeps the "user explicitly answered" path strictly separate from the "user cancelled / ran out of patience" path.

Phase 2a has real handlers for the four non-`plan-*` resolution kinds. The plan-* kinds exist in the type union and are matched in the switch with a branch that throws `Phase2bNotImplemented`.

### 9.2 `cleanupOrphanPlaceholders`

**Invariant (must hold):** two code paths rewrite `__suspended` placeholders, and they never operate on the same placeholder:

1. **Happy-path explicit rewrite** (§8.2 step 12): when a suspension resolves, the resolution handler emits one `part-update` targeting exactly the `(messageId, partIndex)` recorded on the `SuspensionSpec`. This handles the one placeholder whose resolution just arrived.

2. **Orphan sweep**: `cleanupOrphanPlaceholders(session)` runs at the start of every `runSegment`. It walks the session's uiMessages looking for `tool-result` parts where `result.__suspended === true` AND `result.suspensionId` does NOT match `session.pendingSuspension?.suspensionId`. These are **orphans** — placeholders for suspensions that no longer exist (because a crash interrupted their resolution, or a manual `suspension.json` delete left the disk state inconsistent). For each orphan, the sweep emits a `part-update` that replaces the part with `{ error: 'suspension-orphaned' }`.

The guarantee: the explicit path (1) runs before `cleanupOrphanPlaceholders`, and the explicit path clears `session.pendingSuspension`. By the time the sweep runs at the next `runSegment`, the newly-resolved placeholder is no longer a placeholder — it's already been rewritten to its resolved value. The sweep will never re-touch it.

Orphans should not appear in a healthy run. When they do, the `{ error: 'suspension-orphaned' }` result shows up in the LLM history as a regular tool-error, the model decides how to proceed, and the session remains usable.

### 9.3 `suspension.json` persistence

Written atomically (tmpfile + rename) when a SuspensionSignal is caught. Contains the full `SuspensionSpec`. Deleted after successful resolution.

On session open, if `suspension.json` exists, the session is in the "suspended" restart state and main re-raises the appropriate card without running any new segment.

## 10. UI

### 10.1 Chief-chat refactor

`src/renderer/src/components/chief-chat/chief-chat.tsx`: original Phase 1 code is rewritten in place to:

- Remove all dependence on the `appendAssistantStubReply` path.
- Subscribe to `chief:event` IPC for both persistent events (message-start/part-append/part-update/message-finish) and renderer-only events (tool-exec-status).
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
Actions: Cancel (secondary, Esc shortcut), Submit (primary, Enter shortcut). **Submit** sends `ask.respond { cardId, answer: <string> }` to main with the user's selected choice or freeform text. **Cancel** is **equivalent to clicking Stop in the chief-chat header** — it sends `cancel-current-turn { sessionId }` to main, which routes through the suspended-card cancel path in §13.4 and ends up rewriting the placeholder to `{error: 'user-cancelled-question'}`. The worker never sees a "fake answer carrying a cancellation flag" — that shape does not exist on the wire.

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

### 11.5 Main-side role for AskUserQuestion

AskUserQuestion lives in `src/agent/tools/ask-user-question.ts` (worker-side, per §6.5 and the parent spec §6.3a assignment). Main does not have an executor for it — main's only role is:

1. Receive `suspension-raised` with `spec.kind === 'question'` from the worker.
2. Dispatch `ask.prompt { cardId, question, choices }` to the renderer via `chief:event`.
3. Receive `ask.respond { cardId, answer }` from the renderer.
4. Send `resolve-suspension { suspensionId, resolution: { kind: 'question-answered', answer } }` to the worker.

All of this happens in `suspension-router.ts`; no file under `src/main/tool-executors/` is needed for AskUserQuestion.

## 12. IPC Protocol Extensions

New message types added to `src/shared/agent-protocol.ts`:

**Worker → Main**
- `suspension-raised { sessionId, spec: SuspensionSpec }`
- `rpc.request { kind: 'tool.exec', requestId, payload }`
- `rpc.cancel { requestId }`
- `tool-exec-status { sessionId, toolCallId, state: 'running' | 'done' | 'error' }` — renderer-only live status, relayed through main via `chief:event`; NOT persisted to the event log

**Main → Worker**
- `resolve-suspension { sessionId, suspensionId, resolution: SuspensionResolution, stateUpdate?: { addAllowOnceClass?: ApprovalClass } }` — the optional `stateUpdate` piggy-backs on the resolution per §8.2 step 9. Only `permission-allow-always` sends a stateUpdate; plain `permission-allow` does not, because the tool executes during resolution (§8.2 step 10b) and there's no "next call" to cache for. Worker applies the stateUpdate atomically before rewriting the placeholder.
- `rpc.response { requestId, result: { ok, data | error } }`
- `set-permission-mode { sessionId, mode: PermissionMode }`
- `cancel-current-turn { sessionId }` — worker dispatches to one of three paths depending on session state (§13.4): (1) if `currentAbortController` is non-null, abort the live `runLoop`; (2) else if `currentResolutionAbortController` is non-null, abort the in-flight resolution-handler tool execution; (3) else the session is parked on a card — call `session.cancelSuspendedCard()` which synthesizes a resolution that rewrites the placeholder to `{error: 'user-cancelled'}` (for permission) or `{error: 'user-cancelled-question'}` (for question) and clears `pendingSuspension`. Exactly one branch fires; the three states are mutually exclusive per the §13.3 invariant.

**Main → Renderer**
- `chief:event { ...LogEvent | tool-exec-status | permission.prompt | ask.prompt | permission.cancel | ask.cancel }`

**Renderer → Main**
- `permission.respond { cardId, action: 'allow' | 'allow-always' | 'deny' }`
- `ask.respond { cardId, answer: string }` — the user's answer (selected choice label or freeform text). If the user cancels the AskCard via the Cancel button, the renderer sends `cancel-current-turn` instead, and the worker handles it via the suspended-card path above. There is no "answer is cancellation" shape on the wire.
- `cancel-current-turn { sessionId }`
- `set-permission-mode { sessionId, mode }`

All RPC messages share one correlation table in `AgentHost` (keyed by `requestId`) with per-request timeout (default 60s, no timeout for in-flight Bash — the abort path handles those).

## 13. Persistence Deltas

### 13.1 No new event type; `part-update` is extended in use, not shape

Phase 2a does not add a new `LogEvent` type. The existing four from Phase 1 (`message-start`, `part-append`, `part-update`, `message-finish`) are sufficient. Phase 2a only does two things that Phase 1 did not:

1. **Implements `writePartUpdate`** — Phase 1 declared it as a `Phase1NotImplemented` throw in `src/agent/services/conversation-store.ts:156`. Phase 2a fills it in. Same schema, same bounds check as the existing `part-update` replay case in `conversation-store.ts:52`.

2. **Begins using `part-update` for two purposes:**
   - **Streaming text flushes** (§7.3): the 50ms `TextFlushScheduler` batches accumulated text and writes one `part-update` carrying the full text of the assistant text-part so far. Replay already handles this correctly — each `part-update` replaces the part at `partIndex`, so the last `part-update` wins, which is exactly the snapshot we want.
   - **Suspension placeholder rewrites** (§8.2 step 12, §9.2): both the happy-path explicit rewrite and the orphan sweep emit `part-update` events that replace `{__suspended: true, ...}` placeholders with their final resolved values.

Replay tolerance stays exactly as Phase 1 left it: out-of-range `partIndex` is silently dropped, per the guard in `conversation-store.ts:59`. Phase 2a does NOT change this behavior (do not add `console.warn` in `replay()` unless Phase 1's silent-drop is upgraded at the same time; keep them harmonized).

### 13.2 `suspension.json` schema

One JSON file per session directory. Contains the full `SuspensionSpec`. Atomic write (tmpfile + rename). Deleted on resolution.

### 13.3 `SessionMeta` additions and in-memory state summary

Phase 1's `SessionMeta` already has `permissionMode` (currently typed `'trust' | 'cautious'`), `lastSegmentReason`, and `model`. Phase 2a:

- `model`: default changes from `'phase1-stub'` to whatever OpenRouter model the session was opened with. New sessions read the default from `chief-preferences`.
- `permissionMode`: widened to `'trust' | 'normal' | 'strict'` (see §4 delta 4). New sessions read the default from `chief-preferences`.
- `SegmentFinishReason`: widened to include `'tool-calls'` (see §4 delta 10).

**No new persisted fields in `meta.json`.** All new session state is in-memory, with one exception (`pendingSuspension`) that has its own persistence via `suspension.json`.

Phase 2a session in-memory state (not in meta.json):

| Field | Type | Scope | Persisted? |
|---|---|---|---|
| `allowOnceClasses` | `Set<ApprovalClass>` | per runtime Session | No — cleared on worker restart and on mode change |
| `singleUseApprovals` | `Set<string>` | per runtime Session | No — consumed on hit |
| `pendingSuspension` | `SuspensionSpec \| null` | per runtime Session | Yes, via `suspension.json` (one file per session) |
| `currentRunPromise` | `Promise<void> \| null` | per runtime Session | No — used for single-session serialization (§13.4) |
| `currentAbortController` | `AbortController \| null` | per `runLoop` invocation | No — created on `runLoop` entry, cleared in `finally` (§13.4) |
| `currentResolutionAbortController` | `AbortController \| null` | per resolution handler invocation | No — created on resolution handler entry, cleared in `finally` (§13.4) |

**Invariant (enforceable at runtime with a debug assertion):** `currentAbortController` and `currentResolutionAbortController` are never both non-null at the same time. They belong to mutually-exclusive session states: a `runLoop` is either streaming (first field set, second null) or a resolution handler is executing a deferred tool (first null, second set), or the session is idle (both null). `cancel-current-turn` aborts whichever is non-null.

These six fields live on the worker's `Session` class instance and are set/cleared via explicit helper methods (not direct assignment). Tests exercise these helpers, not the raw fields.

### 13.4 Single-session serialization and cancellation wiring

**Serialization.** Session holds `currentRunPromise: Promise<void> | null`. `appendUserMessage + runLoop` checks this promise:
- null → claim it, run, finally clear.
- non-null → reject the new message with `{error: 'session-busy'}`; UI shows a toast "Chief Agent is still responding".

**Cancellation.** Session holds two AbortControllers (see §13.3 table and invariant): `currentAbortController` for the live `runLoop` and `currentResolutionAbortController` for a resolution handler that is executing a deferred tool after `permission-allow`. Only one is non-null at any time. A single `cancel-current-turn` IPC aborts whichever one is active.

**Run-loop path (segment streaming):**
1. `runLoop` entry creates a new `AbortController` and sets `session.currentAbortController = controller`.
2. `runLoop` passes `controller.signal` as the `externalAbort` argument to every `runSegment` call within its while-loop.
3. On `cancel-current-turn`, the worker handler calls `session.cancelEverything()` (helper), which internally aborts both controllers if non-null. Here `currentAbortController` fires; `currentResolutionAbortController` is null.
4. `runSegment`'s combined AbortSignal (§7.1) fires, `streamText` throws `AbortError`, `runSegment` returns `{reason: 'aborted'}`.
5. `runLoop` sees `aborted` and returns; the `finally` block clears both `currentAbortController = null` and `currentRunPromise = null`.

**Resolution-handler path (deferred tool execution after Allow):**
1. The resolution handler enters. At this moment `currentAbortController` is `null` (the prior suspending `runLoop` already returned). The handler creates a new `AbortController` and sets `session.currentResolutionAbortController = controller`.
2. Tool execution receives `controller.signal` via the synthesized `ExecContext` (§8.2 step 10b). For `rpc` tools, the signal propagates to main via the `rpc.cancel` envelope so main can kill the child process.
3. On `cancel-current-turn`, the worker handler calls `session.cancelEverything()`, which fires `currentResolutionAbortController.abort()`. Tool execution throws `AbortError`, the wrapper maps it to `{error: 'user-cancelled', hint: 'Cancelled during resolution'}`.
4. Resolution handler completes (catches the AbortError into the tool_result, emits the `part-update` rewrite, deletes `suspension.json`, clears `pendingSuspension`). `finally` block clears `currentResolutionAbortController = null`.
5. Resolution handler does NOT trigger a new `runLoop` after a cancelled execution — it returns the session to idle (`currentRunPromise = null`, `currentAbortController = null`, `currentResolutionAbortController = null`). The user's next message starts a fresh `runLoop`.

**Suspended-card path (no controllers live):**
If the session is parked on a PermissionCard or AskCard and the user hits Stop (or, for AskCard, clicks the Cancel button which is wired to the same path), `cancel-current-turn` finds both AbortControllers null. In that case the worker handler calls `session.cancelSuspendedCard()`. The helper does NOT flow through the normal `resolve-suspension` IPC at all — it directly invokes the resolution-handler write path with a hardcoded outcome:

- `pendingSuspension.kind === 'permission'` → rewrite placeholder to `{error: 'user-cancelled', hint: 'Cancelled before answering'}`
- `pendingSuspension.kind === 'question'` → rewrite placeholder to `{error: 'user-cancelled-question', hint: 'Cancelled before answering'}`
- `pendingSuspension.kind === 'plan-proposal'` → Phase 2b; throws `Phase2bNotImplemented`

After the rewrite, the helper deletes `suspension.json`, clears `pendingSuspension`, and returns the session to idle without triggering a new `runLoop`. Main receives a mirrored `permission.cancel` / `ask.cancel` message so the renderer removes the card. Note that this path uses neither `currentAbortController` nor `currentResolutionAbortController` — there's nothing to abort, just a synchronous state-rewrite to do.

Both controllers are recreated per invocation — neither outlives a single user-turn's work.

## 14. Testing Strategy

### 14.1 Unit tests (all green in CI)

Mock Vercel AI SDK `streamText` to return a controllable async iterator. Cover at minimum these branches in `runSegment` / `runLoop`:

1. **Natural finish**: text-delta events → finish with reason='stop' → segment returns natural.
2. **Tool call happy path**: text-delta → tool-call → local tool executes → tool-result → more text → finish='tool-calls' → runLoop continues → next segment finishes natural.
3. **Permission prompt → deny**: tool-call → checkPermission returns prompt-needed → SuspensionSignal → runSegment returns suspended → resolve-suspension 'permission-deny' → resolution handler rewrites placeholder to `{error: 'user-denied'}` via `part-update` → new runLoop iteration → next segment's history shows the denial tool_result → LLM returns natural without re-trying the tool. **No synthetic user message in the history** — assert this explicitly.
4. **Permission prompt → allow → tool executes during resolution**: tool-call (e.g. `Write('/tmp/x', 'hello')`) → checkPermission returns prompt-needed → SuspensionSignal → runSegment returns suspended → resolve-suspension 'permission-allow' → **resolution handler invokes the real `Write` executor outside any `runSegment`**, file gets written → resolution handler emits `part-update` replacing placeholder with the real tool output → new runLoop iteration → next segment's history shows a normal tool_use→tool_result pair → LLM continues naturally. This is the core allow-path test; assert that the file exists, that the event log contains exactly one `part-update` for the placeholder (not two, not zero), and that no synthetic user message was appended.
5. **Permission prompt → allow-always → tool executes during resolution → subsequent same-class tool run without prompting**: resolution is `permission-allow-always` → allowOnceClasses gains `'write'` → resolution handler invokes first `Write`, rewrites placeholder → next segment hits a second `Write` call → checkPermission sees allowlist and returns allow without prompting → second Write executes in-segment.
6. **Suspension raised by AskUserQuestion**: control-flow tool raises `kind: 'question'` suspension → resolve-suspension 'question-answered' → resolution handler rewrites placeholder to `{resolved: true, answer: '...'}` via `part-update` → no tool execution, no synthetic user message → new runLoop iteration → LLM sees the answer in the tool_result.
7. **External abort mid-stream**: runSegment mid-stream → `session.currentAbortController.abort()` fires via `cancel-current-turn` → combined signal trips → returns aborted.
8. **Cancel while PermissionCard is displayed (no controllers live)**: session is suspended (placeholder in history, `suspension.json` on disk, `pendingSuspension.kind === 'permission'`), both `currentAbortController` and `currentResolutionAbortController` are null, user hits Stop before answering → worker's `cancel-current-turn` handler calls `session.cancelSuspendedCard()` → helper rewrites placeholder directly to `{error: 'user-cancelled', hint: 'Cancelled before answering'}` via `part-update`, deletes `suspension.json`, clears `pendingSuspension`, returns session to idle. Assert no AbortController was created and no `resolve-suspension` IPC was synthesized — `cancelSuspendedCard()` is a synchronous local rewrite path. (Main separately sends `permission.cancel` to the renderer to clear the card; that's a main-side concern.) Add a parallel test 8b for `pendingSuspension.kind === 'question'` → rewrites to `{error: 'user-cancelled-question'}`.
9. **Cancel during resolution-handler tool execution**: `currentAbortController` is null, `currentResolutionAbortController` is mid-execute on a `Write` tool (use a fake `Write` that awaits a deferred promise so the test can pause in the middle) → `cancel-current-turn` fires → worker calls `session.cancelEverything()` → `currentResolutionAbortController.abort()` fires → the fake `Write`'s abort handler rejects → resolution handler catches AbortError, rewrites placeholder to `{error: 'user-cancelled', hint: 'Cancelled during resolution'}` → session returns to idle without triggering a new `runLoop`. Assert the `currentResolutionAbortController` field is cleared to null in the finally.
10. **Retryable error (429) succeeds on second attempt**: streamText throws 429 → retry layer backoff 200ms → second attempt returns normal finish.
11. **Retry exhaustion**: streamText throws 429 three times in a row → retry layer gives up → returns `{reason: 'error', error: 'rate-limited'}`.
12. **Non-retryable error (401)**: streamText throws 401 → returns error immediately without retry → error message includes sanitized "invalid API key".
13. **Step-cap**: mock `finishReason='tool-calls'` with 50 consecutive tool-call steps → `stopWhen` fires → returns `{reason: 'step-cap'}`.
14. **Loop continuation invariant**: finishReason='tool-calls' without actual new tool_calls in the stream (pathological SDK behavior) MUST still re-enter segment — runLoop does not special-case "empty tool_calls".
15. **`tool-exec-status` not persisted**: assert the event log after a complete tool call contains only `message-start`, `part-append(text)`, `part-append(tool-call)`, `part-append(tool-result)`, `message-finish` — no `tool-exec-status`.
16. **`length` finish reason**: streamText emits `finishReason='length'` → returns `{reason: 'error', error: 'context-length-exceeded'}`.
17. **`content-filter` finish reason**: streamText emits `finishReason='content-filter'` → returns `{reason: 'error', error: 'content-filter'}`.

Additional pure-function coverage:

- `checkPermission` truth table: 3 modes × 4 classes × (in allowlist, in single-use, neither) = 36 cases, all asserted.
- `TextFlushScheduler` timing: with fake timers, verify 50ms flush, final merge, zero-delta no-op, and the accumulation-across-flushes property (second flush writes the full accumulated string, not just the new fragment).
- `singleUseKey(toolName, args)` stability: same args → same key; different args → different key; key order-stable (e.g., `{a:1,b:2}` and `{b:2,a:1}` → same key).
- Path guard: allowed paths, denied paths (home dotfiles), relative path rejection, absolute path acceptance, `/tmp` and `/private/tmp` (macOS realpath) both resolve to the same allowed workspace check.
- Retry classification: 429, 529, 401, 400, network timeout (ECONNRESET, ETIMEDOUT), abort, generic error — each classified correctly.
- `cleanupOrphanPlaceholders`: orphan → rewrite to error; current suspension's placeholder → untouched; multiple orphans → multiple rewrites; no orphans → no writes.

**Parallel tool-calls invariant (Phase 2a constraint, tested as invariant):** Phase 2a's design assumes at most one `pendingSuspension` per session. If the LLM emits two parallel tool calls in the same step and BOTH of them trigger `prompt-needed`, the second `SuspensionSignal` throw will find `session.pendingSuspension` already populated. The runSegment outer catch must detect this collision, log a hard error, end the segment with `{reason: 'error', error: 'parallel-suspension-not-supported'}`, and leave the first suspension intact on disk. Test 18: two parallel `Write` tool-calls in one segment → second raises error; first proceeds through normal resolution flow. (Parent spec §15.5's `deferredSuspensions` queue is the proper long-term fix; it is deferred to Phase 2b. In Phase 2a's eight-tool world the collision is extremely unlikely — the LLM rarely parallelizes writes — but the invariant check must exist.)

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
  ask-user-question.ts                  # local / ui — worker-side suspending tool
  index.ts
  __tests__/
    check-permission.test.ts
    manifest-wrapper.test.ts
    read.test.ts
    write.test.ts
    edit.test.ts
    grep.test.ts
    glob.test.ts
    ask-user-question.test.ts

src/main/
  chief-preferences.ts
  secret-store.ts
  suspension-router.ts
  permission-reconciler.ts
  tool-executors/
    bash.ts                             # rpc / exec — only main-side executor in Phase 2a
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
src/agent/services/event-log.ts       # no schema change; verify no regression with the new usage patterns
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
## 17. Open Questions (must be resolved during plan writing)

1. Does `TerminalManager` already have a one-shot exec API? (§11.4 decision)
2. Is `/tmp` the right "allowed outside workspace" path, or should it be more restrictive? (§6.4 decision)
3. Should the Preferences panel require an API key before enabling Chief Agent at all, or allow a read-only "no key configured" state? (UX decision)
4. Plan resolutions DO append synthetic user messages (§12.3 in parent spec). Phase 2a doesn't implement plan mode but its IPC protocol union includes the plan resolution kinds. The plan task should verify the SuspensionResolution union shape matches the parent spec's §15.5 step 5 and that the plan-specific branches throw `Phase2bNotImplemented` cleanly.

## 18. References

- Parent spec: `docs/superpowers/specs/2026-04-14-chief-agent-design.md` (§5 runtime, §6 tools, §6.3a execution topology, §7 context, §12 permission, §15.5 suspension, §18.1 MVP checklist)
- Phase 1 plan: `docs/superpowers/plans/2026-04-14-chief-agent-phase1-skeleton.md`
- Vercel AI SDK v6 docs (external): `streamText` API, `fullStream` part shapes, `experimental_context`
- cc-src loop rule: "if last segment finished with tool-calls, continue next segment"
- OpenRouter API: `/api/v1/models`, `/api/v1/chat/completions`
