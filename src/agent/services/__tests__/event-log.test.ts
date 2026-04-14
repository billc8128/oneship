import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  appendEvent,
  readEvents,
  type LogEvent,
} from '../event-log'

describe('event-log', () => {
  let dir: string
  let logPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'oneship-event-log-'))
    logPath = join(dir, 'events.jsonl')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('appendEvent creates the file if missing', async () => {
    expect(existsSync(logPath)).toBe(false)
    await appendEvent(logPath, {
      type: 'message-start',
      messageId: 'm_1',
      role: 'user',
      createdAt: 1000,
    })
    expect(existsSync(logPath)).toBe(true)
  })

  it('appendEvent writes one JSON line per call', async () => {
    await appendEvent(logPath, { type: 'message-start', messageId: 'm_1', role: 'user', createdAt: 1000 })
    await appendEvent(logPath, { type: 'part-append', messageId: 'm_1', part: { type: 'text', text: 'hi' } as any })
    await appendEvent(logPath, { type: 'message-finish', messageId: 'm_1' })
    const raw = readFileSync(logPath, 'utf-8')
    const lines = raw.trim().split('\n')
    expect(lines).toHaveLength(3)
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  it('readEvents returns parsed events in order', async () => {
    const events: LogEvent[] = [
      { type: 'message-start', messageId: 'm_1', role: 'user', createdAt: 1000 },
      { type: 'part-append', messageId: 'm_1', part: { type: 'text', text: 'hi' } as any },
      { type: 'message-finish', messageId: 'm_1' },
    ]
    for (const ev of events) await appendEvent(logPath, ev)
    const read = await readEvents(logPath)
    expect(read).toEqual(events)
  })

  it('readEvents tolerates a truncated tail (crash mid-write)', async () => {
    await appendEvent(logPath, { type: 'message-start', messageId: 'm_1', role: 'user', createdAt: 1000 })
    // Simulate a crash that left a half-written line at the end.
    const fs = await import('fs/promises')
    await fs.appendFile(logPath, '{"type":"part-append","messa')
    const read = await readEvents(logPath)
    expect(read).toHaveLength(1)
    expect(read[0].type).toBe('message-start')
  })

  it('readEvents returns [] for a missing file', async () => {
    const read = await readEvents(join(dir, 'nope.jsonl'))
    expect(read).toEqual([])
  })
})
