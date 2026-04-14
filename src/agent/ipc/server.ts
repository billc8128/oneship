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
      //
      // CONTRACT FOR MAIN-SIDE CALLERS (Task 11+): if you sent `create-session`,
      // do NOT follow up with an `open-session` for the same id — you'll
      // receive the snapshot here and a duplicate `session-opened` from the
      // case below would re-render the empty state. The renderer should treat
      // the create→opened pair as atomic.
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
