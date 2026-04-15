# Chief Agent — Design Spec

**Date:** 2026-04-14
**Status:** Draft for review
**Project:** OneShip (formerly Goal Engine)
**Author:** brainstorm session
**Working directory:** `/Users/a/Desktop/ge`

---

## 1. Background and Goals

OneShip is a desktop app for OPC ("one-person company") users to manage multiple projects with AI agent collaboration. Its core product claim is "a Jarvis-like overseer plus hands-on terminal workers."

Today the app ships the **terminal worker** half of that claim: users open Claude Code or Codex inside embedded xterm sessions, the app tracks them via hooks. The **overseer** half is a placeholder — `chief-chat.tsx` exists as UI, but the backend returns a hard-coded "I received your message..." string. There is no real agent runtime, no LLM SDK in `package.json`.

This spec defines the real Chief Agent: a long-running, multi-turn LLM orchestrator embedded in OneShip that can plan, read/write project files, execute shell commands, dispatch sub-tasks, run on a schedule, and deliver complex work over dozens of turns without drifting or giving up.

**Success criteria for the MVP:**

1. A user opens Chief Agent chat, says "refactor the auth module in /oneship to use bcrypt," and Chief Agent plans it, executes it across ~10 file operations, runs tests, reports results — all in one conversation, without the user having to re-prompt.
2. Chief Agent's **conversation, task state, and pending suspensions are durable across Electron restarts**. After restart, the user opens the session and sees the full transcript, task list, and any pending Plan/Ask/Cautious card exactly as it was — pending suspensions are just on-disk state waiting for a UI decision, so the process boundary is irrelevant to them. **In-flight** operations are different: a streaming LLM turn or a mid-execution Bash command **cannot** be automatically resumed (Vercel AI SDK doesn't expose half-streams, and child shells die with the parent). Those are marked as interrupted and Chief Agent can pick up from that point on the next user message. Mid-stream resume is explicitly out of scope (V2+).
3. Chief Agent can invoke user-defined skills from `~/.oneship/skills/` and dispatch sub-agents for isolated sub-problems.
4. Chief Agent can be scheduled (cron) to run autonomous checks — e.g. "every weekday 9am, review open GitHub issues across all projects." Cron-triggered runs use **separate sessions** from the user's interactive ones.
5. Token cost is controlled via prompt caching and auto-compaction; a 30-turn conversation does not explode the context window.
6. **Multiple sessions can coexist.** The user can have an interactive conversation in one session, a cron-triggered job running in another, and switch between them without losing state in either.

**Explicit non-goals:**

- Chief Agent does **not** interact with terminal-worker sessions (Claude Code / Codex running in xterm). Those are the user's direct tools. Chief Agent reads and writes files independently, in its own execution lane.
- Chief Agent does **not** replace Project Lead chat (per-project collaboration is a different surface, out of scope for this spec).
- First version does **not** support multi-agent team coordination (SendMessage, TeamCreate), MCP servers per-agent, or remote triggers.

---

## 2. Core Concepts and Terminology

| Term | Meaning |
|---|---|
| **Chief Agent** | The top-level orchestrator. One instance per OneShip process. Jarvis-like — converses with the user and dispatches work. |
| **Agent worker** | The Node.js child process (via Electron `utilityProcess.fork`) that runs the Chief Agent's LLM loop, tools, and state. Isolated from the main UI process. |
| **Tool** | A typed, LLM-callable function (e.g. `Read`, `Write`, `Bash`, `TaskCreate`). 22 tools in MVP. |
| **Sub-agent** | A child LLM loop spawned by the `Agent` tool. Shares the Chief Agent's runtime and tool set but runs in its own turn budget with its own message history. Not a PTY process. |
| **Skill** | A user-authored workflow stored in `~/.oneship/skills/<name>/SKILL.md`. Invoked via the `Skill` tool. Runs as a fork-style sub-agent with an optional restricted tool set. |
| **Task** | A structured work item (JSONL persisted). Used for planning, DAG dependencies, and cross-turn tracking. Manipulated via `TaskCreate / TaskUpdate / TaskList / TaskGet`. |
| **Session** | One conversation + its full state (messages, tasks, memory). Persisted to disk, survives restarts. |
| **Plan Mode** | A runtime mode in which destructive tools (Write/Edit/Bash) are disabled and Chief Agent must produce and get approval on a plan before continuing. |
| **Trust / Cautious mode** | Permission modes. Trust = no per-tool confirmation (default). Cautious = Bash/Write/Edit trigger a native confirmation dialog. |
| **Compaction** | A separate LLM call that summarizes old turns to free context budget. Triggered when the context window fills. |
| **Prompt cache boundary** | A marker in the system prompt separating static (cacheable) from dynamic (per-turn) content, to maximize Anthropic `cache_control: ephemeral` hit rate. |

---

## 3. Architecture Overview

OneShip runs on Electron. Electron applications are inherently multi-process: one main process, one or more renderer processes, plus utility processes for heavy work. The Chief Agent runs in its own utility process.

```
┌───────────────────────────────────────────────────────────────────────┐
│  OneShip (Electron app)                                               │
│                                                                       │
│  ┌─────────────────┐      ┌─────────────────┐     ┌──────────────┐    │
│  │                 │      │                 │     │              │    │
│  │  Main Process   │◄────►│  Renderer       │     │  Terminal    │    │
│  │  (src/main/)    │ IPC  │  (src/renderer/)│     │  PTYs        │    │
│  │                 │      │  React UI       │     │  (unchanged) │    │
│  │  - terminal-mgr │      │                 │     │              │    │
│  │  - session-store│      │  - chief-chat   │     │  Claude Code │    │
│  │  - config-store │      │  - dashboards   │     │  Codex       │    │
│  │  - hook-server  │      │  - terminal ui  │     │  ...         │    │
│  │  - AgentHost ───┼──────┼──►┌──────────┐  │     └──────────────┘    │
│  └────────┬────────┘      │   │ IPC port │  │                        │
│           │               │   └──────────┘  │                        │
│           │ utilityProcess│                 │                        │
│           ▼ .fork()       └─────────────────┘                        │
│  ┌──────────────────────┐                                             │
│  │                      │                                             │
│  │  Agent Worker        │  ◄── OpenRouter API ──► Claude/GPT/Gemini   │
│  │  (src/agent/)        │                                             │
│  │                      │                                             │
│  │  - Vercel AI SDK     │                                             │
│  │  - 22 tools          │                                             │
│  │  - task-store        │                                             │
│  │  - skill loader      │                                             │
│  │  - compactor         │                                             │
│  │  - cron scheduler    │                                             │
│  │  - conversation I/O  │                                             │
│  └──────────────────────┘                                             │
└───────────────────────────────────────────────────────────────────────┘
```

**Three execution lanes inside OneShip:**

1. **UI lane** — Renderer process, React UI, user-facing chat and dashboards.
2. **Terminal lane** — Main process + PTYs, running user's direct CLI tools. **Unchanged by this spec.**
3. **Agent lane** — Agent worker process, running Chief Agent's LLM loop. **New.**

The Terminal lane and Agent lane never communicate directly. Both can read OneShip's project list (via different paths), but they do not coordinate, dispatch, or observe each other. The user is the only participant who sees both.

Communication rules:

- **Renderer ↔ Main**: existing Electron IPC (`ipcMain.handle` + preload bridge). No change.
- **Renderer ↔ Agent Worker**: no direct path. Messages are relayed through Main. Renderer calls `window.electronAPI.chief.sendMessage(...)`, Main forwards to the Agent Worker via the utility-process IPC port, streaming deltas come back the same way.
- **Main ↔ Agent Worker**: `utilityProcess.fork()` returns a `UtilityProcess` with `postMessage` / `on('message')`. A typed protocol (§4.2) runs over this channel.
- **Agent Worker ↔ Main process modules**: the Agent Worker cannot `import` from `src/main/*` — they are different processes. The worker sends typed RPC requests over IPC (e.g. `{ op: 'listProjects' }`) that Main handles by reading its local `config-store`.

---

## 4. Agent Worker Process

### 4.1 Why a separate process

Running the Chief Agent in-process with Main would save one IPC hop, but:

- A runaway LLM loop (infinite retries, memory leak, large tool output) can freeze the Electron UI. Claude desktop and Cursor both use utility processes for exactly this reason — their `.app` bundles show `Claude Helper (Plugin).app`, `Cursor Helper (Plugin).app`, etc.
- OneShip is explicitly designed for future multi-agent work. A process boundary is the natural unit for spawning more agents later without re-architecting.
- Independent monitoring: the OS Activity Monitor shows the agent process as a separate row, so the user can see "Chief Agent: 800MB" and decide whether to restart it.
- Electron v22+ officially recommends `utilityProcess.fork()` for heavy/risky work (not `child_process.fork`, which is unmanaged).

### 4.2 Worker lifecycle

- **Start**: When OneShip boots, `src/main/index.ts` calls `AgentHost.start()`, which calls `utilityProcess.fork(path.join(__dirname, '../agent/index.js'))`. The worker immediately reads its config (model, API key, permission mode) from disk (§17.2).
- **Healthcheck**: Worker sends `{ type: 'ready' }` on startup. If Main doesn't see ready within 5 seconds, it logs an error and retries once. A persistent failure surfaces a banner in the UI: "Chief Agent offline — click to retry."
- **Crash handling**: If the worker exits with a non-zero code, Main emits a UI event and auto-respawns (at most 3 times in 60s; after that, manual restart only). Session state is on disk, so respawn resumes the last session automatically.
- **Shutdown**: On app quit, Main sends `{ type: 'shutdown' }`, worker flushes pending writes (conversation, task store), then exits. Hard kill after 3s grace period.

### 4.3 IPC protocol between Main and Agent Worker

All messages are typed via a shared TypeScript file at `src/shared/agent-protocol.ts`. The Main-side client is `AgentHost`; the Worker-side server is `AgentIpcServer`.

Every payload that targets a session carries `sessionId` because the worker holds multiple sessions (§15.4) and routes messages accordingly.

Message kinds:

```ts
// Main → Worker
type ToWorker =
  | { type: 'ready-ack' }
  | { type: 'shutdown' }
  // Session lifecycle
  | { type: 'create-session', sessionId: string, model?: string, permissionMode?: PermissionMode, triggeredBy?: { kind: 'user' } | { kind: 'cron', cronId: string } }
  | { type: 'open-session', sessionId: string }   // bring a persisted session into memory
  | { type: 'close-session', sessionId: string }  // flush + drop from memory; on-disk state preserved
  | { type: 'list-sessions' }
  // Conversation
  | { type: 'send-user-message', sessionId: string, content: string }
  | { type: 'cancel-current-turn', sessionId: string }
  // Suspension responses (see §15.5)
  // NOTE (2026-04-15, Phase 2a update): the `'cautious-allowed' / 'cautious-denied'` kinds
  // are retired and replaced by the permission-mode rework (§12). The current resolution
  // kinds are: 'plan-approved' | 'plan-modified' | 'plan-rejected' | 'question-answered'
  // | 'permission-allow' | 'permission-allow-always' | 'permission-deny'. See the
  // Phase 2a spec §9.1 for the exact union shape and §12.3 for the flow.
  | { type: 'resolve-suspension', sessionId: string, suspensionId: string, resolution:
        | { kind: 'plan-approved', injectedMessage: string }
        | { kind: 'plan-modified', modifiedPlan: string }
        | { kind: 'plan-rejected', reason: string }
        | { kind: 'question-answered', answer: string | { choice: string } }
        | { kind: 'permission-allow' }
        | { kind: 'permission-allow-always' }
        | { kind: 'permission-deny' },
      stateUpdate?: { addSingleUseKey?: string; addAllowOnceClass?: ApprovalClass }
    }
  // Settings
  | { type: 'set-permission-mode', sessionId: string, mode: PermissionMode }
  | { type: 'set-model', sessionId: string, modelId: string }
  // RPC responses (answers to requests initiated by Worker)
  | { type: 'rpc-response', requestId: string, ok: boolean, result?: unknown, error?: string }

// Worker → Main
type ToMain =
  | { type: 'ready' }
  // Session lifecycle
  | { type: 'session-created', sessionId: string }
  | { type: 'session-opened', sessionId: string, snapshot: SessionSnapshot }
  | { type: 'session-closed', sessionId: string }
  | { type: 'session-list', sessions: SessionMeta[] }
  // Streaming + state diffs
  | { type: 'message-delta', sessionId: string, partialMessage: UIMessagePart }
  | { type: 'message-complete', sessionId: string, message: UIMessage }
  | { type: 'task-changed', sessionId: string, task: Task }
  // Suspensions — the loop has paused waiting for a Main-side decision
  | { type: 'suspension-raised', sessionId: string, suspension: SuspensionSpec }
  // Stream finished for a segment (see §15.5 for what a segment is)
  | { type: 'segment-finished', sessionId: string, reason: SegmentFinishReason, error?: string }
  // RPC requests into Main (worker needs Main-side data)
  | { type: 'rpc-request', requestId: string, op: RpcOp, params: unknown }

// NOTE (Phase 2a): `PermissionMode` is widened to three values — `'trust' | 'normal' | 'strict'`.
// `'cautious'` is retired. See §12 for the full truth table and the Phase 2a spec §8.
type PermissionMode = 'trust' | 'normal' | 'strict'

type ApprovalClass = 'read' | 'write' | 'exec' | 'ui'  // See §6.3a

// NOTE (Phase 2a): the `'cautious'` SuspensionSpec kind is retired; its replacement is
// `'permission'` with `approvalClass`, `summary`, and `args`. See Phase 2a spec §9.1.
type SuspensionSpec =
  | { suspensionId: string, kind: 'plan', planId: string, plan: PlanSpec }
  | { suspensionId: string, kind: 'question', questionId: string, question: AskSpec }
  | { suspensionId: string, kind: 'permission', messageId: string, partIndex: number,
      toolCallId: string, toolName: string, approvalClass: ApprovalClass, summary: string, args: unknown }

type SegmentFinishReason =
  | 'natural'        // model produced a final assistant message with no tool calls
  | 'suspended'      // a tool emitted a SuspensionSpec; loop is parked
  | 'step-cap'       // stopWhen: stepCountIs(N) hit
  | 'aborted'        // user cancelled or worker shutdown
  | 'error'          // unrecoverable error after retries
```

Notes:

- `plan-ready` / `question-raised` / `request-cautious-approval` from the previous draft are **collapsed into one `suspension-raised` message** with a `kind` discriminator. This unifies the three "the model is waiting for Main-side input" flows so the Session state machine has one parking lot, not three.
- `turn-finished` is renamed to `segment-finished` to reflect that one user message can produce multiple `streamText` segments separated by suspensions (§15.5).
- `task-changed` is a new push event so the UI's task sidebar can re-render reactively without polling.

`RpcOp` is the list of things the Worker needs from Main:

```ts
type RpcOp =
  | 'listProjects'           // read config-store
  | 'getProjectContext'      // read session-store + project-store (v1+)
  | 'readSkillFile'          // pass-through file read with path-guard
  | 'showNativeDialog'       // for Cautious mode tool approval
```

The RPC is request/response with a generated `requestId`. The Worker has a small promise-based client that wraps it; consumers just `await rpc.listProjects()`.

### 4.4 Process topology constraints

- The Agent Worker does **not** import from `src/main/*`. Enforced by TS project refs: `src/agent/tsconfig.json` does not list `../main` in `references`.
- The Agent Worker **can** import from `src/shared/*` (types, pure utilities).
- The Agent Worker uses its own minimal set of Node dependencies. It does not pull in Electron, React, or xterm.
- Only the `agent-protocol.ts` file crosses the boundary, and it contains types only (no runtime code).

---

## 5. Agent Runtime

### 5.1 Library: Vercel AI SDK v6

Chief Agent is built on **`ai` (Vercel AI SDK v6)**, with `@openrouter/ai-sdk-provider` for model routing.

Reasons (from earlier exploration):

- TypeScript-native, Node-first, designed for streaming to UIs
- First-class multi-provider support through OpenRouter (Claude, GPT, Gemini, local, one API key)
- Built-in multi-step tool loop via `streamText({ stopWhen: stepCountIs(N) })` — MVP uses this directly rather than the higher-level `ToolLoopAgent` class, for less abstraction between us and the stream
- `UIMessage` format serializes tool calls and results naturally, so persistence is trivial
- Passes through Anthropic `cache_control` via `providerOptions`

### 5.2 Model selection

- **Default model**: `anthropic/claude-sonnet-4.6`
- **User-configurable** via Preferences UI → Chief Agent → Model
- **Model list**: fetched from OpenRouter's `/api/v1/models` endpoint on Agent Worker startup, cached for the session. Preferences UI shows the real-time list, not a hard-coded one.
- **Rationale**: Claude-family models maximize the benefit of the static/dynamic prompt-cache boundary. Users preferring GPT-5 or Gemini still work, but prompt-cache savings are provider-specific.

### 5.3 OpenRouter setup

```ts
// src/agent/runtime/model.ts
import { createOpenRouter } from '@openrouter/ai-sdk-provider'

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY! })
export const getModel = (modelId: string) => openrouter(modelId)
```

The API key is read from the OneShip secure config (`~/.oneship/config.json` or OS keychain, TBD §19).

### 5.4 Agent loop — segment-based, suspension-aware

Chief Agent uses `streamText` with `stopWhen: stepCountIs(N)` directly (rather than wrapping it in `ToolLoopAgent`) — simpler, fewer layers, and gives the session code direct access to the `fullStream`.

A user message does **not** map to a single `streamText` call. It maps to a sequence of one or more **segments**, where each segment is one `streamText` invocation that runs until the model naturally stops, the step cap fires, the user aborts, or a tool raises a suspension. Suspensions (Plan / Ask / Cautious approval) cleanly end one segment; resolving them starts the next segment with the same conversation history plus an injected resolution message.

This segment-based design is the answer to "how do you pause the loop and resume it after the user clicks Approve?" The answer is: **you don't pause inside a `streamText`, you end it cleanly and start a new one.** Vercel AI SDK's `streamText` is a single-direction async iterable; it cannot be paused mid-flight. Trying to "park" inside `execute()` would either deadlock the iterable or violate the tool_use → tool_result protocol.

See §15.5 for the full state machine and the suspension protocol.

```ts
// src/agent/runtime/loop.ts
import { streamText, stepCountIs, convertToModelMessages } from 'ai'
import { getModel } from './model'
import { buildSystemMessages } from '../context/system-prompt'
import { allTools } from '../tools'
import { withRetry } from './retry'

export async function runSegment(session: Session): Promise<SegmentFinishReason> {
  // Suspension flow:
  //   1. A suspending tool's execute() (running inside Vercel AI SDK's machinery,
  //      with `experimental_context.session` closing over this Session instance)
  //      sets session.pendingSuspension = { ... } and returns a placeholder
  //      tool-result like { __suspended: true, suspensionId }.
  //   2. Vercel AI SDK emits a 'tool-result' event into fullStream for that
  //      placeholder.
  //   3. handleStreamEvent below appends the placeholder to uiMessages.
  //   4. The for-await loop checks session.pendingSuspension after each event
  //      and, if set, calls abortController.abort('suspension'), unwinding the
  //      iterable and ending the segment cleanly with reason 'suspended'.
  //   5. The session writes suspension.json + meta.json, emits the IPC events,
  //      and waits for resolve-suspension before any new segment starts.
  // See §15.5 for the full lifecycle including parallel tool calls.

  const abortController = new AbortController()
  session.bindAbort(abortController)

  const { fullStream } = streamText({
    model: getModel(session.modelId),
    // Note: NO top-level `system` and NO top-level `providerOptions`.
    // System messages are real entries in `messages` so each one can carry its
    // own providerOptions (cache control on the static system block, none on
    // the dynamic preamble). See §7.1.
    messages: [
      ...buildSystemMessages(session),
      ...convertToModelMessages(session.uiMessages),
    ],
    tools: allTools(session),
    stopWhen: stepCountIs(session.turnBudget ?? 50),
    abortSignal: abortController.signal,
  })

  try {
    for await (const ev of fullStream) {
      session.handleStreamEvent(ev)
      if (session.pendingSuspension) {
        abortController.abort('suspension')
        return 'suspended'
      }
    }
    return 'natural'
  } catch (e) {
    if (abortController.signal.aborted && session.pendingSuspension) return 'suspended'
    if (abortController.signal.aborted) return 'aborted'
    return 'error'
  }
}
```

`fullStream` delivers text deltas, `tool-call` events, `tool-result` events, and finish events. The session object (§15) appends each to the persistent `UIMessage[]` and forwards a diff to Main via IPC.

### 5.5 Turn budget

Each segment has its own `stopWhen: stepCountIs(N)` cap. Default N=50 per segment. A multi-segment turn (one with a Plan card or an Ask card mid-way) gets N steps **per segment**, not N total — the segments are conceptually separate "rounds of execution" the model can do between user inputs.

When a segment hits the step cap:

- If the last step was a natural end (no tool calls), the segment finishes cleanly with reason `natural`.
- If the cap was hit mid-loop (the model still wanted to call tools), the worker appends a synthetic assistant message: "I've paused after 50 steps. Here's where I am: …" and emits `segment-finished: reason=step-cap`. The UI shows a "Continue" button; clicking it injects a "continue" user message and starts a new segment.

Turn budget is user-configurable per session (V1); MVP uses the default.

---

## 6. Tool System

### 6.1 Tool catalog (22 tools)

| Group | Tool | Purpose |
|---|---|---|
| File / Execute (9) | `Read` | Read file, supports offset/limit |
| | `Write` | Write/overwrite file |
| | `Edit` | Exact-string replace with optional `replace_all` |
| | `Glob` | Filename pattern match |
| | `Grep` | ripgrep-backed regex search |
| | `Bash` | Shell execute, optional `run_in_background` returning shell_id |
| | `BashOutput` | Non-blocking peek at a background shell's current buffer |
| | `WebFetch` | Fetch URL + LLM-summarize |
| | `WebSearch` | Web search query |
| Collaboration / Long task (6) | `TaskCreate` | Create a task in the session task store |
| | `TaskUpdate` | Update task status / fields |
| | `TaskList` | List tasks (with filters) |
| | `TaskGet` | Get one task by id |
| | `Skill` | Invoke a user skill by name, fork a sub-agent |
| | `Agent` | Dispatch a generic LLM sub-agent on a sub-problem |
| OneShip context (1) | `ListProjects` | Return OneShip's registered projects (RPC to Main) |
| Human interaction (1) | `AskUserQuestion` | Raise a structured question with optional choices; blocks until answered |
| Automation (3) | `CronCreate` | Schedule a recurring Chief Agent invocation |
| | `CronList` | List scheduled jobs |
| | `CronDelete` | Delete a scheduled job |
| Planning guardrail (2) | `EnterPlanMode` | Switch session into Plan Mode (read-only tools) |
| | `ExitPlanMode` | Submit a plan for user approval, then exit Plan Mode |
| Long-running observation (1) | `Monitor` | Tail a background shell's output until a condition or timeout |

### 6.2 Tool definition pattern

Every tool lives in `src/agent/tools/<name>.ts` and exports a `ai`-compatible `tool()` definition:

```ts
// src/agent/tools/read.ts
import { tool } from 'ai'
import { z } from 'zod'
import { guardPath } from '../guards/path-guard'
import { readFileSlice } from '../services/fs'

export const ReadTool = tool({
  description: 'Read a file from the local filesystem. Supports offset/limit for large files.',
  inputSchema: z.object({
    file_path: z.string().describe('Absolute path'),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().optional(),
  }),
  execute: async ({ file_path, offset, limit }, { abortSignal }) => {
    guardPath(file_path)
    return readFileSlice(file_path, offset, limit, abortSignal)
  },
})
```

Registration:

```ts
// src/agent/tools/index.ts
import { ReadTool } from './read'
import { WriteTool } from './write'
// … 20 more
export const allTools = (session: Session) => ({
  Read: ReadTool,
  Write: WriteTool,
  // …
  ...planModeToolMask(session),  // Plan Mode hides destructive tools
})
```

### 6.3 Tool execution semantics

- **Error handling**: a tool that throws is caught by Vercel AI SDK and returned to the LLM as a tool-result part with the error message sanitized. The LLM decides how to react. See §13.
- **Async / streaming**: tools can be async (all of OneShip's are). Tools can also yield intermediate progress via `AsyncIterable`, used by `Bash` to stream stdout into the UI during execution.
- **Abort**: the `abortSignal` from the execute context is threaded through any spawned child processes, so `session.cancelCurrentTurn()` actually kills in-flight bash commands. Tool implementations must treat abort as cooperative — clean up shell handles, file descriptors, etc.
- **Suspending tools**: `AskUserQuestion`, `ExitPlanMode`, and any tool whose `checkPermission` returns `prompt-needed` do not block inside `execute()`. They push a `SuspensionSpec` onto `session.pendingSuspension`, return a placeholder tool-result (`{ __suspended: true, suspensionId }`), and the session loop ends the segment cleanly via abort. See §15.5 for the full lifecycle.
- **Permission gating**: before execution, the worker-side tool wrapper calls `checkPermission` (§12.2) against the session's mirror of the current permission mode. If the result is `allow`, the tool runs; if `deny`, it returns `{ error: 'user-denied' }` immediately; if `prompt-needed`, a `permission` SuspensionSpec is raised (§12.3). Under the §6.3a permission system, this happens uniformly across all modes (trust / normal / strict) and all approval classes (read / write / exec / ui).
- **Plan Mode mask**: in Plan Mode, `allTools()` omits `Write / Edit / Bash / CronCreate / CronDelete / Agent` **and** restricts `Skill`. The LLM only sees the remaining tools. See §11.1 for the Skill-in-PlanMode rules; the short version is that Skill is *not* removed (so the model can still invoke read-only skills) but the sub-agent it spawns inherits Plan Mode and the same mask is applied recursively.

### 6.3a Tool execution topology (Phase 2 addendum — authoritative)

> Added 2026-04-15 as part of Phase 2 design. This section **supersedes** §6.2 and §6.3 wherever they conflict; the rest of §6 remains authoritative. Any future tool added to OneShip must follow these rules.

This addendum codifies three architectural rules that Phase 2 introduces to keep the tool surface sane as the catalog grows past 22.

**Rule 1 — Worker-default, main-exception execution**

Tools execute in the worker by default. A tool only executes via Worker→Main RPC if it requires Electron APIs, UI mediation, PTY/long-lived process ownership, or other main-process-owned resources. There is no "either side works" category; every tool has a committed execution location.

**Rule 2 — Every tool declares `execution` and `approvalClass`**

Every tool's manifest entry MUST declare both:

- `execution: 'local' | 'rpc'` — where its executor runs
- `approvalClass: 'read' | 'write' | 'exec' | 'ui'` — what policy class it falls under

There is no default and no context-dependent third mode. The manifest is the single authority for both fields; no other code path may hardcode them.

**Rule 3 — Approval is orthogonal to execution location; main owns policy, worker evaluates**

The three roles in permission:

- **Policy source of truth** (main): owns the default permission mode in Preferences, owns the per-session mode switch IPC (`set-permission-mode`), owns the permission UI (PermissionCard), and owns user mediation outcomes. Any state change flows through main.
- **Policy evaluation** (worker): each `runSegment` has a pure-function `checkPermission(mode, class, allowlist, singleUse)` (§12.2) that it runs **locally in the worker** against the session's mirror of the current mode and allowlist state. This keeps the hot path (read-class tools in trust/normal modes) from doing a worker→main→worker round-trip on every tool call. Main keeps the worker's mirror fresh via `set-permission-mode` and via `stateUpdate` piggy-backed on `resolve-suspension`.
- **User mediation** (main): when `checkPermission` returns `prompt-needed`, the worker raises a permission suspension and ends the segment. Main then receives `suspension-raised`, renders the PermissionCard, waits for the user, and sends `resolve-suspension` (with any `stateUpdate` the decision requires) back to the worker.

Orthogonality of approval vs execution location:

- A `local` tool executed in the worker can still require approval mediated by main. (Write and Edit are the common case.)
- An `rpc` tool executed in main can still be directly allowed (e.g. Bash in Trust mode) without UI mediation.
- Path-guard, workspace-guard, and other security checks that both worker and main must enforce MUST live in a shared pure module (`src/shared/tool-guards/`) and be imported by both sides. Security logic MUST NOT be duplicated in a main-side IPC handler.

**Manifest structure — two layers**

Tool definitions are split into two layers:

1. **Shared manifest** (`src/shared/tool-manifest.ts`): pure data — `name`, `description`, `inputSchema`, `execution`, `approvalClass`, `summarize(args)`. Imported by worker and main. No executor code.
2. **Executor implementations**: the actual `execute(args, ctx)` function. For `execution: 'local'` tools this lives in `src/agent/tools/<name>.ts`; for `execution: 'rpc'` tools this lives in `src/main/tool-executors/<name>.ts`. Each side imports the shared manifest for its local tool set.

This split prevents drift: worker and main cannot disagree on execution location or approval class because they read the same manifest entry.

**Phase 2a assignment**

The eight tools in Phase 2a are assigned as follows:

| Tool | execution | approvalClass |
|---|---|---|
| Read | local | read |
| Glob | local | read |
| Grep | local | read |
| WebFetch | local | read |
| Write | local | write |
| Edit | local | write |
| Bash | rpc | exec |
| AskUserQuestion | local | ui |

`AskUserQuestion` is intentionally `local` even though it mediates with the user. It is a **control-flow tool**: its job is to push a `SuspensionSpec` onto `session.pendingSuspension` (a worker-side field) and throw `SuspensionSignal` so the segment ends. It does not execute anything main owns. Main handles the UI side purely by receiving `suspension-raised` and dispatching `ask.prompt` to the renderer; the tool itself lives in the worker's registry alongside other suspending control-flow tools. This keeps the single source of truth for `pendingSuspension` on the worker and avoids an unnecessary worker→main→worker round-trip on every Ask call.

Phase 2b and later additions must extend this table, not create parallel classification schemes.

**Approval policy truth table**

The permission mode interacts with `approvalClass` as follows:

| approvalClass | trust | normal | strict |
|---|---|---|---|
| read | allow | allow | prompt |
| write | allow | prompt | prompt |
| exec | allow | prompt | prompt |
| ui | pass-through | pass-through | pass-through |

"pass-through" means the permission system returns `allow` without prompting — the tool's own executor is responsible for any UI mediation it needs (AskUserQuestion raises its own suspension, not a permission prompt).

This table is evaluated by a pure function `checkPermission(mode, class, allowlist, singleUse)` that lives in the worker and queries session-local state only. See §12.2a.

### 6.4 Tool groups — quick notes

Each tool gets a dedicated file, but a few are worth pre-committing architecture on:

**Bash & BashOutput & Monitor**: per §6.3a, `Bash` is `execution: 'rpc' / approvalClass: 'exec'`. Because `BashOutput` and `Monitor` must read state owned by the same shell lifetime, the entire Bash tool bundle is main-side: the session-scoped `Map<shellId, RunningShell>` lives in main (not worker), wrapping the existing `TerminalManager` or its successor, and all three tools are `rpc` executors in `src/main/tool-executors/`. `Bash(run_in_background: true)` returns a shell_id; the shell keeps running in the background with its stdout/stderr piped into a ring buffer in main. `BashOutput(shell_id)` reads the buffer's current state non-blockingly. `Monitor(shell_id, timeoutMs)` awaits new output until either the shell exits, the timeout hits, or the buffer contains a match for an optional `waitFor` regex. (Phase 2a only ships one-shot `Bash`; BashOutput and Monitor land in Phase 2b but keep main-side ownership from day one.)

**Skill**: on call, loads the skill file from `~/.oneship/skills/<name>/SKILL.md`, parses the frontmatter for `tools:` restrictions, then runs a sub-agent using the skill body as the initial user message, with only the allowed tools. See §8.

**Agent**: a generic fork — create a new `Session`-like child context sharing the same `uiMessages` prefix up to the current turn, run the loop with a user-supplied sub-prompt and an independent `stepCountIs(N)`, collect the final assistant text, return it as the tool result. Context cost is mitigated by cache (the shared prefix cache-hits).

**AskUserQuestion**: pushes a `{ kind: 'question', ... }` SuspensionSpec onto `session.pendingSuspension`, returns a placeholder tool-result, the session sees the suspension and ends the segment. Main shows an Ask card. When the user answers, Main sends `resolve-suspension` with `kind: 'question-answered'`. The worker rewrites the placeholder tool-result on disk to contain the actual answer, then runs the next segment with the updated history. See §15.5.

**EnterPlanMode**: synchronous — sets `session.planMode = true`, returns `{ ok: true }`. The next segment's `allTools()` will be masked accordingly. Does *not* suspend.

**ExitPlanMode**: pushes a `{ kind: 'plan', ... }` SuspensionSpec containing the proposed plan text, returns a placeholder tool-result, segment ends. Main shows a Plan card. User's approve/modify/reject decision arrives as `resolve-suspension`. The worker translates the resolution into either a follow-up user message ("Plan approved. Proceed.") or a synthetic assistant message (rejection) before starting the next segment.

**Cron\* tools**: delegate to `src/agent/services/cron.ts` (§10).

**TaskCreate/Update/List/Get**: delegate to `src/agent/services/task-store.ts` (§9).

**ListProjects**: RPCs to Main, which reads `config-store` and returns the projects array.

---

## 7. Context Engineering

This is the hard and high-value section. Borrowed closely from cc-src (file:line citations retained).

### 7.1 System prompt structure and caching

Following cc-src's `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` pattern (`cc-src/constants/prompts.ts:114`), Chief Agent's system prompt is assembled in two halves:

**Static half** (cached, `providerOptions.anthropic.cacheControl = ephemeral`):

1. Identity and role ("You are Chief Agent, the overseer of the user's OneShip workspace …")
2. Available tools — descriptions of all 22 tools
3. Operating rules (Plan Mode rules, permission-mode awareness, task-delivery expectations)
4. Safety and privacy constraints
5. UI communication conventions (how to format responses, when to use cards, when to ask)

**Dynamic half** (not cached):

1. Current timestamp and timezone
2. List of registered projects with their paths and statuses
3. Currently active Chief Agent tasks (from task-store)
4. Recent session memory snippets (V1, §7.4)
5. Current permission mode (Trust / Cautious)
6. Currently selected model

The split is realized at streamtext time:

```ts
// src/agent/context/system-prompt.ts
export function buildSystemMessages(session: Session): Array<SystemModelMessage> {
  return [
    {
      role: 'system',
      content: STATIC_PROMPT,
      providerOptions: {
        anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } },
      },
    },
    {
      role: 'system',
      content: buildDynamicPreamble(session),
    },
  ]
}
```

(The `openrouter` provider key is used when routing through OpenRouter; the doc treats the Anthropic form as canonical since the pass-through is verified.)

### 7.2 Auto-compaction

Borrowed from cc-src `services/compact/autoCompact.ts:62-91` and `services/compact/compact.ts`.

Constants:

```ts
const AUTOCOMPACT_BUFFER_TOKENS = 13_000
const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
const ERROR_THRESHOLD_BUFFER_TOKENS = 20_000
const MANUAL_COMPACT_BUFFER_TOKENS = 3_000
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3
```

Trigger: before each `streamText` call, estimate tokens for the pending messages. If `currentTokens > (contextWindow - AUTOCOMPACT_BUFFER_TOKENS)`, run compaction before proceeding. Token estimation uses the model's own tokenizer if available, otherwise a 4-chars-per-token rough estimate.

Compaction is a **separate LLM call** (`streamText` with `stopWhen: stepCountIs(1)`):

1. Take all messages except the last 2 turns (keep tail intact).
2. Call the same model with a compaction system prompt: "Produce a distilled summary of this conversation. Keep essential facts, decisions made, files touched, and open questions. Drop redundant tool outputs. Output under 2000 tokens."
3. Replace the compacted range with one synthetic assistant message `[CONVERSATION SUMMARY] …`.
4. Preserve task-store state (it's external to messages).

Circuit breaker: if compaction fails 3 times consecutively, stop trying and surface a warning in the UI. The user can manually press "Compact now" or "New session."

### 7.3 Tool result size management

Large tool outputs are a frequent source of context overflow. Each tool declares a `maxResultSizeChars` (default 100_000, cc-src precedent). The tool runner:

1. Runs execute.
2. If the stringified result exceeds `maxResultSizeChars`, it truncates and appends `[…truncated, original was N chars. Use Read with offset/limit to paginate.]`.
3. The truncated result is what both the LLM sees and what gets persisted.

Exception: `Bash` with `run_in_background: true` never truncates the returned handle (trivial size). Use `BashOutput` for paginated reads.

### 7.4 Session memory (V1, not MVP)

A background process that runs every ~10 turns: fork a `stepCountIs(5)` sub-agent with the prompt "Extract durable facts, decisions, and TODOs from this session that would be useful to remember across compactions. Append to memory file." The memory file lives at `~/.oneship/session-memory/<sessionId>.md` and is re-read into the dynamic preamble (§7.1) on each turn, so it survives compaction.

MVP ships without this; compaction alone handles most long-task cases. Memory is the next tier for edge cases where even compaction loses critical detail.

### 7.5 Context budget allocator

Rough allocation of the model's context window (for a 200k window):

- System prompt (static + dynamic): ~15k reserved
- Tool definitions: ~8k
- Session memory (V1): ~5k
- Response reservation: ~20k (so the model always has room to reply)
- Remaining for message history: ~152k

When message history exceeds the remaining budget (minus the auto-compact buffer of 13k), compaction fires.

---

## 8. Skill System

### 8.1 Location and format

OneShip has its own skills directory — distinct from `~/.claude/skills/` to avoid collision with Claude Code:

```
~/.oneship/skills/
├── audit-deps/
│   └── SKILL.md
├── daily-review/
│   └── SKILL.md
└── ship-release/
    └── SKILL.md
```

Each skill is a markdown file with YAML frontmatter:

```markdown
---
name: audit-deps
description: Check every project's dependencies for outdated or vulnerable packages
tools:
  - Read
  - Glob
  - Bash
  - TaskCreate
  - TaskUpdate
---

You are auditing dependencies across the workspace. For each project:

1. Read package.json to identify declared dependencies
2. Run `npm outdated --json` and parse the output
3. Run `npm audit --json` for security advisories
4. Create a task for each package that needs attention
5. Report a summary grouped by project
```

Frontmatter fields (MVP):

- `name` (auto-derived from directory if absent)
- `description` (one-liner; shown in `/skills` and in the system prompt if skill discovery is enabled)
- `tools` (optional; array of tool names to restrict the sub-agent's tool set; defaults to all tools)

V1+ fields (not in MVP): `model` (force a specific model for this skill), `hooks`, `memory`, `mcpServers`.

### 8.2 Skill discovery

On Agent Worker startup, `src/agent/skills/loader.ts` scans `~/.oneship/skills/**/SKILL.md` and builds an in-memory registry. Also scanned: a project-local `<cwd>/.oneship/skills/` (V1, not MVP — MVP only reads the user-global directory).

The `Skill` tool description dynamically includes "Available skills: audit-deps, daily-review, ship-release …" so the LLM knows what to call. Full skill bodies are not in the system prompt — only names and one-line descriptions.

### 8.3 Skill execution flow

Borrowed from cc-src `tools/SkillTool/SkillTool.ts:122-130`.

```ts
// src/agent/tools/skill.ts
export const SkillTool = tool({
  description: 'Invoke a user-defined skill by name. Available skills: ${skillList}',
  inputSchema: z.object({
    skill_name: z.string(),
    args: z.string().optional().describe('Optional arguments passed to the skill'),
  }),
  execute: async ({ skill_name, args }, { abortSignal, experimental_context }) => {
    const parentSession = experimental_context.session as Session
    const skill = skillRegistry.get(skill_name)
    if (!skill) return { error: `Skill "${skill_name}" not found` }

    // Compute the sub-agent's tool set:
    //   1. Start from skill.frontmatter.tools (or all tools if unspecified)
    //   2. Apply Plan Mode mask if parent is in Plan Mode (inherits)
    //   3. Apply permission-mode awareness (Cautious sub-agents stay Cautious)
    let allowedNames: string[] = skill.frontmatter.tools ?? Object.keys(allTools(parentSession))
    if (parentSession.planMode) {
      allowedNames = applyPlanModeMask(allowedNames)
    }

    const subSession = createSubSession({
      initialUserMessage: fillArgs(skill.body, args),
      toolNames: allowedNames,
      stepBudget: 25,
      parentSessionId: parentSession.id,
      planMode: parentSession.planMode,         // inherit
      permissionMode: parentSession.permissionMode, // inherit
    })

    const result = await runLoop(subSession, abortSignal)
    return { summary: result.finalAssistantText, turnsUsed: result.turns }
  },
})
```

Skill execution is a fork: same runtime, same worker process, but a separate message history and separate turn budget. The parent receives a compact summary as the tool result, not the full sub-conversation.

**Plan Mode inheritance is mandatory.** Without it, a sub-agent spawned by Skill could call Write/Edit/Bash freely, bypassing the user's "produce a plan first" intent. The same logic applies to the `Agent` tool.

**Frontmatter tools list is not authoritative.** It declares the skill author's intent, but the runtime always intersects it with the parent's effective mask. Trust mode + no plan mode = the skill gets exactly what the frontmatter asked for. Cautious mode + plan mode = the skill gets at most the read-only subset.

### 8.4 Progressive disclosure

Chief Agent does not see every skill's full body in its system prompt — just name and description. If the LLM wants more detail (e.g. "what does audit-deps do exactly?"), it can `Read` the SKILL.md directly. This keeps the base prompt compact while preserving the ability to introspect.

---

## 9. Task System

### 9.1 Storage

Tasks are persisted as JSONL files under the session directory:

```
~/.oneship/sessions/<sessionId>/tasks.jsonl
```

Each line is one task record:

```json
{"id":"t_01H...","subject":"Run npm audit","description":"...","status":"pending","owner":null,"blockedBy":[],"blocks":[],"metadata":{},"createdAt":1744574400000,"updatedAt":1744574400000}
```

JSONL is append-only for creates and updates (updates write a new line with the same id; readers take the latest). Periodic compaction (not LLM compaction — file compaction) rewrites the file when it exceeds 10MB, dropping superseded entries.

### 9.2 Task schema

```ts
interface Task {
  id: string                       // "t_" + nanoid
  subject: string                  // short imperative title
  description: string              // full description
  status: 'pending' | 'in_progress' | 'completed' | 'deleted'
  owner: string | null             // sub-agent name or null
  blockedBy: string[]              // task ids
  blocks: string[]                 // task ids (derived, maintained bidirectionally)
  metadata: Record<string, unknown>
  createdAt: number
  updatedAt: number
}
```

Blocking is bidirectional: when `TaskCreate` is called with `blockedBy: [t1, t2]`, the store also appends `t.id` to `t1.blocks` and `t2.blocks`. Enables DAG traversal for "what's ready to start?"

### 9.3 Task tools

- `TaskCreate({ subject, description, blockedBy?, metadata? })` → returns full task
- `TaskUpdate({ id, status?, subject?, description?, metadata?, blockedBy? })` → returns updated task
- `TaskList({ status?, limit?, includeDeleted? })` → returns array
- `TaskGet({ id })` → returns task or `null`

`TaskUpdate` **can mutate `blockedBy`**. When it does, the task-store recomputes the reciprocal `blocks` edges: removed ids have the task id pulled from their `blocks` arrays, added ids have it appended. This keeps the bidirectional invariant in §9.2 without making the client worry about both sides. Clients cannot directly mutate `blocks` — it is always derived.

No `TaskDelete` tool — deletion is via `TaskUpdate({ id, status: 'deleted' })`. When a task is deleted, its id is **not** removed from other tasks' `blockedBy` arrays (deletion is a tombstone, not a graph rewrite — the task-check stop hook in §14.2 ignores deleted entries). This makes "undo" cheap.

### 9.4 UI surface

MVP: a "Tasks" section in the Chief Agent chat sidebar (new, not the existing Tasks page). Shows pending / in_progress / completed with their status dots. V1: cross-session task aggregation in the existing `tasks-page.tsx`.

---

## 10. Cron System

### 10.1 Scheduler

A node-cron instance (`npm i node-cron`) runs inside the Agent Worker. Schedule persistence at `~/.oneship/crons.json`:

```json
{
  "crons": [
    {
      "id": "c_01H...",
      "schedule": "0 9 * * 1-5",
      "prompt": "Review open GitHub issues across all projects and summarize what needs attention today.",
      "sessionMode": "new-session",
      "createdAt": 1744574400000,
      "createdBySessionId": "s_01H..."
    }
  ]
}
```

### 10.2 Trigger flow

When a cron fires:

1. The scheduler creates a **new session** via the same `create-session` IPC the user uses to start a fresh chat, with `triggeredBy: { kind: 'cron', cronId }`.
2. The new session's `meta.json` records the cron id and the scheduled time, so the UI can group autonomous sessions separately.
3. The session starts with a synthetic system hint `[Triggered by cron job <id> on <schedule>]` followed by the cron's `prompt` as the first user message.
4. The session runs to completion (or until `stepCountIs(N)` hits, or it raises a suspension). For **cron-triggered sessions**, Plan/Ask suspensions are treated as failures: the segment is finished as `error`, the suspension is recorded but no human-facing card is shown, and a one-line entry is posted to the activity feed: "Cron job <id> needed input but no one was watching: <question or plan title>". The user can later open the autonomous session, see the suspension card, and resolve it manually — at which point the session resumes normally. Cautious suspensions in a cron context: the cron's own permission mode is forced to **Trust** at session creation, so Cautious never fires from cron-triggered work. (Open question §19-12 has additional details.)
5. A brief "Cron fired" notification is posted to the UI activity feed regardless of whether the user has the new session open.

Chief Agent chat UI shows cron-triggered sessions in a separate "Autonomous" group in the session picker (§16.6), distinct from user-initiated conversations. The user can switch into one to inspect what happened, or just glance at the activity feed for a one-line summary.

This explicitly **depends on multi-session support being in MVP** (§15.4). Cron and the user-interactive session must coexist; that is the whole point.

### 10.3 Cron tools

- `CronCreate({ schedule, prompt })` — schedule must be a valid cron expression. Validates with node-cron.
- `CronList()` — returns all scheduled jobs
- `CronDelete({ id })`

The Chief Agent can create a cron on the user's behalf during a conversation: "every weekday at 9am, review issues" → the LLM parses the natural-language schedule, produces a cron expression, calls `CronCreate`, and reports back. No separate settings-page UX required for MVP.

### 10.4 Safety

- Cron jobs run in the same Agent Worker process, so they share CPU/memory with interactive sessions. A misbehaving cron could impact responsiveness. MVP accepts this tradeoff; V1 may move crons to a sub-worker.
- Cron deletion is immediate; no confirmation prompt (Trust-mode default). In Cautious mode, `CronDelete` requires confirmation just like `Bash` does.

---

## 11. Plan Mode

### 11.1 Semantics

Plan Mode is a session-level flag (`session.planMode: boolean`). When `true`:

- `applyPlanModeMask(toolNames)` removes the destructive set: `Write / Edit / Bash / CronCreate / CronDelete / Agent`. The LLM cannot directly invoke them.
- `Skill` is **not** removed from the LLM's tool list — read-only skills are still useful in Plan Mode. But the sub-agent spawned by Skill **inherits Plan Mode** (§8.3), so the same mask applies recursively. A skill author who declared `tools: [Bash]` in frontmatter will find Bash silently dropped in Plan Mode.
- `Agent` (the generic sub-agent dispatcher) **is** removed in Plan Mode. The reason it differs from Skill: Skill is curated user content with frontmatter intent, so we let read-only skills run through it; Agent is a free-form LLM-authored sub-task and there is no good reason to allow free-form sub-tasks during planning. The model should plan, not delegate planning.
- The static system prompt contains a conditional section: "You are currently in PLAN MODE. Do not attempt to edit files or execute commands. Produce a plan using the Read/Glob/Grep tools, then call ExitPlanMode with the plan text when ready. You may invoke read-only Skills if they help you understand the situation, but Skills cannot modify files in this mode either."

### 11.2 Entering

The model enters Plan Mode in two ways:

1. **Self-directed**: the model calls `EnterPlanMode()` when facing a complex task. The system prompt encourages this for any task that will touch 3+ files.
2. **User-directed**: the UI has a "Plan first" toggle next to the chat input. When set, the next user message starts with Plan Mode pre-enabled.

### 11.3 Exiting

`ExitPlanMode({ plan: string })`:

1. Pushes a `{ kind: 'plan', suspensionId, plan }` SuspensionSpec onto `session.pendingSuspension`.
2. Returns a placeholder tool-result `{ __suspended: true, suspensionId }`.
3. The session's segment loop sees the pending suspension, aborts the current `streamText`, and emits `segment-finished: reason=suspended` along with `suspension-raised` carrying the spec.
4. Main shows a Plan Card with Approve / Modify / Reject buttons.
5. User's decision arrives as `resolve-suspension` from Main.
    - **Approve**: the placeholder tool-result on disk is rewritten to `{ approved: true }`, `session.planMode = false`, a synthetic user message "Plan approved. Proceed." is appended, and a new segment starts.
    - **Modify**: placeholder tool-result rewritten to `{ approved: true, modified: true }`, `planMode = false`, synthetic user message "Plan modified by user: <text>. Proceed." is appended, new segment starts.
    - **Reject**: placeholder tool-result rewritten to `{ approved: false, reason }`, `planMode` stays `true`, a new segment starts with a synthetic **user** message "Plan rejected: <reason>. Please revise." (Note: it must be a user message, not assistant — the model needs new instructions to react to, not its own voice. §15.5 step 5 is canonical.)

The placeholder rewrite (rather than appending a separate tool-result) is important: the model's tool-use protocol requires that every `tool_use` block be followed by exactly one `tool_result` for the same tool_use_id. Rewriting the placeholder satisfies that protocol cleanly while letting the resolution data flow back. See §15.5 for the full lifecycle.

### 11.4 Plan Mode × Trust/Cautious interaction

Orthogonal. Trust mode + Plan Mode = "I trust you to execute without per-tool confirmation, but for big tasks show me the plan first." This is the recommended default experience (echoing Claude Code's recent convergence).

---

## 12. Permission System

> **Phase 2 addendum**: §12 was rewritten on 2026-04-15 to match §6.3a. The original design had two modes (`trust` / `cautious`) and placed the policy decision inside a main-side tool runner. The current design has three modes (`trust` / `normal` / `strict`) and places policy **source of truth** in main, policy **evaluation** in the worker, and user **mediation** in main. See §6.3a Rule 3 for the role split and this section for the flows.

### 12.1 Three modes

- **Trust** (optional, autopilot): every tool class runs immediately. No confirmation cards. No blacklist. Users who opt into Trust accept the deal.
- **Normal** (default): `read`-class tools run immediately; `write`, `exec`, and `ui` classes prompt the user. This is the default for new sessions.
- **Strict**: every class including `read` prompts the user. For users who want to review every filesystem/process interaction.

Mode is per-session, initialized from the user's default in Preferences. The user can switch mid-session via a session-level toggle in the chief-chat UI.

The approval class of each tool is declared in the shared tool manifest (§6.3a, Rule 2). The interaction between mode and class is the truth table in §6.3a "Approval policy truth table" — not duplicated here.

### 12.2 `checkPermission` — worker-local pure function

The worker evaluates permission locally on every tool call using a pure function:

```ts
// src/agent/tools/check-permission.ts (Phase 2 implementation)
function checkPermission(
  session: Session,
  approvalClass: ApprovalClass,
  toolName: string,
  args: unknown,
): 'allow' | 'deny' | 'prompt-needed'
```

Inputs the function reads (all from worker-side session state):

- `session.meta.permissionMode` — the mode, kept in sync with main via `set-permission-mode` IPC
- `session.allowOnceClasses: Set<ApprovalClass>` — Allow-Always allowlist, session-scoped
- `session.singleUseApprovals: Set<string>` — single-use keys from prior Allow decisions, consumed on hit
- `approvalClass` — from the shared manifest
- `toolName`, `args` — for computing the single-use key

The function is pure: given the same inputs it always returns the same decision. No IO, no async, no IPC.

Evaluation rules (see also §6.3a truth table):

1. `approvalClass === 'ui'` → always `allow` (pass-through). UI-class tools do their own suspension via the `question` SuspensionSpec path; permission is not the right layer.
2. `mode === 'trust'` → always `allow` regardless of class.
3. If `session.allowOnceClasses.has(approvalClass)` → `allow` (user already said Allow Always for this class in this session).
4. If `session.singleUseApprovals.has(singleUseKey(toolName, args))` → `allow` and **consume** the key (delete from set).
5. `mode === 'normal'` AND `approvalClass === 'read'` → `allow`.
6. Otherwise → `prompt-needed`.

Why evaluation is in the worker, not main:

- The hot path (read-class tools in trust or normal modes) is just a map lookup plus a truth-table check. An RPC round-trip for every Read/Glob/Grep call would measurably slow segments that fan out across many files.
- State sync is cheap: main pushes mode changes via `set-permission-mode` and single-use additions via `stateUpdate` piggy-backed on `resolve-suspension` (§12.3). These are low-frequency events compared to tool calls.

### 12.3 Approval flow (uniform — all classes, both prompt and suspend paths)

All classes that need prompting go through the same flow. There is no "cautious-only" path anymore — the old §12.2 is superseded.

1. The worker tool wrapper for a gated tool calls `checkPermission(...)`.
2. **allow** → wrapper proceeds. For `local` tools, it runs the inner executor. For `rpc` tools, it sends `rpc.request { kind: 'tool.exec' }` to main and awaits the response.
3. **deny** → wrapper returns `{ error: 'user-denied' }` as the tool-result. (Deny is only produced by explicit user rejection of an earlier prompt whose outcome is still cached; in Phase 2a this path is only reached on re-emit after a denied suspension.)
4. **prompt-needed** → wrapper:
   - generates `suspensionId = nanoid()`
   - pushes `SuspensionSpec { kind: 'permission', suspensionId, messageId, partIndex, toolCallId, toolName, approvalClass, summary, args }` onto `session.pendingSuspension`
   - writes a `part-append { type: 'tool-result', toolCallId, result: { __suspended: true, suspensionId } }` placeholder to the event log
   - throws `SuspensionSignal(suspensionId)`
5. `runSegment` catches the signal, persists `suspension.json`, writes `message-finish`, returns `{reason: 'suspended'}`.
6. Worker sends `suspension-raised { sessionId, spec }` to main.
7. Main's `suspension-router` dispatches `permission.prompt { cardId, spec }` to the renderer. The renderer shows a PermissionCard with Allow / Allow Always (normal mode only) / Deny buttons.
8. User clicks a button. Renderer sends `permission.respond { cardId, action }` to main.
9. Main translates the action to a resolution and a state update, and sends `resolve-suspension { suspensionId, resolution, stateUpdate? }` to the worker:
   - **Allow** → `resolution: { kind: 'permission-allow' }`, `stateUpdate: { addSingleUseKey }`
   - **Allow Always** → `resolution: { kind: 'permission-allow-always' }`, `stateUpdate: { addAllowOnceClass }`
   - **Deny** → `resolution: { kind: 'permission-deny' }`, no `stateUpdate`
10. Worker applies `stateUpdate` (if present) **before** rewriting the placeholder. This ensures the next segment's `checkPermission` sees the new state.
11. Worker emits a `part-update` replacing the `__suspended` placeholder with the resolved tool-result:
    - Allow / Allow Always → `{ resolved: true }`
    - Deny → `{ error: 'user-denied' }`
12. Worker appends a synthetic user message describing the decision (e.g. `"[User allowed the previous Bash call]"`). This is what drives the LLM to re-emit the tool call (or not) on the next segment.
13. Worker deletes `suspension.json`, clears `pendingSuspension`.
14. Worker triggers a new `runLoop` iteration. If the LLM re-emits an Allow tool call with identical args, `checkPermission` hits the single-use key (or the allowlist) and the tool executes this time.

### 12.4 Trust mode is honest

No hidden allowlists or denylists in Trust mode. `rm -rf /` will run if the model calls it. The user chose Trust mode; this is the deal. In exchange, the experience is frictionless — which is what users running long autonomous tasks want.

Normal mode is the answer for users who want a middle ground; Strict is the answer for users who want maximum review. Each mode is internally consistent; there is no "mushy middle with the worst of each."

---

## 13. Error Recovery

### 13.1 Tool errors

A tool that throws is caught in the tool runner and converted into a `tool-result` part with `{ error: <sanitized message> }`. Vercel AI SDK passes this back to the LLM as a tool result the model can see and react to. This matches cc-src `query.ts:136-143`.

Sanitization: strip stack traces, absolute paths outside the workspace, and API secrets. Helper at `src/agent/runtime/sanitize-error.ts`.

### 13.2 API retries

Wrapping `streamText` with a retry helper borrowed from cc-src `services/api/withRetry.ts:52-200`:

- **429 (rate limit)** — up to 10 retries, exponential backoff `BASE_DELAY_MS * 2^attempt` with jitter, foreground (user waiting) only.
- **529 (overload)** — up to 3 retries, same backoff.
- **prompt_too_long** — no retry; triggers forced compaction, then one retry; if it fails again, raise to user.
- **Network errors** (ECONNRESET, EPIPE) — up to 5 retries.
- **401 / invalid key** — no retry; surface immediately ("Your OpenRouter API key is invalid. Update it in Preferences.").
- **Non-retryable errors** — wrap as `CannotRetryError`, surface to UI.

### 13.3 Permission denials

When a user denies a permission prompt (in Normal or Strict mode), the resolved tool-result is `{ error: 'user-denied' }`. The LLM treats this like any other tool error — usually it either asks the user why or tries a different approach. See §12.3 for the flow.

### 13.4 Turn-level errors

If the `streamText` call itself throws (after retries exhausted), the segment ends with `segment-finished: reason=error, error=<message>` and `session.meta.lastSegmentReason = 'error'` is persisted. The UI shows a system message card with a "Retry" button. The session state is preserved — the user can retry or continue with a different message.

### 13.5 Worker crashes

Covered in §4.2. Auto-respawn, session state reload from disk.

---

## 14. Stop Hook

### 14.1 MVP: protocol layer only

The Anthropic Messages API protocol already enforces that `tool_use` blocks must be followed by `tool_result`, which triggers another turn. Vercel AI SDK's `streamText({ stopWhen: stepCountIs(N) })` correctly keeps the loop running until either (a) the model produces a final message with no tool calls, or (b) the step cap is hit. The step cap here is the same N defined in §5.5 (default 50). This is the 80% "long-task continuation" mechanism, and it works out of the box.

MVP ships with this only.

### 14.2 V1: task-check policy hook

V1 adds a `onBeforeFinish(finalMessage, context) => { continue: boolean, injectMessage?: string }` callback that runs whenever the model is about to naturally end the turn. If it returns `continue: true`, the injectMessage is appended as a synthetic user message and the loop resumes for another step.

Initial built-in hook: **task-check**. Logic:

```ts
function taskCheckHook(session: Session, final: AssistantMessage): HookResult {
  const openTasks = session.taskStore.list({ status: ['pending', 'in_progress'] })
  const unblocked = openTasks.filter(t => t.blockedBy.every(id => session.taskStore.get(id)?.status === 'completed'))
  if (unblocked.length === 0) return { continue: false }
  return {
    continue: true,
    injectMessage: `You still have ${unblocked.length} unfinished task(s): ${unblocked.map(t => t.subject).join(', ')}. Continue working on them.`,
  }
}
```

This directly copies cc-src's `query/stopHooks.ts:334-453` pattern for team-based continuation.

The hook API is pluggable so users can eventually author their own stop hooks via settings. V1 also: allow disabling the task-check hook per session (some tasks are exploratory and the user wants the agent to stop naturally).

---

## 15. Persistence and Session Management

### 15.1 Session directory layout

```
~/.oneship/sessions/<sessionId>/
├── meta.json           # session metadata (snapshot, replaced atomically)
├── events.jsonl        # event log of message changes — see §15.2
├── snapshot.json       # optional cached UIMessage[] at a known event offset (§15.2.4)
├── tasks.jsonl         # task store (§9)
├── suspension.json     # active suspension (if any) — see §15.5
└── memory.md           # session memory (V1)
```

`meta.json` includes:

```ts
interface SessionMeta {
  sessionId: string
  createdAt: number
  updatedAt: number
  model: string
  // NOTE (Phase 2a): widened to `'trust' | 'normal' | 'strict'` — `'cautious'` is retired.
  permissionMode: 'trust' | 'normal' | 'strict'
  planMode: boolean
  triggeredBy: { kind: 'user' } | { kind: 'cron', cronId: string, scheduledFor: number }
  lastSegmentReason: SegmentFinishReason | null   // for restart classification
  title: string | null                             // user-renameable
  eventLogLength: number                            // number of events in events.jsonl, for snapshot validation
  snapshotEventOffset: number | null                // event index that snapshot.json reflects (null = no snapshot yet)
}
```

`suspension.json` exists only when the session is parked on a Plan/Ask/Cautious card. It is deleted when the suspension resolves. Its presence at startup tells the worker "this session ended its last segment in a suspended state."

### 15.2 Persistence model: event log + snapshot

Chief Agent's in-memory format is Vercel AI SDK v6's **`UIMessage[]`**. The on-disk format is an **event log** (`events.jsonl`) that, when replayed, reconstructs that array — plus an optional cached snapshot to avoid replaying from zero on every load.

Why a UIMessage:

- `UIMessage` preserves tool-invocation parts with state (`input-available`, `output-available`, `output-error`), which ModelMessage flattens
- `UIMessage` carries message `id` and `createdAt` for stable UI rendering
- The SDK ships `convertToModelMessages(uiMessages)` to downconvert at API call time

Why an event log instead of "one UIMessage per line, append-only":

- Tool-result placeholders need to be **rewritten** when a suspension resolves (§15.5). Append-only-of-full-messages would create stale duplicates and require a "latest wins" merge per id, which is fragile.
- Streaming: text deltas, tool-call inputs, and tool-results all arrive as discrete events. The natural unit of write is the event, not the message.
- Crash recovery: an event log is naturally idempotent. Partial writes leave a truncated log, which `replay()` simply tolerates (the last incomplete line is dropped on read).

#### 15.2.1 Event types

`events.jsonl` contains one JSON object per line. Each is a `LogEvent`:

```ts
type LogEvent =
  | { type: 'message-start', messageId: string, role: 'user' | 'assistant' | 'system', createdAt: number }
  | { type: 'part-append', messageId: string, part: UIMessagePart }
  | { type: 'part-update', messageId: string, partIndex: number, part: UIMessagePart }
  | { type: 'message-finish', messageId: string }
  // Tool-result placeholder rewrites go through part-update too — the part being
  // updated is the tool-result whose content needs to change. We identify the
  // exact part by (messageId, partIndex) computed at suspension time and stored
  // in suspension.json so resolution can find it without scanning.
```

That's it — four event kinds. No "patch" of arbitrary fields, no half-defined "tombstone." Every state transition the runtime cares about is a `message-start`, a `part-append`, a `part-update`, or a `message-finish`.

**`message-finish` is a state mutation, not a marker.** When `replay()` sees a `message-finish`, it sets `msg.isComplete = true` on the corresponding UIMessage. Sessions that never receive a `message-finish` for a message (because the worker crashed or the segment was aborted mid-stream) leave that message with `isComplete === false`, which is the canonical "open / streaming / interrupted" state. The UI uses `isComplete` to decide whether to show a streaming cursor; compaction uses it to decide whether to emit a `message-finish` event when serializing; any future feature that needs "this message can be edited / retried / replied to" gates on it.

`isComplete` lives on the UIMessage itself (in `metadata.isComplete`, since Vercel AI SDK v6's UIMessage has a `metadata` field for app-defined fields). This means it round-trips through `snapshot.json` for free — snapshots are just `uiMessages` arrays.

#### 15.2.2 Replay

```ts
// src/agent/services/conversation-store.ts
function replay(events: LogEvent[]): UIMessage[] {
  const messages: UIMessage[] = []
  const byId = new Map<string, UIMessage>()
  for (const ev of events) {
    switch (ev.type) {
      case 'message-start': {
        const msg: UIMessage = {
          id: ev.messageId,
          role: ev.role,
          createdAt: ev.createdAt,
          parts: [],
          metadata: { isComplete: false },  // open until a message-finish arrives
        }
        messages.push(msg)
        byId.set(ev.messageId, msg)
        break
      }
      case 'part-append': {
        byId.get(ev.messageId)?.parts.push(ev.part)
        break
      }
      case 'part-update': {
        const msg = byId.get(ev.messageId)
        if (msg && ev.partIndex < msg.parts.length) msg.parts[ev.partIndex] = ev.part
        break
      }
      case 'message-finish': {
        const msg = byId.get(ev.messageId)
        if (msg) msg.metadata = { ...msg.metadata, isComplete: true }
        break
      }
    }
  }
  return messages
}

function isMessageComplete(msg: UIMessage): boolean {
  return msg.metadata?.isComplete === true
}
```

Read on session open: load events.jsonl line by line, JSON.parse each, drop any line that fails to parse (truncated tail from a crash), feed to `replay()`. Pass result through `validateUIMessages({ messages, tools })` to catch schema drift (tools renamed between releases).

#### 15.2.3 Write

Every state transition the session emits to its in-memory `uiMessages` is also serialized as one or more `LogEvent`s and `appendFile`'d to `events.jsonl` immediately (with fsync at segment boundaries; intra-segment streaming deltas can be lazily fsync'd). The append is the source of truth — if it fails, the in-memory mutation is rolled back and an error surfaces.

The write path is symmetric with `replay()`: when the session writes a `message-finish` event, it must **also** set `msg.metadata.isComplete = true` on the in-memory `UIMessage` in the same operation. This keeps the in-memory state and the on-disk event log consistent without relying on a re-replay. Practically this means the session writer is structured as:

```ts
function writeMessageFinish(session: Session, messageId: string): void {
  const msg = session.uiMessages.find(m => m.id === messageId)
  if (msg) msg.metadata = { ...msg.metadata, isComplete: true }
  appendEvent(session, { type: 'message-finish', messageId })
}
```

Same pattern for `message-start` (creates the message with `isComplete: false`), `part-append` (pushes to `parts`), and `part-update` (replaces a part). The session never mutates `uiMessages` directly — every mutation goes through one of these write helpers.

For high-volume streaming text: the dispatcher batches consecutive `part-update` events targeting the same text part within a 50ms window into a single write, to avoid one disk write per token.

#### 15.2.4 Snapshot (optimization)

Replaying 10k events on every session open is wasteful. Periodically (every N=500 events, or on session close), the worker writes a `snapshot.json` containing the current `uiMessages` (with each message's `metadata.isComplete` flag included — `metadata` round-trips for free since `uiMessages` is just a JSON-serializable array) and updates `meta.json.snapshotEventOffset` to the event index it reflects (i.e., "this snapshot covers events `[0, snapshotEventOffset)`").

On load:

1. If `snapshot.json` is missing → replay events.jsonl from index 0.
2. If `snapshot.json` exists but fails to parse → replay from index 0 (it is corrupt).
3. If `snapshot.json` exists and parses, but its `snapshotEventOffset` is **greater than** the actual line count of events.jsonl → snapshot is **invalid** (events.jsonl was truncated or replaced behind the snapshot's back); drop the snapshot and replay from 0.
4. Otherwise → load `snapshot.json` as the starting `uiMessages`, then replay events from line index `snapshotEventOffset` onward. New events written since the snapshot are applied incrementally on top. **This is the normal happy path.** `snapshotEventOffset !== eventLogLength` is **expected** here — it just means new events have been appended since the snapshot was taken. That is exactly what incremental replay is for; do not treat it as stale.

The only "stale snapshot" state is case 3 above (offset points past the end of the log). The earlier draft's "drop if offset !== eventLogLength" rule was wrong — it would discard every healthy snapshot the moment a single new event was written.

Snapshot is a pure cache. Cases 1, 2, and 3 all degrade gracefully to replay-from-zero. The session is always recoverable from events.jsonl alone.

#### 15.2.5 Compaction (file-level, not LLM compaction)

When events.jsonl exceeds 10MB or 50k events (whichever first), the worker rewrites the log so that replaying the new file produces the exact same `uiMessages` as replaying the old one — but with fewer entries.

The minimal set of events required to reconstruct one current `UIMessage` with N parts is: **one `message-start`, then one `part-append` per part, then one `message-finish`** (if the original had a finish marker, which assistant messages always do once streaming completes). Skipping `message-finish` would lose the "this message is complete" semantic that the UI uses to stop the streaming cursor; skipping per-part appends would lose multi-part messages entirely. Both were bugs in the previous draft.

Compaction algorithm:

```ts
function compactEventLog(uiMessages: UIMessage[]): LogEvent[] {
  const out: LogEvent[] = []
  for (const msg of uiMessages) {
    out.push({ type: 'message-start', messageId: msg.id, role: msg.role, createdAt: msg.createdAt })
    for (const part of msg.parts) {
      out.push({ type: 'part-append', messageId: msg.id, part })
    }
    // Emit message-finish iff the message is complete. isMessageComplete()
    // reads msg.metadata.isComplete, which was set by replay() when the
    // original message-finish event was processed (or never set, if the
    // message was interrupted mid-stream). Either way, the source of truth
    // is the message itself — no external Session state is consulted.
    if (isMessageComplete(msg)) {
      out.push({ type: 'message-finish', messageId: msg.id })
    }
  }
  return out
}
```

The procedure on disk:

1. Replay current events.jsonl into memory (using the snapshot if available — compaction is allowed to bootstrap from one).
2. Write a fresh `snapshot.json.tmp` with the current `uiMessages`, fsync, rename to `snapshot.json`.
3. Compute the compacted event list via `compactEventLog(uiMessages)`. Write to `events.jsonl.tmp`, fsync, rename to `events.jsonl`.
4. Update `meta.json` atomically: `eventLogLength = compactedEvents.length`, `snapshotEventOffset = compactedEvents.length` (the new snapshot covers everything in the new log).
5. fsync the session directory.

Compaction is best-effort and runs in a background tick, scheduled only when the session has no in-progress segment (`segmentInProgress === false` and `pendingSuspension === null`). If the worker dies mid-compaction, the original `events.jsonl` is still on disk because every rewrite goes through tmpfile + rename. The next session open just loads the old log.

#### 15.2.6 Migration

The existing `src/main/conversation-store.ts` will be **deleted** and replaced by `src/agent/services/conversation-store.ts` inside the worker. Chief Agent chat's IPC will go through the worker directly (not the old `chat:sendMessage` handler, which will also be deleted). The old `Message` type (role + content) is insufficient for tool use; no migration — existing placeholder data is dropped.

On first startup after the upgrade, the Agent Worker's startup routine (§15.3) will best-effort delete any legacy conversation files under the old path (`<appUserData>/../ge/conversations/*.json` per the current implementation). Failures are logged but not surfaced. After MVP ships, this cleanup code can be removed in V1.

### 15.3 Startup: resume sessions

On Agent Worker start:

1. Read `~/.oneship/sessions/` and enumerate all session directories.
2. For each, load `meta.json` only (lazy hydration — full message history loads on demand when the session is opened).
3. Build a `SessionMeta[]` index in memory; emit `ready` to Main.

When Main receives `ready`, it requests `list-sessions` to populate the session picker. The user clicks a session → Main sends `open-session` → worker fully loads that session's `events.jsonl` (via `replay()` from the snapshot if available), `tasks.jsonl`, and `suspension.json`, hydrates a `Session` object, and replies with `session-opened` carrying the snapshot.

**Restart classification**. When loading a session's meta, the worker uses `lastSegmentReason` and the presence of `suspension.json` to decide what state to put the session into:

| State on disk | UI shows | Resumed behavior |
|---|---|---|
| `lastSegmentReason: 'natural'`, no suspension | Idle, ready for next user message | Just listen for input |
| `lastSegmentReason: 'suspended'`, suspension.json exists | The Plan/Ask/Cautious card from before, still actionable | User can resolve it; resolution starts a new segment as if no restart happened |
| `lastSegmentReason: 'suspended'`, suspension.json missing (partial flush during shutdown) | "Interrupted by app restart" system notice | Treat as interrupted; user can type anything to continue. The orphan placeholder in events.jsonl is cleaned by `cleanupOrphanPlaceholders()` before the next segment runs (§15.5). |
| `lastSegmentReason: 'aborted'` or `'error'`, no suspension | "Interrupted by app restart" system notice | User can type "continue" or anything else; new segment starts |
| `lastSegmentReason` was never set (in-flight crash before first finish) | Same as aborted — show "interrupted" notice | Same as aborted |

**In-flight LLM turns are not resumed.** If the worker dies mid-stream, the partial assistant message that was being streamed is *not* recoverable — Vercel AI SDK doesn't expose the half-stream and Anthropic doesn't allow resuming it. The user just sees the message stop where it stopped, with the interrupted notice. They re-prompt to continue. This matches success criterion #2 (§1).

**Background shells are not resumed either.** A `Bash(run_in_background: true)` whose shell was alive when the worker died is gone — the child process is killed when the parent dies. The session's `Map<shellId, RunningShell>` is empty on restart. Tools that try to use a stale shellId after restart get `{ error: 'shell <id> no longer exists (worker restart)' }` and the model adapts.

A clean delete during shutdown (vs. crash) is best-effort: the worker tries to flush all pending message writes and any active suspension before exiting. If shutdown is hard-killed, the in-flight state may be partial; the restart classification above handles that correctly.

### 15.4 Multi-session support (MVP)

Multi-session was originally planned for V1 but **moved to MVP** because cron (§10) needs it: cron-triggered sessions must run in parallel with whatever the user is doing in the interactive session. Forcing cron to "share" the active session would mix autonomous and interactive transcripts, which is strictly worse than building the multi-session machinery upfront.

**Design:**

- The Agent Worker holds a `Map<sessionId, Session>` of currently-loaded sessions in memory. On first open, sessions are hydrated from disk; closing a session drops it from the map and writes pending state.
- Each `Session` has its own conversation history, tasks, suspension state, in-flight segment, and (V1) memory file. They are completely independent runtimes that happen to share the worker process.
- The worker can run **multiple segments in parallel** — interactive and cron sessions can stream simultaneously. A semaphore caps concurrent segments at 4 (configurable; tunes for memory and Anthropic rate limits).
- IPC messages (§4.3) all carry `sessionId`, so Main routes incoming user messages to the right session and routes outgoing deltas to the right UI surface.

**UI:**

- Chief Agent chat has a left rail (or a top dropdown) listing sessions, grouped into:
  - **Interactive** — sessions started by the user
  - **Autonomous** — sessions started by cron jobs
- Each row shows: title (auto-generated from first user message or set by user), last activity time, status indicator (idle / running / suspended).
- Clicking switches the active view. The previous session keeps running in the background; the user can come back to it later.
- A "New session" button creates a fresh interactive session.

**Constraints:**

- The active visible session and any background sessions all share the same Agent Worker process. CPU spikes in one session affect responsiveness in others. MVP accepts this — V2+ may move heavy autonomous work to a sub-worker (open question §19).
- Concurrent suspensions across sessions: each session has its own `pendingSuspension`, so a Plan card in one session does not block input to another. The UI shows multiple session badges in the rail.

### 15.5 Suspension protocol — the full state machine

This is the section codex called out as missing. It is the single most important runtime contract in the spec because Plan, Ask, and Cautious all rely on it.

**Mental model**: Vercel AI SDK's `streamText` is a one-shot async iterable that runs from "start" to "model said it's done OR step cap fired OR you abort." It cannot be paused and resumed. So we never try. Instead, we **end one streamText cleanly the moment a tool wants to suspend**, persist the suspension state to disk, wait for resolution from Main, then **start a fresh streamText** whose message history includes the resolution.

**Definitions:**

- A **turn** is the user's intent: "send this message, get me a response." A turn produces 1+ segments.
- A **segment** is one `streamText` call. It runs until either:
  - The model produces a final assistant message with no tool calls → `natural` finish
  - A tool's execute() pushes a SuspensionSpec → `suspended` finish (segment aborted on next event)
  - The step cap (`stopWhen: stepCountIs(50)`) fires → `step-cap` finish
  - The user clicks Cancel or the worker shuts down → `aborted` finish
  - An unrecoverable error after retries → `error` finish

**The lifecycle of a suspension:**

```
1. Tool decides to suspend
   └─ tool.execute() returns { __suspended: true, suspensionId: 'sus_abc' }
   └─ session.pendingSuspension = { suspensionId, kind, messageId, partIndex, ... }
        (messageId + partIndex come from the in-progress assistant message
         and the part index of this very tool-result)
   └─ session.handleStreamEvent picks up the placeholder tool-result
   └─ session emits a part-append event to events.jsonl writing the
      placeholder AS-IS (it's the tool_result block on disk for now)

2. Session loop notices pendingSuspension after the stream event
   └─ abortController.abort('suspension')
   └─ The for-await loop in runSegment unwinds
   └─ runSegment returns 'suspended'

3. Session writes suspension.json to disk (atomic via tmpfile + rename)
        suspension.json contents include suspensionId, kind, messageId,
        partIndex, full SuspensionSpec for UI rebuild, createdAt
   └─ session.meta.lastSegmentReason = 'suspended'
   └─ Updates meta.json
   └─ Emits suspension-raised IPC carrying the SuspensionSpec
   └─ Emits segment-finished: reason=suspended

4. Main shows the appropriate card (Plan / Ask / Permission)
   └─ User makes a decision, possibly minutes later
   └─ Main sends resolve-suspension IPC, optionally with a stateUpdate
      payload (§12.3) to sync allow-once state into the worker

5. Worker receives resolve-suspension
   └─ Applies stateUpdate (if any) to session.allowOnceClasses /
      session.singleUseApprovals BEFORE rewriting the placeholder
   └─ Validates suspensionId matches session.pendingSuspension
   └─ Computes the new tool-result content based on resolution kind
        - plan-approved → { resolved: true, approved: true }
        - plan-modified → { resolved: true, approved: true, modified: true }
        - plan-rejected → { resolved: true, approved: false, reason }
        - question-answered → { resolved: true, answer }
        - permission-allow → { resolved: true }
        - permission-allow-always → { resolved: true }
        - permission-deny → { error: 'user-denied' }
      (Phase 2a note: unlike the old 'cautious-allowed' path, permission-allow
      does NOT re-invoke the underlying tool here. The LLM re-emits the tool
      call on the next segment; the second attempt hits checkPermission with
      the now-populated single-use key or allowlist, and the actual execution
      happens then. See §12.3 steps 11–14 and Phase 2a spec §8.2.)
   └─ Appends a `part-update` event keyed by (messageId, partIndex) from
        the saved suspension. Replay logic merges it into uiMessages so
        the placeholder is now the real tool-result. The tool_use_id is
        not part of the lookup; we use the structural address (msgId,
        partIdx) saved at suspension time.
   └─ For plan suspensions, additionally appends `message-start` +
        `part-append` events for the synthetic USER message with the
        next instruction ("Plan approved. Proceed." / "Plan modified by
        user: <text>. Proceed." / "Plan rejected: <reason>. Please revise.")
   └─ For question and cautious, no extra user message — the rewritten
        tool-result is enough
   └─ Deletes suspension.json
   └─ Clears session.pendingSuspension

6. Worker starts a new segment
   └─ cleanupOrphanPlaceholders(session) sweeps any leftover __suspended
      parts (deferred parallel-call losers) into error part-updates
   └─ runSegment() is called with the updated message history
   └─ streamText resumes the conversation; the model sees the tool_result
      it expected and continues
```

**Why the placeholder rewrite (vs. appending a follow-up)?**

The Anthropic Messages API requires that every `tool_use` block be paired with exactly one `tool_result` block referencing the same `tool_use_id`. If we appended a separate "the answer is X" user message instead of completing the original tool-result, the protocol would be violated and the next API call would error. Rewriting the placeholder is the only protocol-correct way to "fill in" the answer after the fact.

**Resolution write protocol (matters for crash recovery)**:

When resolving a suspension, the worker performs writes in this exact order, with `fsync` between each step. All writes go through the event log defined in §15.2.1.

1. **Append a `part-update` event** to events.jsonl identifying the placeholder tool-result by `(messageId, partIndex)` (both stored in `suspension.json` at suspension time) and replacing it with the resolution payload.
2. **fsync** events.jsonl.
3. (For plan resolutions only) **Append a `message-start` + `part-append`** for the synthetic user message ("Plan approved. Proceed." / "Plan modified by user: ..." / "Plan rejected: ... Please revise.") and **fsync** again.
4. **Delete** suspension.json.
5. **fsync** the session directory.
6. **Update** `meta.json` (`lastSegmentReason`, `eventLogLength`) atomically (write to `meta.json.tmp`, fsync, rename), then fsync the directory.

Why this order: if the process dies after step 3 but before step 4, on restart we will see "`lastSegmentReason: 'suspended'` + suspension.json still exists" — the session re-emits the suspension and the user resolves it again. The previously-appended `part-update` replacement is still in the log but will be **superseded** by the new resolution's `part-update` (event log replay is order-preserving — the latest `part-update` for a given `(messageId, partIndex)` wins). Idempotent.

If the order were reversed (delete suspension.json first), a crash could leave a session that thinks it's idle but has an unrewritten placeholder in its history — the next API call would fail because the model would see a `__suspended` marker as a tool-result.

**Pre-segment cleanup of orphan placeholders**:

Before *every* `runSegment` call (not just after a restart), the session runs `cleanupOrphanPlaceholders()`:

```ts
function cleanupOrphanPlaceholders(session: Session): void {
  // Walk session.uiMessages looking for any tool-result part whose content
  // is still { __suspended: true, suspensionId }. For each one:
  //   1. If session.pendingSuspension?.suspensionId === suspensionId,
  //      it's the active suspension — leave it alone.
  //   2. Otherwise it's an orphan (deferred parallel-call loser, or a
  //      legacy placeholder from a botched recovery). Append a part-update
  //      event rewriting it to { error: 'superseded; this tool call did
  //      not complete because an earlier action in the same step required
  //      user input. Re-issue if still needed.' }
  //   3. fsync events.jsonl.
}
```

This guarantees that whenever the session is about to send `uiMessages` to the model (§5.4 runSegment), the message history is **always protocol-valid** — every `tool_use` has a matching, fully-realized `tool_result`. No more "hope the next dispatcher catches it" fragility.

The active suspension's placeholder *is* preserved through this sweep because the active suspension is exactly the case where we *want* the next segment to use the resolved content; resolution rewrites the placeholder via the protocol above, then the next segment sees it as a real tool-result.

**Edge cases:**

- **Crash during a suspension** (before resolve-suspension arrives): `suspension.json` survives the crash. On restart, the session loads, sees the suspension, re-emits `suspension-raised`, the UI rebuilds the card. The user resolves it as if nothing happened.
- **Crash mid-resolution**: handled by the resolution write protocol above. Idempotent re-resolution.
- **User cancels mid-suspension**: `cancel-current-turn` runs the rewrite path with a `{ error: 'user-cancelled', hint: 'User cancelled the pending action.' }` payload, deletes suspension.json, sets `lastSegmentReason='aborted'`, and the session goes idle. No new segment is started. The chat shows a small system notice "Cancelled. Send a new message to continue."
- **Parallel tool calls in one step that all suspend**: this *is* possible. Vercel AI SDK executes all tool calls from one step in parallel by default. If the model emits, say, two permission-gated Bash calls, both dispatcher wrappers will run their permission check and try to push to `pendingSuspension`. The session uses a **first-wins queue**:

    ```ts
    interface SessionRuntime {
      // ... others
      pendingSuspension: SuspensionSpec | null
      deferredSuspensions: SuspensionSpec[]   // arrived after pendingSuspension was set
    }
    ```

    The first SuspensionSpec to arrive wins and aborts the segment. Subsequent ones in the same step are pushed to `deferredSuspensions` and their tool dispatchers return the same `__suspended` placeholder anyway. The session writes the placeholder events normally; the placeholders persist as orphans in events.jsonl. On the **next** `runSegment` call, `cleanupOrphanPlaceholders()` (above) sweeps them all into `{ error: 'superseded' }` part-updates **before** the new streamText is started. The model sees errors for the deferred calls and re-issues them if it still wants to.

    This is the explicit answer to codex's concern about "cleanup happens too late or not at all" — the sweep is now guaranteed pre-segment, not lazy-on-next-dispatcher.

    The cleaner alternative — forcing the model to make at most one suspending tool call per step — is not enforceable from the client side without using `toolChoice: 'required'` per tool, which conflicts with normal multi-tool behavior. The deferred-supersede design accepts the ugliness in exchange for correctness.

- **Permission denial before the tool ran**: handled by step 5 of the lifecycle above. Under the Phase 2a permission model (§12.3), a denied permission means the wrapper records `{ error: 'user-denied' }` as the resolved tool-result and the LLM sees the denial in the next segment's history; the tool itself never runs. (Historically, pre-Phase 2a "cautious" tools used to run their real `execute()` during resolution — that model is retired.)

**Minimal data structures:**

```ts
// In-memory
// NOTE (Phase 2a): `shells` moved out of worker — it's main-side now, owned
// by src/main/tool-executors/bash.ts per §6.3a Rule 1 (Bash is rpc).
interface SessionRuntime {
  meta: SessionMeta
  uiMessages: UIMessage[]
  tasks: TaskStore
  pendingSuspension: SuspensionSpec | null     // first-wins, aborts segment
  deferredSuspensions: SuspensionSpec[]        // parallel-tool-call losers (Phase 2b — Phase 2a uses invariant check instead)
  allowOnceClasses: Set<ApprovalClass>         // Phase 2a — allow-always allowlist, session-scoped
  singleUseApprovals: Set<string>              // Phase 2a — single-use permission keys, consumed on hit
  abortController: AbortController | null
  segmentInProgress: boolean
}

// Persisted
// suspension.json
interface PersistedSuspension {
  suspensionId: string
  // NOTE (Phase 2a): 'cautious' is retired; its replacement is 'permission'.
  kind: 'plan' | 'question' | 'permission'
  toolUseId: string                   // the tool_use block this is paired with (for diagnostics)
  messageId: string                   // the assistant message containing the tool-result placeholder
  partIndex: number                   // the part index inside that message — the rewrite target
  spec: SuspensionSpec                // full spec for UI rebuild
  createdAt: number
}
```

---

## 16. UI Design

### 16.1 Style direction

**Conversational** — large whitespace, variable-width typography, bubbles and rich cards. Chosen over Terminal-ish because OneShip's audience includes non-CLI-native users, and the Jarvis product identity is "AI partner," not "better CLI."

The Warm Swiss style system (Funnel Sans Bold headings, Geist Regular body, IBM Plex Mono for code/tool names, cream canvas #FAF8F5, white cards, violet accent #8B5CF6) is the foundation. This spec uses those tokens throughout.

### 16.2 Message types and their renderers

Each message in the conversation stream is a `UIMessagePart`. MVP ships renderers for these kinds:

1. **User text** — right-aligned bubble, white card with small shadow
2. **Assistant text** — left-indented, avatar, with streaming character-by-character
3. **Assistant thinking** — muted italic, left gray bar, collapsed by default with "Show thinking" toggle
4. **Tool call pill** (for lightweight tools: Read, Glob, Grep, ListProjects, TaskList, TaskGet, BashOutput, WebSearch, WebFetch) — a capsule like `[●] Read → src/auth.ts · 62 lines`. Single line. Click to expand raw result.
5. **Tool call card** (for heavyweight tools: Write, Edit) — a diff card with file header, line markers, monospace body.
6. **Bash card** (for `Bash` with stdout/stderr) — a terminal-look card with streamed output, shrinkable after completion.
7. **Plan card** (for `ExitPlanMode` suspensions) — a prominent white card with "◆ Plan" label, plan text in monospace, Approve / Modify / Reject buttons.
8. **Ask card** (for `AskUserQuestion`) — prominent white card with "◆ Ask" label, the question, optional choice buttons, a freeform input fallback.
9. **Task update chip** (for Task* tools) — small inline chip like `[✓] TaskUpdate: auth-refactor → completed`.
10. **Error card** — red-tinted card with the error, a "Retry" button.
11. **System notice** (cron-triggered sessions, compaction happened, context warning) — small gray italic line.

### 16.3 Component registry

Each renderer is an independent React component under `src/renderer/components/chat/messages/`:

```
messages/
├── user-bubble.tsx
├── assistant-text.tsx
├── thinking-block.tsx
├── tool-call-pill.tsx
├── tool-call-card.tsx       # generic fallback
├── edit-diff-card.tsx
├── write-file-card.tsx
├── bash-card.tsx
├── plan-card.tsx
├── ask-card.tsx
├── task-chip.tsx
├── error-card.tsx
└── system-notice.tsx
```

And a registry that maps `UIMessagePart` → component:

```ts
// src/renderer/components/chat/part-registry.tsx
export const partRegistry: Record<string, React.FC<any>> = {
  'text-user': UserBubble,
  'text-assistant': AssistantText,
  'thinking': ThinkingBlock,
  'tool-call:Read': ToolCallPill,
  'tool-call:Glob': ToolCallPill,
  'tool-call:Edit': EditDiffCard,
  'tool-call:Write': WriteFileCard,
  'tool-call:Bash': BashCard,
  'tool-call:ExitPlanMode': PlanCard,
  'tool-call:AskUserQuestion': AskCard,
  'tool-call:TaskCreate': TaskChip,
  // …
  default: ToolCallPill,  // any unrecognized tool defaults to pill
}
```

New tools get a renderer added to the registry; adding a tool does not require touching the core chat component.

### 16.4 Streaming and layout

Messages stream in as deltas — each delta extends the latest `UIMessage`'s parts array. The chat component observes the session store and re-renders only affected rows (virtualized list). Streaming text uses CSS to smooth the character-by-character appearance.

### 16.5 Upgrades from existing chat UI

The current `chief-chat.tsx` uses `MessageList` and `ChatInput` components with a simple `{role, content}` model. These will be updated to consume `UIMessage` and dispatch to the part registry. The existing terminal-lane chat (project-chat.tsx) remains on the old simple format for now — V1 will decide whether to unify.

### 16.6 Sidebar

MVP: a sidebar in Chief Agent chat with two panels:

**Top — Session picker** (multi-session, MVP §15.4):

- Two groups: **Interactive** and **Autonomous** (cron-triggered)
- Each row: title (auto or user-set), last-activity time, status dot (idle / running / suspended)
- Click to switch active session
- "New session" button at the top of the Interactive group

**Bottom — Current session details:**

- Active tasks (pending / in_progress count + list)
- Active suspension (if any) with a quick-jump to the card in the chat view
- Model / permission mode toggle (per session)

V1: cron job management UI, Chief Agent activity feed, cross-session task aggregation.

---

## 17. Files and Directory Layout

### 17.1 New code in the repo

```
src/agent/                      # NEW — isolated agent worker code
├── index.ts                    # entrypoint (utilityProcess fork target)
├── tsconfig.json               # isolated TS project ref (no ../main)
├── ipc/
│   ├── server.ts               # handles ToWorker messages
│   └── rpc-client.ts           # promise wrapper for worker→main RPC
├── runtime/
│   ├── loop.ts                 # runSegment, streamText integration, abort handling
│   ├── model.ts                # OpenRouter provider factory
│   ├── retry.ts                # withRetry helper (port of cc-src)
│   └── sanitize-error.ts       # error message cleanup
├── context/
│   ├── system-prompt.ts        # static + dynamic system message assembly
│   ├── compact.ts              # auto-compaction
│   └── token-estimator.ts      # rough token counting
├── session/
│   ├── session.ts              # Session class, state machine
│   ├── session-manager.ts      # Map<sessionId, Session>, multi-session orchestration
│   ├── store.ts                # session directory I/O
│   ├── suspension.ts           # SuspensionSpec, persistence, resolution helpers
│   └── resume.ts               # startup enumeration + lazy hydration
├── tools/                      # Worker-side tool executors (execution: 'local')
│   ├── index.ts                # allTools() registry + plan-mode mask
│   ├── manifest-wrapper.ts     # wrapLocalTool / wrapRpcTool — applies checkPermission, throws SuspensionSignal
│   ├── check-permission.ts     # §12.2 pure function
│   ├── suspension-signal.ts    # SuspensionSignal error class
│   ├── read.ts                 # local / read
│   ├── glob.ts                 # local / read
│   ├── grep.ts                 # local / read
│   ├── web-fetch.ts            # local / read
│   ├── web-search.ts           # local / read (Phase 2b)
│   ├── write.ts                # local / write
│   ├── edit.ts                 # local / write
│   ├── ask-user-question.ts    # local / ui — control-flow suspending tool (§6.3a)
│   ├── task-create.ts          # Phase 2b
│   ├── task-update.ts          # Phase 2b
│   ├── task-list.ts            # Phase 2b
│   ├── task-get.ts             # Phase 2b
│   ├── skill.ts                # Phase 2b
│   ├── agent.ts                # Phase 2b
│   ├── cron-create.ts          # Phase 2b
│   ├── cron-list.ts            # Phase 2b
│   ├── cron-delete.ts          # Phase 2b
│   ├── enter-plan-mode.ts      # Phase 2b
│   └── exit-plan-mode.ts       # Phase 2b
├── services/
│   ├── task-store.ts           # JSONL task persistence (Phase 2b)
│   ├── cron.ts                 # node-cron wrapper (Phase 2b)
│   ├── conversation-store.ts   # event log + snapshot + replay (§15.2)
│   ├── event-log.ts            # LogEvent types, append/fsync, batched writes
│   └── fs.ts                   # safe file helpers
└── skills/
    ├── loader.ts               # scan ~/.oneship/skills (Phase 2b)
    └── frontmatter.ts          # parse SKILL.md YAML (Phase 2b)

src/shared/                     # Cross-process shared modules
├── agent-protocol.ts           # types for main↔worker IPC
├── tool-manifest.ts            # NEW — the shared manifest layer from §6.3a (name / description / inputSchema / execution / approvalClass / summarize). Imported by worker AND main.
└── tool-guards/                # NEW — pure security checks imported by both worker-side local executors AND main-side rpc executors. Per §6.3a Rule 3.
    ├── path-guard.ts           # workspace bounds + home-dotfile deny list
    └── index.ts

src/main/
├── agent-host.ts               # utilityProcess lifecycle + IPC client + RPC correlation
├── permission-policy.ts        # default mode getter/setter + prompt routing; does NOT run checkPermission (that is worker-local per §12.2)
├── suspension-router.ts        # dispatches suspension-raised → permission.prompt / ask.prompt / plan.prompt
├── chief-preferences.ts        # API key + model + default permission mode
├── secret-store.ts             # API key persistence (Phase 2a: config.json 0600; V1: keytar)
├── tool-executors/             # Main-side rpc executors (execution: 'rpc')
│   ├── index.ts                # registry keyed on manifest name
│   ├── bash.ts                 # rpc / exec. Owns the session-scoped shell registry (§6.4)
│   ├── bash-output.ts          # rpc / read. Phase 2b — reads from main-side shell registry
│   ├── monitor.ts              # rpc / read. Phase 2b — waits on main-side shell registry
│   └── list-projects.ts        # rpc / read. Phase 2b
└── index.ts                    # registers chief.* IPC handlers + suspension-router + tool-executors registry

src/renderer/
├── pages/chief-chat.tsx        # modified — use new IPC + UIMessage
├── stores/chief-session.ts     # NEW — Zustand store for current session state
└── components/chat/
    ├── part-registry.tsx       # NEW
    └── messages/               # NEW — 13 renderer components listed in §16.3
```

### 17.2 User data layout

```
~/.oneship/                     # user home OneShip data
├── config.json                 # preferences: model, permission mode, OpenRouter key (or pointer to keychain)
├── sessions/
│   └── <sessionId>/
│       ├── meta.json
│       ├── events.jsonl
│       ├── snapshot.json
│       ├── tasks.jsonl
│       └── memory.md           # V1
├── skills/
│   └── <skill-name>/SKILL.md
├── crons.json
└── logs/
    └── agent-worker-<date>.log
```

Secrets (OpenRouter API key) should eventually use `keytar` / OS keychain. MVP accepts `config.json` with a user-readable key and a Preferences UI for setting it. Security hardening is a V1 task.

---

## 18. MVP / V1 Scope

### 18.1 MVP — must ship for the product to be usable

Infrastructure:

- [ ] `src/agent/` directory with TS project refs
- [ ] `utilityProcess.fork` + `AgentHost` lifecycle + IPC protocol
- [ ] Worker crash auto-respawn (3 retries in 60s)
- [ ] `agent-protocol.ts` shared types
- [ ] OpenRouter provider setup, model list fetching, default `anthropic/claude-sonnet-4.6`

Runtime:

- [ ] `runSegment()` with `streamText` + `stopWhen: stepCountIs(50)` + abort-on-suspension
- [ ] Error sanitization + retry wrapper (429/529/prompt_too_long/network/401)
- [ ] Static/dynamic system prompt split with `cacheControl: ephemeral`
- [ ] Auto-compaction with buffer thresholds and circuit breaker
- [ ] Tool result size management (per-tool `maxResultSizeChars`)

All 22 tools (MVP gets the skeleton of each; advanced features of each are V1):

- [ ] Read, Write, Edit, Glob, Grep, Bash, BashOutput, Monitor, WebFetch, WebSearch
- [ ] TaskCreate/Update/List/Get + task-store JSONL
- [ ] Skill (with fork subagent execution)
- [ ] Agent (generic fork subagent)
- [ ] ListProjects (with Main RPC)
- [ ] AskUserQuestion (segment suspension via §15.5)
- [ ] CronCreate/List/Delete + node-cron scheduler
- [ ] EnterPlanMode / ExitPlanMode + suspension mechanic

Skill system:

- [ ] Load `~/.oneship/skills/*/SKILL.md` with YAML frontmatter
- [ ] Skill tool with tool-subset restriction
- [ ] Sub-agent execution with independent step budget

Permission + Plan Mode:

- [ ] Trust / Cautious mode switch (per-session)
- [ ] Cautious mode flows through suspension protocol (§12.2 + §15.5)
- [ ] EnterPlanMode / ExitPlanMode tools
- [ ] Plan Mode mask: removes Write/Edit/Bash/Cron*/Agent
- [ ] Plan Mode does NOT remove Skill, but Skill sub-agents inherit Plan Mode (§8.3 + §11.1)
- [ ] Skill frontmatter `tools:` is intersected with parent's effective mask (not authoritative)

Persistence + multi-session:

- [ ] Session directory layout (meta.json, events.jsonl, snapshot.json, tasks.jsonl, suspension.json)
- [ ] Event log (§15.2): `LogEvent` types (message-start / part-append / part-update / message-finish), append-with-fsync, batched streaming-text writes
- [ ] Replay function: events → UIMessage[] with truncated-tail tolerance
- [ ] Snapshot writer (every 500 events or on close) + meta.json offset tracking
- [ ] File-level compaction (10MB / 50k events threshold, tmpfile + rename)
- [ ] Migration: delete legacy ~/.oneship conversations and old conversation-store.ts
- [ ] Multi-session SessionManager with `Map<sessionId, Session>` (§15.4)
- [ ] Lazy hydration (meta-only on startup, full load on open)
- [ ] Restart classification (idle / suspended / interrupted) using `lastSegmentReason`
- [ ] Concurrent segment semaphore (cap = 4)
- [ ] "New session" UI action
- [ ] Session picker UI (Interactive / Autonomous groups)

Suspension protocol (§15.5):

- [ ] `SuspensionSpec` types in agent-protocol.ts
- [ ] `pendingSuspension` + `deferredSuspensions` fields on Session
- [ ] Suspending tool dispatchers (Plan / Ask / Cautious) record (messageId, partIndex)
- [ ] Segment loop detects `pendingSuspension` → aborts → returns `'suspended'`
- [ ] suspension.json atomic write + delete on resolution (with messageId/partIndex)
- [ ] resolve-suspension IPC handler with all 6 resolution kinds
- [ ] Placeholder rewrite via `part-update` event keyed by (messageId, partIndex)
- [ ] Synthetic USER message append (not assistant) for plan-approved/modified/rejected
- [ ] `cleanupOrphanPlaceholders()` runs before every runSegment (sweeps deferred losers)
- [ ] Crash recovery for active suspensions (re-emit on session open)
- [ ] cancel-current-turn handling for active suspensions

UI:

- [ ] New `chief-chat.tsx` using UIMessage and part registry
- [ ] 13 renderer components in §16.3 (user-bubble, assistant-text, thinking-block, tool-call-pill, tool-call-card, edit-diff-card, write-file-card, bash-card, plan-card, ask-card, task-chip, error-card, system-notice)
- [ ] Streaming delta rendering
- [ ] Plan card with Approve/Modify/Reject flow
- [ ] Ask card with choice buttons + freeform input fallback
- [ ] Minimal sidebar (tasks + plan + model/mode toggle + new session)
- [ ] Preferences page: OpenRouter API key, model picker (from `/models`), permission mode
- [ ] Old `chat:*` IPC handlers and old `conversation-store.ts` deleted

### 18.2 V1 — shortly after MVP, rounding out quality and safety

- [ ] Session memory (background fork, ~10 turns cadence, re-injected into dynamic preamble)
- [ ] Stop hook task-check policy layer with pluggable hooks
- [ ] Cron notifications in activity feed (autonomous session grouping is MVP via §15.4)
- [ ] EnterWorktree / ExitWorktree tools (git worktree integration) — cc-src parity
- [ ] Model fallback chain (Opus → Sonnet → Haiku on specific errors)
- [ ] Project-local `<cwd>/.oneship/skills/` loading
- [ ] Secrets in OS keychain (keytar) instead of plain config.json
- [ ] Context budget allocator refinement (explicit per-section tracking)
- [ ] Per-tool CSS polish for the remaining renderers
- [ ] Turn budget user-configurable per session
- [ ] `GetProjectContext` tool (richer situational awareness)
- [ ] Cross-session task aggregation in the existing `tasks-page.tsx`
- [ ] Skill authoring UX in Preferences (scaffold new skill button)
- [ ] Manual compaction trigger button
- [ ] Token/cost meter in UI (using OpenRouter `x-openrouter-cost` header)

### 18.3 V2+ or "not planned yet"

- Multi-agent team coordination (SendMessage, TeamCreate, TeamDelete)
- MCP server integration per-agent
- NotebookEdit tool
- RemoteTrigger for externally-initiated runs
- Project Lead Agent (separate in-project chat backend)
- Byte-exact prompt cache sharing for parallel sub-agent fork (cc-src `forkSubagent` pattern)
- Cross-worker sub-agent isolation (cron jobs in their own worker)

---

## 19. Open Questions

Decisions to make before or during implementation:

1. **API key storage in MVP**: plain `config.json` vs. keytar/OS keychain. Lean toward plain in MVP to reduce native-module packaging complexity, then keytar in V1.
2. **Token estimator**: exact (model tokenizer) vs. approximate (4 chars/token). Approximate is good enough for auto-compaction trigger (§7.2), and avoids depending on `@anthropic-ai/tokenizer` which may not match OpenAI/Gemini models. Approximate for MVP.
3. **Path-guard scope**: should Chief Agent be allowed to read/write outside of registered project paths? E.g. `~/Downloads`. Lean "yes, within the user home" — OneShip is a local-trust app, not a sandboxed web runtime.
4. **Plan Mode entry trigger**: how strongly does the system prompt push the model toward entering Plan Mode for complex tasks? Too weak = it skips; too strong = it plans trivial tasks. Start soft, tune from real use.
5. **Sub-agent parallelism**: when `Agent` tool is called, does it run serially (block the parent turn) or in parallel with the parent? MVP is serial for simplicity. V1 can add parallel fork once there's a use case.
6. **Compaction model**: use the same model as the main loop, or force a cheap/fast model for compaction to save cost? Same model for MVP (simpler, consistent); V1 can add a dedicated `compactionModelId` preference.
7. **Skill body caching**: do skill SKILL.md files get cached via `providerOptions` when their bodies become sub-agent user messages? This is a worthwhile optimization but not critical for MVP.
8. **UI placement of Chief Agent entrypoint**: is it in the sidebar top ("Chief Agent") distinct from projects, or is it a special "overseer" project? Existing sidebar already has a Chief Agent entry — check visual hierarchy when implementing.
9. **What happens when the selected model doesn't support tool use?** (Some OpenRouter-listed models don't.) MVP: show a warning in the model picker and block selection. V1: disable tool-calling mode and fall back to text-only chat.
10. **Concurrent segment cap (§15.4)**: 4 was a guess. Need to validate against (a) Anthropic's per-key rate limits, (b) realistic OneShip memory ceiling. May want to make it configurable in Preferences.
11. **Cron-triggered session lifecycle**: do completed cron sessions stay in the Autonomous list forever, or auto-archive after N days? MVP: keep them all, manual delete. V1: auto-archive option.
12. **Suspension on cron-only sessions**: §10.2 step 4 locks this in: cron-triggered sessions force `permissionMode='trust'` at creation (so Cautious never fires), and Plan/Ask suspensions end the segment as `error` with a notification in the activity feed. The user can later open the autonomous session and resolve the still-pending suspension manually. Open detail: should the cron auto-retry the next scheduled run if the previous one suspended unresolved, or should it skip until the user clears the block? Lean "skip" to avoid duplicate notifications.
13. **Multi-session sub-worker (§15.4 constraint)**: should heavy autonomous (cron) sessions run in a separate utilityProcess from the interactive worker, so a runaway cron can't block the user's interactive chat? V1 or V2 design question; MVP shares one worker.
14. **Restart classification UX**: when the user opens a session whose `lastSegmentReason` is `aborted` or `error` due to an app crash, how loud is the notice? A gentle gray system message vs. a red banner. Lean gentle — crashes happen, we don't want to alarm the user every time.

---

## 20. References

### cc-src (Claude Code source) — key files cited

- `/Users/a/Desktop/cc-src/constants/prompts.ts:114` — `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`
- `/Users/a/Desktop/cc-src/utils/api.ts:321-404` — `splitSysPromptPrefix`
- `/Users/a/Desktop/cc-src/services/api/claude.ts:3220-3237` — cache control integration
- `/Users/a/Desktop/cc-src/services/compact/autoCompact.ts:62-91` — thresholds and trigger
- `/Users/a/Desktop/cc-src/services/compact/compact.ts` — compaction LLM call
- `/Users/a/Desktop/cc-src/services/api/withRetry.ts:52-200` — retry logic
- `/Users/a/Desktop/cc-src/query.ts:136-143` — tool error blocks
- `/Users/a/Desktop/cc-src/query.ts:1705-1710` — max turns enforcement
- `/Users/a/Desktop/cc-src/tools/AgentTool/loadAgentsDir.ts:105-165` — agent schemas
- `/Users/a/Desktop/cc-src/tools/AgentTool/runAgent.ts:95-150` — agent execution
- `/Users/a/Desktop/cc-src/tools/SkillTool/SkillTool.ts:81-130` — skill execution
- `/Users/a/Desktop/cc-src/skills/loadSkillsDir.ts:403-431` — skill loader
- `/Users/a/Desktop/cc-src/query/stopHooks.ts:180-453` — stop hook policy
- `/Users/a/Desktop/cc-src/tools/TaskCreateTool/TaskCreateTool.ts:48-80` — task tool shape

### External documentation

- Vercel AI SDK v6 docs: https://ai-sdk.dev/docs
- `streamText` reference: https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text
- `tool()` reference: https://ai-sdk.dev/docs/reference/ai-sdk-core/tool
- ToolLoopAgent + agents overview: https://ai-sdk.dev/docs/foundations/agents
- Chatbot message persistence (UIMessage): https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence
- Anthropic provider options (cacheControl): https://ai-sdk.dev/providers/ai-sdk-providers/anthropic
- OpenRouter provider: https://github.com/OpenRouterTeam/ai-sdk-provider
- Electron utilityProcess: https://www.electronjs.org/docs/latest/api/utility-process
- Anthropic prompt caching: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching

### OneShip internal

- Existing `src/main/conversation-store.ts` (to be deleted)
- Existing `src/renderer/pages/chief-chat.tsx` (to be rewritten)
- Existing `src/main/index.ts:520-555` (chat IPC handlers, to be removed)
- Existing `src/main/hook-server.ts`, `terminal-manager.ts`, `session-store.ts` (unchanged)

---

**End of spec.**
