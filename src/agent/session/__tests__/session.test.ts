import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Session } from '../session'
import { agentRoot, sessionDir, eventLogPath, readMeta } from '../store'
import { readEvents } from '../../services/event-log'
import { isMessageComplete } from '../../services/conversation-store'

// All tests redirect ~/.oneship/sessions to a tmpdir so they don't pollute
// the real user data directory.
let originalHome: string | undefined
let originalAgentRoot: string | undefined
let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'oneship-session-test-'))
  originalHome = process.env.HOME
  originalAgentRoot = process.env.ONESHIP_AGENT_ROOT
  process.env.HOME = tmp
  process.env.ONESHIP_AGENT_ROOT = join(tmp, '.oneship-dev')
})

afterEach(() => {
  process.env.HOME = originalHome
  process.env.ONESHIP_AGENT_ROOT = originalAgentRoot
  rmSync(tmp, { recursive: true, force: true })
})

describe('Session', () => {
  it('create() persists meta.json and an empty event log directory', async () => {
    const session = await Session.create({ sessionId: 's_abc' })
    expect(session.meta.sessionId).toBe('s_abc')

    // session directory is under the redirected HOME
    const dir = sessionDir('s_abc')
    expect(dir.startsWith(join(tmp, '.oneship-dev'))).toBe(true)

    // meta.json actually round-trips through disk
    const onDisk = await readMeta('s_abc')
    expect(onDisk).not.toBeNull()
    expect(onDisk?.sessionId).toBe('s_abc')
    expect(onDisk?.model).toBe('phase1-stub')
    expect(onDisk?.permissionMode).toBe('trust')
    expect(onDisk?.triggeredBy).toEqual({ kind: 'user' })
    expect(onDisk?.eventLogLength).toBe(0)
    expect(onDisk?.lastSegmentReason).toBeNull()

    // events.jsonl does NOT yet exist — no events appended
    expect(existsSync(eventLogPath('s_abc'))).toBe(false)
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

  it('appendUserMessage does NOT touch lastSegmentReason', async () => {
    const session = await Session.create({ sessionId: 's_seg' })
    // A real Phase 2+ session could have a non-natural prior reason. We
    // simulate it here by reaching into meta directly (the class doesn't
    // expose a setter, but for the invariant test we forge the state).
    session.meta.lastSegmentReason = 'error'

    await session.appendUserMessage('continue after error')

    // A user message must NOT overwrite a real finish reason left by a
    // previous segment — segment lifecycle owns that field, not append.
    expect(session.meta.lastSegmentReason).toBe('error')
  })

  it('appendAssistantStubReply sets lastSegmentReason to natural', async () => {
    const session = await Session.create({ sessionId: 's_seg2' })
    session.meta.lastSegmentReason = 'error'

    await session.appendAssistantStubReply()

    // The stub reply stands in for a completed LLM segment, so it DOES
    // write the finish reason.
    expect(session.meta.lastSegmentReason).toBe('natural')
  })

  it('prefers ONESHIP_AGENT_ROOT over HOME when deriving the agent root', () => {
    expect(agentRoot(process.env, process.env.HOME!)).toBe(join(tmp, '.oneship-dev'))
  })
})
