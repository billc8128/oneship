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

import type { UIMessage, UIMessagePart, UIDataTypes, UITools } from 'ai'

// ============================================================================
// Shared UIMessage aliases
// ============================================================================
//
// The ai v6 package declares `UIMessage<METADATA, DATA_PARTS, TOOLS>` with
// all three type parameters defaulted, so `UIMessage` on its own already
// type-checks cleanly. But `UIMessagePart<DATA_TYPES, TOOLS>` has NO
// defaults, so writing a bare `UIMessagePart` is a TS2314 error.
//
// Rather than repeat `UIMessagePart<UIDataTypes, UITools>` at every call
// site (event log, replay(), IPC payloads, renderer store), we define two
// aliases here and every Chief Agent module imports them from this file.
// When/if we later narrow to a custom data/tool registry, this is the one
// spot that changes — no module-by-module rewrite.

export type AgentUIMessage = UIMessage<unknown, UIDataTypes, UITools>
export type AgentUIMessagePart = UIMessagePart<UIDataTypes, UITools>

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
  uiMessages: AgentUIMessage[]
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
  | { type: 'message-delta'; sessionId: string; partialMessage: AgentUIMessagePart }
  | { type: 'message-complete'; sessionId: string; message: AgentUIMessage }
  | {
      type: 'segment-finished'
      sessionId: string
      reason: SegmentFinishReason
      error?: string
    }
  // Synthetic message emitted by AgentHost (NOT by the worker) when the
  // respawn gate exhausts and the worker is no longer being restarted.
  // Carries no sessionId because it's a global state — every open session
  // in the renderer is affected. Phase 2 will add a "restart" IPC the
  // renderer can use to reset the gate and try again.
  | { type: 'worker-unavailable'; reason: string }
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
  'worker-unavailable',
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
