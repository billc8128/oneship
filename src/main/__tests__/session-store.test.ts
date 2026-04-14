import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SessionStore } from '../session-store'

describe('SessionStore', () => {
  it('chooses the smallest available terminal number among live sessions only', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'oneship-sessions-'))
    const store = new SessionStore(stateDir)

    store.upsert({
      id: 'session-1',
      projectId: 'alpha',
      cwd: '/tmp/project',
      shell: '/bin/zsh',
      label: 'Terminal 1',
      createdAt: 1,
      updatedAt: 1,
      lifecycle: 'live',
      lastStatus: 'idle',
      lastEventSummary: 'Start',
    })

    store.upsert({
      id: 'session-2',
      projectId: 'alpha',
      cwd: '/tmp/project',
      shell: '/bin/zsh',
      label: 'Terminal 3',
      createdAt: 2,
      updatedAt: 2,
      lifecycle: 'live',
      lastStatus: 'idle',
      lastEventSummary: 'Start',
    })

    store.upsert({
      id: 'session-3',
      projectId: 'alpha',
      cwd: '/tmp/project',
      shell: '/bin/zsh',
      label: 'Terminal 2',
      createdAt: 3,
      updatedAt: 3,
      lifecycle: 'closed',
      lastStatus: 'done',
      lastEventSummary: 'Stop',
    })

    expect(store.nextTerminalNumber('alpha')).toBe(2)
  })

  it('restarts numbering from one when a project has no live terminal labels', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'oneship-sessions-'))
    const store = new SessionStore(stateDir)

    store.upsert({
      id: 'session-1',
      projectId: 'alpha',
      cwd: '/tmp/project',
      shell: '/bin/zsh',
      label: 'Terminal 12',
      createdAt: 1,
      updatedAt: 1,
      lifecycle: 'closed',
      lastStatus: 'done',
      lastEventSummary: 'Stop',
    })

    store.upsert({
      id: 'session-2',
      projectId: 'alpha',
      cwd: '/tmp/project',
      shell: '/bin/zsh',
      label: 'Build Agent',
      createdAt: 2,
      updatedAt: 2,
      lifecycle: 'interrupted',
      lastStatus: 'error',
      lastEventSummary: 'Crash',
    })

    expect(store.nextTerminalNumber('alpha')).toBe(1)
  })

  it('persists renamed session metadata and lifecycle state', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'oneship-sessions-'))
    const store = new SessionStore(stateDir)

    store.upsert({
      id: 'session-1',
      projectId: 'alpha',
      cwd: '/tmp/project',
      shell: '/bin/zsh',
      label: 'Build Agent',
      createdAt: 1,
      updatedAt: 1,
      lifecycle: 'live',
      lastStatus: 'working',
      lastEventSummary: 'PreToolUse',
    })

    store.upsert({
      id: 'session-1',
      projectId: 'alpha',
      cwd: '/tmp/project',
      shell: '/bin/zsh',
      label: 'Build Agent Renamed',
      createdAt: 1,
      updatedAt: 2,
      lifecycle: 'exited',
      lastStatus: 'done',
      lastEventSummary: 'Stop',
    })

    expect(store.list()).toEqual([
      expect.objectContaining({
        id: 'session-1',
        label: 'Build Agent Renamed',
        lifecycle: 'exited',
        lastStatus: 'done',
      }),
    ])
  })

  it('marks previously live sessions as interrupted on startup recovery', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'oneship-sessions-'))
    const store = new SessionStore(stateDir)

    store.upsert({
      id: 'session-1',
      projectId: 'alpha',
      cwd: '/tmp/project',
      shell: '/bin/zsh',
      label: 'Recovered Agent',
      createdAt: 1,
      updatedAt: 1,
      lifecycle: 'live',
      lastStatus: 'working',
      lastEventSummary: 'PreToolUse',
    })

    store.markLiveSessionsAsInterrupted(5)

    expect(store.list()).toEqual([
      expect.objectContaining({
        id: 'session-1',
        lifecycle: 'interrupted',
        updatedAt: 5,
      }),
    ])
  })

  it('patches individual fields without replacing the whole session record', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'oneship-sessions-'))
    const store = new SessionStore(stateDir)

    store.upsert({
      id: 'session-1',
      projectId: 'alpha',
      cwd: '/tmp/project',
      shell: '/bin/zsh',
      label: 'Build Agent',
      createdAt: 1,
      updatedAt: 1,
      lifecycle: 'live',
      lastStatus: 'working',
      lastEventSummary: 'PreToolUse',
    })

    store.patch('session-1', {
      label: 'Renamed Agent',
      updatedAt: 10,
      lastStatus: 'waiting',
    })

    expect(store.list()).toEqual([
      expect.objectContaining({
        id: 'session-1',
        label: 'Renamed Agent',
        lifecycle: 'live',
        lastStatus: 'waiting',
        updatedAt: 10,
      }),
    ])
  })

  it('recovers from a corrupted sessions file without throwing', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'oneship-sessions-'))
    writeFileSync(join(stateDir, 'sessions.json'), '{"broken": ')

    const store = new SessionStore(stateDir)

    expect(store.list()).toEqual([])
    expect(existsSync(join(stateDir, 'sessions.corrupt.json'))).toBe(true)
  })

  it('forgets an individual historical session record', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'oneship-sessions-'))
    const store = new SessionStore(stateDir)

    store.upsert({
      id: 'session-1',
      projectId: 'alpha',
      cwd: '/tmp/project',
      shell: '/bin/zsh',
      label: 'Old Agent',
      createdAt: 1,
      updatedAt: 2,
      lifecycle: 'closed',
      lastStatus: 'done',
      lastEventSummary: 'Stop',
    })

    expect(store.forget('session-1')).toBe(true)
    expect(store.list()).toEqual([])
  })
})
