import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { AgentUIMessage } from '../../../shared/agent-protocol'
import {
  replay,
  writeMessageStart,
  writePartAppend,
  writeMessageFinish,
  writePartUpdate,
  isMessageComplete,
  Phase1NotImplemented,
} from '../conversation-store'
import { readEvents } from '../event-log'

describe('conversation-store', () => {
  let dir: string
  let logPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'oneship-conv-store-'))
    logPath = join(dir, 'events.jsonl')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('replay reconstructs an empty list from an empty event log', () => {
    expect(replay([])).toEqual([])
  })

  it('replay reconstructs a single user message', () => {
    const msgs = replay([
      { type: 'message-start', messageId: 'm_1', role: 'user', createdAt: 1000 },
      { type: 'part-append', messageId: 'm_1', part: { type: 'text', text: 'hello' } as any },
      { type: 'message-finish', messageId: 'm_1' },
    ])
    expect(msgs).toHaveLength(1)
    expect(msgs[0].id).toBe('m_1')
    expect(msgs[0].role).toBe('user')
    expect(msgs[0].parts).toHaveLength(1)
    expect(isMessageComplete(msgs[0])).toBe(true)
  })

  it('replay leaves a message open if no message-finish arrived', () => {
    const msgs = replay([
      { type: 'message-start', messageId: 'm_1', role: 'assistant', createdAt: 1000 },
      { type: 'part-append', messageId: 'm_1', part: { type: 'text', text: 'streaming' } as any },
    ])
    expect(isMessageComplete(msgs[0])).toBe(false)
  })

  it('replay handles part-update on an existing part', () => {
    const msgs = replay([
      { type: 'message-start', messageId: 'm_1', role: 'assistant', createdAt: 1000 },
      { type: 'part-append', messageId: 'm_1', part: { type: 'text', text: 'first' } as any },
      { type: 'part-update', messageId: 'm_1', partIndex: 0, part: { type: 'text', text: 'second' } as any },
      { type: 'message-finish', messageId: 'm_1' },
    ])
    expect((msgs[0].parts[0] as any).text).toBe('second')
  })

  it('write helpers append events AND mutate in-memory state', async () => {
    const messages: AgentUIMessage[] = []
    await writeMessageStart(logPath, messages, { messageId: 'm_1', role: 'user', createdAt: 1000 })
    expect(messages).toHaveLength(1)
    expect(isMessageComplete(messages[0])).toBe(false)

    await writePartAppend(logPath, messages, {
      messageId: 'm_1',
      part: { type: 'text', text: 'hello' } as any,
    })
    expect(messages[0].parts).toHaveLength(1)

    await writeMessageFinish(logPath, messages, { messageId: 'm_1' })
    expect(isMessageComplete(messages[0])).toBe(true)

    // Round-trip: read events back from disk and replay should give same result
    const events = await readEvents(logPath)
    expect(events).toHaveLength(3)
    const replayed = replay(events)
    expect(replayed).toHaveLength(1)
    expect(replayed[0].id).toBe('m_1')
    expect(isMessageComplete(replayed[0])).toBe(true)
  })

  it('writePartUpdate throws Phase1NotImplemented', async () => {
    const messages: AgentUIMessage[] = []
    await expect(
      writePartUpdate(logPath, messages, {
        messageId: 'm_1',
        partIndex: 0,
        part: { type: 'text', text: 'x' } as any,
      })
    ).rejects.toBeInstanceOf(Phase1NotImplemented)
  })

  it('write helpers leave uiMessages untouched if the disk append fails', async () => {
    // Point the log path at a directory that does not exist and cannot be
    // created (use a path under /dev/null which is a file, not a dir).
    // appendFile to a child of a non-directory rejects with ENOTDIR.
    const messages: AgentUIMessage[] = []
    const badPath = '/dev/null/cannot-write-here.jsonl'

    await expect(
      writeMessageStart(badPath, messages, { messageId: 'm_x', role: 'user', createdAt: 1 })
    ).rejects.toThrow()
    expect(messages).toHaveLength(0)  // mutation rolled back

    // Set up a valid message so writePartAppend has something to find,
    // then point IT at the bad path:
    await writeMessageStart(logPath, messages, { messageId: 'm_y', role: 'user', createdAt: 1 })
    expect(messages[0].parts).toHaveLength(0)

    await expect(
      writePartAppend(badPath, messages, { messageId: 'm_y', part: { type: 'text', text: 'x' } as any })
    ).rejects.toThrow()
    expect(messages[0].parts).toHaveLength(0)  // part not appended
    expect(isMessageComplete(messages[0])).toBe(false)

    await expect(
      writeMessageFinish(badPath, messages, { messageId: 'm_y' })
    ).rejects.toThrow()
    expect(isMessageComplete(messages[0])).toBe(false)  // not flipped to true
  })
})
