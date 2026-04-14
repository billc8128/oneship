import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface SessionRecord {
  id: string
  projectId: string
  cwd: string
  shell: string
  label: string
  createdAt: number
  updatedAt: number
  lifecycle: 'live' | 'closed' | 'exited' | 'crashed' | 'interrupted'
  lastStatus: 'idle' | 'working' | 'waiting' | 'done' | 'error'
  lastEventSummary: string
  source?: string | null
  lastHookName?: string | null
  lastToolName?: string | null
}

export class SessionStore {
  private readonly sessionsFile: string
  private readonly corruptedSessionsFile: string

  constructor(stateDir: string) {
    mkdirSync(stateDir, { recursive: true })
    this.sessionsFile = join(stateDir, 'sessions.json')
    this.corruptedSessionsFile = join(stateDir, 'sessions.corrupt.json')
  }

  list(): SessionRecord[] {
    return this.readSessions()
  }

  upsert(record: SessionRecord): void {
    const sessions = this.readSessions()
    const nextSessions = sessions.filter((session) => session.id !== record.id)
    nextSessions.push(record)
    this.writeSessions(nextSessions)
  }

  get(id: string): SessionRecord | null {
    return this.list().find((session) => session.id === id) ?? null
  }

  listByProject(projectId?: string): SessionRecord[] {
    const sessions = this.readSessions()
    if (!projectId) {
      return sessions
    }

    return sessions.filter((session) => session.projectId === projectId)
  }

  patch(id: string, patch: Partial<SessionRecord>): SessionRecord | null {
    const existing = this.get(id)
    if (!existing) {
      return null
    }

    const nextRecord = { ...existing, ...patch }
    this.upsert(nextRecord)
    return nextRecord
  }

  forget(id: string): boolean {
    const sessions = this.readSessions()
    const nextSessions = sessions.filter((session) => session.id !== id)
    if (nextSessions.length === sessions.length) {
      return false
    }

    this.writeSessions(nextSessions)
    return true
  }

  countByProject(projectId: string): number {
    return this.readSessions().filter((session) => session.projectId === projectId).length
  }

  // Returns the smallest available "Terminal N" number among LIVE sessions
  // for this project. Historical/exited sessions should not keep consuming
  // visible terminal labels because users currently only navigate live tabs.
  // Labels not matching the "Terminal N" pattern (e.g. user-renamed ones)
  // are ignored.
  nextTerminalNumber(projectId: string): number {
    const sessions = this.readSessions().filter(
      (session) => session.projectId === projectId && session.lifecycle === 'live',
    )
    const used = new Set<number>()
    for (const session of sessions) {
      const match = session.label.match(/^Terminal (\d+)$/)
      if (match) {
        used.add(parseInt(match[1], 10))
      }
    }

    let next = 1
    while (used.has(next)) {
      next += 1
    }
    return next
  }

  markLiveSessionsAsInterrupted(timestamp = Date.now()): void {
    const sessions = this.readSessions()
    let changed = false

    const nextSessions = sessions.map((session) => {
      if (session.lifecycle !== 'live') {
        return session
      }

      changed = true
      return {
        ...session,
        lifecycle: 'interrupted' as const,
        updatedAt: timestamp,
      }
    })

    if (changed) {
      this.writeSessions(nextSessions)
    }
  }

  private readSessions(): SessionRecord[] {
    if (!existsSync(this.sessionsFile)) {
      return []
    }

    try {
      const parsed = JSON.parse(readFileSync(this.sessionsFile, 'utf8')) as SessionRecord[]
      return parsed.sort((left, right) => right.updatedAt - left.updatedAt)
    } catch {
      this.quarantineCorruptedSessionsFile()
      return []
    }
  }

  private writeSessions(sessions: SessionRecord[]): void {
    const tempFile = join(dirname(this.sessionsFile), 'sessions.tmp.json')
    writeFileSync(tempFile, JSON.stringify(sessions, null, 2))
    renameSync(tempFile, this.sessionsFile)
  }

  private quarantineCorruptedSessionsFile(): void {
    if (!existsSync(this.sessionsFile)) {
      return
    }

    try {
      renameSync(this.sessionsFile, this.corruptedSessionsFile)
    } catch {
      writeFileSync(this.corruptedSessionsFile, readFileSync(this.sessionsFile, 'utf8'))
      writeFileSync(this.sessionsFile, '[]')
    }
  }
}
