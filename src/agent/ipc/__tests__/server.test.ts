import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { startIpcServer, type IpcChannel } from '../server'
import type { ToWorker, ToMain } from '../../../shared/agent-protocol'

class TestChannel implements IpcChannel {
  private listeners: ((m: ToWorker) => void)[] = []
  outgoing: ToMain[] = []
  postMessage(m: ToMain): void { this.outgoing.push(m) }
  onMessage(cb: (m: ToWorker) => void): void { this.listeners.push(cb) }
  // Test helper: simulate Main sending a message
  send(m: ToWorker): void { for (const l of this.listeners) l(m) }
  // Wait for next outgoing message of given type (poll, simple)
  async waitFor(type: ToMain['type'], timeoutMs = 1000): Promise<ToMain> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const found = this.outgoing.find((m) => m.type === type)
      if (found) return found
      await new Promise((r) => setTimeout(r, 5))
    }
    throw new Error(`Timed out waiting for ${type}`)
  }
}

let originalHome: string | undefined
let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'oneship-ipc-test-'))
  originalHome = process.env.HOME
  process.env.HOME = tmp
})

afterEach(() => {
  process.env.HOME = originalHome
  rmSync(tmp, { recursive: true, force: true })
})

describe('IPC server', () => {
  it('emits ready immediately on start', async () => {
    const ch = new TestChannel()
    await startIpcServer(ch)
    await ch.waitFor('ready')
  })

  it('handles create-session and replies with session-created', async () => {
    const ch = new TestChannel()
    await startIpcServer(ch)
    await ch.waitFor('ready')

    ch.send({ type: 'create-session', sessionId: 's_abc' })
    const reply = await ch.waitFor('session-created')
    expect((reply as { sessionId: string }).sessionId).toBe('s_abc')
  })

  it('full round-trip: create → send-user-message → message-complete (assistant)', async () => {
    const ch = new TestChannel()
    await startIpcServer(ch)
    await ch.waitFor('ready')

    ch.send({ type: 'create-session', sessionId: 's_round' })
    await ch.waitFor('session-created')

    ch.send({ type: 'send-user-message', sessionId: 's_round', content: 'hello' })
    // Two message-complete events expected: first the user message, then the assistant stub
    const start = Date.now()
    let userSeen = false
    let assistantSeen = false
    while (Date.now() - start < 2000) {
      const completes = ch.outgoing.filter((m) => m.type === 'message-complete')
      for (const m of completes) {
        const msg = (m as { message: { role: string } }).message
        if (msg.role === 'user') userSeen = true
        if (msg.role === 'assistant') assistantSeen = true
      }
      if (userSeen && assistantSeen) break
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(userSeen).toBe(true)
    expect(assistantSeen).toBe(true)

    const finished = await ch.waitFor('segment-finished')
    expect((finished as { reason: string }).reason).toBe('natural')
  })

  it('list-sessions returns the created session', async () => {
    const ch = new TestChannel()
    await startIpcServer(ch)
    await ch.waitFor('ready')

    ch.send({ type: 'create-session', sessionId: 's_listed' })
    await ch.waitFor('session-created')

    ch.send({ type: 'list-sessions' })
    const list = await ch.waitFor('session-list')
    const sessions = (list as { sessions: { sessionId: string }[] }).sessions
    expect(sessions.find((s) => s.sessionId === 's_listed')).toBeDefined()
  })
})
