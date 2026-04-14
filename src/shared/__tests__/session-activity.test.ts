import { describe, expect, it } from 'vitest'
import {
  buildProjectActivity,
  getSessionBadgeVariant,
  getSessionStateLabel,
  type ActivityProjectLike,
  type ActivitySessionLike,
} from '../session-activity'

function makeSession(overrides: Partial<ActivitySessionLike>): ActivitySessionLike {
  return {
    id: 'session-1',
    projectId: 'alpha',
    cwd: '/tmp/project',
    shell: '/bin/zsh',
    label: 'Terminal 1',
    createdAt: 1,
    updatedAt: 1,
    lifecycle: 'live',
    lastStatus: 'idle',
    lastEventSummary: '',
    source: null,
    lastHookName: null,
    lastToolName: null,
    ...overrides,
  }
}

describe('session activity helpers', () => {
  it('counts live / waiting / working terminals per project', () => {
    const projects: ActivityProjectLike[] = [
      { id: 'alpha', name: 'Alpha', status: 'active', path: '/tmp/alpha', createdAt: 10 },
      { id: 'beta', name: 'Beta', status: 'planning', path: null, createdAt: 5 },
    ]

    const summaries = buildProjectActivity(projects, [
      makeSession({ id: 'alpha-1', projectId: 'alpha', label: 'Terminal 1', updatedAt: 30, lastStatus: 'waiting' }),
      makeSession({ id: 'alpha-2', projectId: 'alpha', label: 'Terminal 2', updatedAt: 20 }),
      makeSession({ id: 'alpha-3', projectId: 'alpha', label: 'Terminal 3', updatedAt: 15, lifecycle: 'closed', lastStatus: 'done' }),
      makeSession({ id: 'beta-1', projectId: 'beta', label: 'Terminal 1', updatedAt: 25, lastStatus: 'working' }),
    ])

    expect(summaries[0]).toMatchObject({
      project: expect.objectContaining({ id: 'alpha' }),
      liveTerminals: 2,
      waitingTerminals: 1,
      workingTerminals: 0,
      lastActivityAt: 30,
    })
    expect(summaries[0].historySessions).toEqual([
      expect.objectContaining({ id: 'alpha-3', lifecycle: 'closed' }),
    ])

    expect(summaries[1]).toMatchObject({
      project: expect.objectContaining({ id: 'beta' }),
      liveTerminals: 1,
      waitingTerminals: 0,
      workingTerminals: 1,
      lastActivityAt: 25,
    })
  })

  it('returns badge and state labels across lifecycle and status values', () => {
    expect(getSessionBadgeVariant(makeSession({ lastStatus: 'working' }))).toBe('running')
    expect(getSessionBadgeVariant(makeSession({ lastStatus: 'waiting' }))).toBe('planning')
    expect(getSessionBadgeVariant(makeSession({ lifecycle: 'closed', lastStatus: 'done' }))).toBe('done')

    expect(getSessionStateLabel(makeSession({ lastStatus: 'idle' }))).toBe('idle')
    expect(getSessionStateLabel(makeSession({ lifecycle: 'closed' }))).toBe('closed')
    expect(getSessionStateLabel(makeSession({ lifecycle: 'interrupted' }))).toBe('interrupted')
  })
})
