import { describe, expect, it, vi } from 'vitest'

const mockPtyState = vi.hoisted(() => {
  let exitHandler: ((event?: { exitCode?: number; signal?: number }) => void) | undefined
  let dataHandler: ((data: string) => void) | undefined
  let spawnOptions: Record<string, unknown> | undefined

  return {
    setExitHandler(handler: typeof exitHandler) {
      exitHandler = handler
    },
    setDataHandler(handler: typeof dataHandler) {
      dataHandler = handler
    },
    triggerExit() {
      exitHandler?.({ exitCode: 0 })
    },
    triggerData(data: string) {
      dataHandler?.(data)
    },
    setSpawnOptions(options: Record<string, unknown>) {
      spawnOptions = options
    },
    getSpawnOptions() {
      return spawnOptions
    },
  }
})

vi.mock('node-pty', () => ({
  spawn: (_shell: string, _args: string[], options: Record<string, unknown>) => {
    mockPtyState.setSpawnOptions(options)

    return {
      pid: 42,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn((handler: (data: string) => void) => {
        mockPtyState.setDataHandler(handler)
      }),
      onExit: vi.fn((handler: (event?: { exitCode?: number; signal?: number }) => void) => {
        mockPtyState.setExitHandler(handler)
      }),
    }
  },
}))

import { TerminalManager } from '../terminal-manager'

describe('TerminalManager', () => {
  it('threads the resolved hook port into new PTY environments', () => {
    const terminalManager = new TerminalManager()
    terminalManager.setHookPort(20001)

    terminalManager.create('alpha', '/tmp/project', '/bin/zsh')

    expect(mockPtyState.getSpawnOptions()).toMatchObject({
      env: expect.objectContaining({
        ONESHIP_HOOK_PORT: '20001',
      }),
    })
  })

  it('scrubs host terminal emulator identity vars from spawned PTYs', () => {
    const originalTermProgram = process.env.TERM_PROGRAM
    const originalTermProgramVersion = process.env.TERM_PROGRAM_VERSION
    const originalTerminfo = process.env.TERMINFO
    const originalKittyWindowId = process.env.KITTY_WINDOW_ID

    process.env.TERM_PROGRAM = 'ghostty'
    process.env.TERM_PROGRAM_VERSION = '1.3.1'
    process.env.TERMINFO = '/Applications/Ghostty.app/Contents/Resources/terminfo'
    process.env.KITTY_WINDOW_ID = '42'

    try {
      const terminalManager = new TerminalManager()
      terminalManager.create('alpha', '/tmp/project', '/bin/zsh')

      expect(mockPtyState.getSpawnOptions()).toMatchObject({
        env: expect.objectContaining({
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        }),
      })

      const env = mockPtyState.getSpawnOptions()?.env as Record<string, string | undefined>
      expect(env.TERM_PROGRAM).toBeUndefined()
      expect(env.TERM_PROGRAM_VERSION).toBeUndefined()
      expect(env.TERMINFO).toBeUndefined()
      expect(env.KITTY_WINDOW_ID).toBeUndefined()
    } finally {
      if (originalTermProgram === undefined) delete process.env.TERM_PROGRAM
      else process.env.TERM_PROGRAM = originalTermProgram

      if (originalTermProgramVersion === undefined) delete process.env.TERM_PROGRAM_VERSION
      else process.env.TERM_PROGRAM_VERSION = originalTermProgramVersion

      if (originalTerminfo === undefined) delete process.env.TERMINFO
      else process.env.TERMINFO = originalTerminfo

      if (originalKittyWindowId === undefined) delete process.env.KITTY_WINDOW_ID
      else process.env.KITTY_WINDOW_ID = originalKittyWindowId
    }
  })

  it('strips host agent color and CI env vars before spawning PTYs', () => {
    const originalNoColor = process.env.NO_COLOR
    const originalCi = process.env.CI
    const originalCodexCi = process.env.CODEX_CI
    const originalCodexThreadId = process.env.CODEX_THREAD_ID
    const originalCodexSandbox = process.env.CODEX_SANDBOX_NETWORK_DISABLED
    const originalParentKeep = process.env.PARENT_KEEP

    process.env.NO_COLOR = '1'
    process.env.CI = 'true'
    process.env.CODEX_CI = '1'
    process.env.CODEX_THREAD_ID = 'thread-123'
    process.env.CODEX_SANDBOX_NETWORK_DISABLED = '1'
    process.env.PARENT_KEEP = 'keep-me'

    try {
      const terminalManager = new TerminalManager()
      terminalManager.create('alpha', '/tmp/project', '/bin/zsh')

      const env = mockPtyState.getSpawnOptions()?.env as Record<string, string | undefined>
      expect(env.NO_COLOR).toBeUndefined()
      expect(env.CI).toBeUndefined()
      expect(env.CODEX_CI).toBeUndefined()
      expect(env.CODEX_THREAD_ID).toBeUndefined()
      expect(env.CODEX_SANDBOX_NETWORK_DISABLED).toBeUndefined()
      expect(env.PARENT_KEEP).toBe('keep-me')
    } finally {
      if (originalNoColor === undefined) delete process.env.NO_COLOR
      else process.env.NO_COLOR = originalNoColor

      if (originalCi === undefined) delete process.env.CI
      else process.env.CI = originalCi

      if (originalCodexCi === undefined) delete process.env.CODEX_CI
      else process.env.CODEX_CI = originalCodexCi

      if (originalCodexThreadId === undefined) delete process.env.CODEX_THREAD_ID
      else process.env.CODEX_THREAD_ID = originalCodexThreadId

      if (originalCodexSandbox === undefined) delete process.env.CODEX_SANDBOX_NETWORK_DISABLED
      else process.env.CODEX_SANDBOX_NETWORK_DISABLED = originalCodexSandbox

      if (originalParentKeep === undefined) delete process.env.PARENT_KEEP
      else process.env.PARENT_KEEP = originalParentKeep
    }
  })

  it('notifies exit listeners and removes the session when a PTY exits', () => {
    const terminalManager = new TerminalManager()
    const onExit = vi.fn()

    terminalManager.onSessionExit(onExit)
    const sessionId = terminalManager.create('alpha', '/tmp/project', '/bin/zsh')

    mockPtyState.triggerExit()

    expect(onExit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: sessionId,
        projectId: 'alpha',
      }),
    )
    expect(terminalManager.listSessions('alpha')).toEqual([])
  })

  it('replays buffered output to subscribers that attach after earlier PTY data', () => {
    const terminalManager = new TerminalManager()
    const sessionId = terminalManager.create('alpha', '/tmp/project', '/bin/zsh')

    mockPtyState.triggerData('hello')
    mockPtyState.triggerData(' world')

    const received: string[] = []
    terminalManager.onData(sessionId, (data) => {
      received.push(data)
    })

    expect(received).toEqual(['hello world'])
  })

  it('only replays the bootstrap buffer to the first subscriber, never again', () => {
    const terminalManager = new TerminalManager()
    const sessionId = terminalManager.create('alpha', '/tmp/project', '/bin/zsh')

    // Simulate PTY bootstrap output arriving before anyone subscribed.
    mockPtyState.triggerData('boot output')

    // First subscriber gets the replay.
    const firstReceived: string[] = []
    const unsubscribeFirst = terminalManager.onData(sessionId, (data) => {
      firstReceived.push(data)
    })
    expect(firstReceived).toEqual(['boot output'])

    // Detach and re-subscribe with a fresh listener. This simulates what
    // happens in the renderer when the user switches tabs away and back,
    // or when a bug causes a second subscribe to fire for the same session.
    unsubscribeFirst()
    const secondReceived: string[] = []
    terminalManager.onData(sessionId, (data) => {
      secondReceived.push(data)
    })

    // The second subscriber must NOT receive a replay — the buffer has
    // already been consumed. Only live data arriving after this point
    // should reach it.
    expect(secondReceived).toEqual([])

    mockPtyState.triggerData('live after')
    expect(secondReceived).toEqual(['live after'])
  })
})
