import { describe, expect, it } from 'vitest'
import {
  orderTerminalSessionsForDisplay,
  removeSessionRecord,
  upsertSessionRecord,
} from '../session-records'

function makeRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: overrides.id ?? 'session-1',
    projectId: overrides.projectId ?? 'project-1',
    cwd: overrides.cwd ?? '/tmp/project',
    shell: overrides.shell ?? '/bin/zsh',
    label: overrides.label ?? 'Terminal 1',
    createdAt: overrides.createdAt ?? 100,
    updatedAt: overrides.updatedAt ?? 100,
    lifecycle: overrides.lifecycle ?? 'live',
    lastStatus: overrides.lastStatus ?? 'idle',
    lastEventSummary: overrides.lastEventSummary ?? '',
    source: overrides.source ?? null,
    lastHookName: overrides.lastHookName ?? null,
    lastToolName: overrides.lastToolName ?? null,
  }
}

describe('session-records', () => {
  it('upserts a session record and keeps records sorted by updatedAt descending', () => {
    const older = makeRecord({ id: 'older', updatedAt: 100 })
    const newer = makeRecord({ id: 'newer', updatedAt: 300 })

    const result = upsertSessionRecord([older], newer)

    expect(result.map((record) => record.id)).toEqual(['newer', 'older'])
  })

  it('replaces an existing record instead of duplicating it', () => {
    const original = makeRecord({ id: 'same', label: 'Old', updatedAt: 100 })
    const updated = makeRecord({ id: 'same', label: 'New', updatedAt: 200, lifecycle: 'closed' })

    const result = upsertSessionRecord([original], updated)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'same',
      label: 'New',
      lifecycle: 'closed',
      updatedAt: 200,
    })
  })

  it('removes a session record by id', () => {
    const kept = makeRecord({ id: 'kept' })
    const removed = makeRecord({ id: 'removed' })

    const result = removeSessionRecord([kept, removed], 'removed')

    expect(result).toEqual([kept])
  })

  it('orders terminal sessions by creation time so new terminals append to the end', () => {
    const first = makeRecord({ id: 'first', createdAt: 100, updatedAt: 999 })
    const second = makeRecord({ id: 'second', createdAt: 200, updatedAt: 100 })
    const newest = makeRecord({ id: 'newest', createdAt: 300, updatedAt: 50 })

    const result = orderTerminalSessionsForDisplay([newest, first, second])

    expect(result.map((record) => record.id)).toEqual(['first', 'second', 'newest'])
  })
})
