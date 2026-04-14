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
    await mgr.createSession({ sessionId: 's_close' })
    await mgr.closeSession('s_close')
    expect(mgr.get('s_close')).toBeUndefined()

    // closeSession must NOT remove the entry from knownMetas — the session
    // still exists on disk and must still appear in listSessions(). Verify
    // this directly, otherwise re-opening below could mask a knownMetas
    // deletion bug by re-populating the cache.
    const list = await mgr.listSessions()
    expect(list.find((m) => m.sessionId === 's_close')).toBeDefined()

    // Re-opening still works
    const b = await mgr.openSession('s_close')
    expect(b.meta.sessionId).toBe('s_close')
  })
})
