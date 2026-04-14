import type { AgentUIMessage, AgentUIMessagePart } from '../../shared/agent-protocol'
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
 * Reconstruct AgentUIMessage[] from an event log. Pure function — no I/O.
 *
 * Spec reference: §15.2.2.
 *
 * The Phase 1 write path never produces 'part-update' events, but replay
 * handles them anyway so that future phases (suspension protocol in Phase 4)
 * can emit them without changing this function.
 *
 * Forgiving on missing-id references: an event that names a messageId not
 * seen in a prior message-start is dropped silently. This is defensive
 * against truncated event logs that may have dropped a message-start line
 * due to a crash (event-log's readEvents also stops at truncation, so in
 * practice this is rare).
 */
export function replay(events: LogEvent[]): AgentUIMessage[] {
  const messages: AgentUIMessage[] = []
  const byId = new Map<string, AgentUIMessage>()
  for (const ev of events) {
    switch (ev.type) {
      case 'message-start': {
        const msg: AgentUIMessage = {
          id: ev.messageId,
          role: ev.role,
          parts: [],
          metadata: { isComplete: false, createdAt: ev.createdAt },
        } as AgentUIMessage
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
        // Guard both bounds: a negative partIndex from a corrupted log would
        // otherwise assign to a non-array property (arr[-1] = x silently sets
        // the "-1" string key on the array object). Phase 1 never writes
        // part-update events, but replay is defensive against any future or
        // corrupted event log.
        if (msg && ev.partIndex >= 0 && ev.partIndex < msg.parts.length) {
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
 * Set by `message-finish` during replay, or by `writeMessageFinish`.
 *
 * The `metadata` field on AgentUIMessage is declared as `unknown` in the
 * ai package's UIMessage type (it's intended as an app-defined extension
 * point), so this helper does the narrowing once in one place.
 */
export function isMessageComplete(msg: AgentUIMessage): boolean {
  const meta = msg.metadata as { isComplete?: boolean } | undefined
  return meta?.isComplete === true
}

// =============================================================================
// Write helpers — symmetric with replay().
//
// CRITICAL ordering: every helper APPENDS the LogEvent to disk FIRST, and
// only mutates in-memory `uiMessages` AFTER appendEvent() has resolved.
// If the disk write throws, the in-memory array is untouched and the error
// propagates to the caller. This matches §15.2.3's "the event log is the
// source of truth" rule. An in-memory-first ordering would let a failed
// write leave uiMessages ahead of the log, breaking snapshot/replay drift
// invariants.
// =============================================================================

export async function writeMessageStart(
  logPath: string,
  uiMessages: AgentUIMessage[],
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
  const msg: AgentUIMessage = {
    id: args.messageId,
    role: args.role,
    parts: [],
    metadata: { isComplete: false, createdAt: args.createdAt },
  } as AgentUIMessage
  uiMessages.push(msg)
}

export async function writePartAppend(
  logPath: string,
  uiMessages: AgentUIMessage[],
  args: { messageId: string; part: AgentUIMessagePart }
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
  uiMessages: AgentUIMessage[],
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
 *
 * The signature is locked now so Phase 4 can fill in the body without
 * renaming the function or changing its parameters at every call site.
 */
export async function writePartUpdate(
  _logPath: string,
  _uiMessages: AgentUIMessage[],
  _args: { messageId: string; partIndex: number; part: AgentUIMessagePart }
): Promise<void> {
  throw new Phase1NotImplemented('writePartUpdate (suspension placeholder rewrite)')
}
