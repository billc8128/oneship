import { describe, expect, it } from 'vitest'
import { deriveRemovalOutcome, deriveUpdateOutcome } from '../terminal-page-state'

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

describe('deriveRemovalOutcome', () => {
  it('keeps activeId unchanged when a different session is removed', () => {
    const result = deriveRemovalOutcome({
      records: [makeRecord({ id: 'a' }), makeRecord({ id: 'b' })],
      activeId: 'a',
      removedSessionId: 'b',
      urlSessionId: undefined,
      projectId: 'project-1',
    })

    expect(result.nextActiveId).toBe('a')
    expect(result.navigateTo).toBeNull()
    expect(result.removedExisted).toBe(true)
  })

  it('reports removedExisted=false when the removed session is not in records', () => {
    const result = deriveRemovalOutcome({
      records: [makeRecord({ id: 'a' })],
      activeId: 'a',
      removedSessionId: 'ghost',
      urlSessionId: undefined,
      projectId: 'project-1',
    })

    expect(result.removedExisted).toBe(false)
    expect(result.nextActiveId).toBe('a')
    expect(result.navigateTo).toBeNull()
  })

  it('falls back to the first remaining live session when the active session is removed', () => {
    const result = deriveRemovalOutcome({
      records: [
        makeRecord({ id: 'a' }),
        makeRecord({ id: 'b', updatedAt: 200 }),
      ],
      activeId: 'a',
      removedSessionId: 'a',
      urlSessionId: undefined,
      projectId: 'project-1',
    })

    expect(result.nextRecords.map((record) => record.id)).toEqual(['b'])
    expect(result.nextActiveId).toBe('b')
    expect(result.navigateTo).toBe('/project/project-1/terminal/b')
  })

  it('prefers the url session over first-live when falling back', () => {
    const result = deriveRemovalOutcome({
      records: [
        makeRecord({ id: 'a' }),
        makeRecord({ id: 'b', updatedAt: 200 }),
        makeRecord({ id: 'c', updatedAt: 150 }),
      ],
      activeId: 'a',
      removedSessionId: 'a',
      urlSessionId: 'c',
      projectId: 'project-1',
    })

    expect(result.nextActiveId).toBe('c')
    expect(result.navigateTo).toBeNull()
  })

  it('navigates to the project terminal root when no live sessions remain', () => {
    const result = deriveRemovalOutcome({
      records: [makeRecord({ id: 'a', lifecycle: 'closed' })],
      activeId: 'a',
      removedSessionId: 'a',
      urlSessionId: undefined,
      projectId: 'project-1',
    })

    expect(result.nextRecords).toEqual([])
    expect(result.nextActiveId).toBe('')
    expect(result.navigateTo).toBe('/project/project-1/terminal')
  })
})

describe('deriveUpdateOutcome', () => {
  it('keeps the existing active session when one is already selected', () => {
    const result = deriveUpdateOutcome({
      records: [makeRecord({ id: 'a' })],
      activeId: 'a',
      record: makeRecord({ id: 'b', updatedAt: 200 }),
      urlSessionId: undefined,
      projectId: 'project-1',
    })

    expect(result.nextRecords.map((record) => record.id)).toEqual(['b', 'a'])
    expect(result.nextActiveId).toBe('a')
    expect(result.navigateTo).toBeNull()
  })

  it('activates the url session when that session record arrives and nothing is selected yet', () => {
    const record = makeRecord({ id: 'wanted', updatedAt: 200 })

    const result = deriveUpdateOutcome({
      records: [],
      activeId: '',
      record,
      urlSessionId: 'wanted',
      projectId: 'project-1',
    })

    expect(result.nextRecords).toEqual([record])
    expect(result.nextActiveId).toBe('wanted')
    expect(result.navigateTo).toBeNull()
  })

  it('navigates to the first live session when no session is active and a live record arrives', () => {
    const record = makeRecord({ id: 'live-1', lifecycle: 'live', updatedAt: 200 })

    const result = deriveUpdateOutcome({
      records: [],
      activeId: '',
      record,
      urlSessionId: undefined,
      projectId: 'project-1',
    })

    expect(result.nextRecords).toEqual([record])
    expect(result.nextActiveId).toBe('live-1')
    expect(result.navigateTo).toBe('/project/project-1/terminal/live-1')
  })

  it('does not activate a non-live record when nothing is selected', () => {
    const record = makeRecord({ id: 'closed-1', lifecycle: 'closed', updatedAt: 200 })

    const result = deriveUpdateOutcome({
      records: [],
      activeId: '',
      record,
      urlSessionId: undefined,
      projectId: 'project-1',
    })

    expect(result.nextRecords).toEqual([record])
    expect(result.nextActiveId).toBe('')
    expect(result.navigateTo).toBeNull()
  })
})
