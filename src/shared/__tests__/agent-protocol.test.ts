import { describe, it, expect } from 'vitest'
import {
  isToWorker,
  isToMain,
  type ToWorker,
  type ToMain,
  type SessionMeta,
} from '../agent-protocol'

describe('agent-protocol', () => {
  it('isToWorker accepts a valid send-user-message', () => {
    const msg: ToWorker = {
      type: 'send-user-message',
      sessionId: 's_abc',
      content: 'hello',
    }
    expect(isToWorker(msg)).toBe(true)
  })

  it('isToWorker rejects an unknown type', () => {
    expect(isToWorker({ type: 'nope' } as unknown)).toBe(false)
  })

  it('isToMain accepts a valid session-list', () => {
    const msg: ToMain = {
      type: 'session-list',
      sessions: [],
    }
    expect(isToMain(msg)).toBe(true)
  })

  it('SessionMeta type compiles with all required fields', () => {
    const meta: SessionMeta = {
      sessionId: 's_abc',
      createdAt: 1,
      updatedAt: 1,
      model: 'phase-1-stub',
      permissionMode: 'trust',
      planMode: false,
      triggeredBy: { kind: 'user' },
      lastSegmentReason: null,
      title: null,
      eventLogLength: 0,
      snapshotEventOffset: null,
    }
    expect(meta.sessionId).toBe('s_abc')
  })
})
