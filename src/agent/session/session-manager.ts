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
    return Array.from(this.knownMetas.values()).sort((a, b) => {
      const byUpdated = b.updatedAt - a.updatedAt
      if (byUpdated !== 0) return byUpdated
      return a.sessionId.localeCompare(b.sessionId)
    })
  }
}
