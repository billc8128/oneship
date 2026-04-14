import * as pty from 'node-pty'
import { randomUUID } from 'crypto'

const terminalIdentityEnvKeys = new Set([
  'LC_TERMINAL',
  'LC_TERMINAL_VERSION',
  'TERMINFO',
  'TERMINFO_DIRS',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'TERM_SESSION_ID',
  'VTE_VERSION',
  'WT_PROFILE_ID',
  'WT_SESSION',
])

const terminalIdentityEnvPrefixes = [
  'ITERM_',
  'KITTY_',
  'WEZTERM_',
]

function shouldStripTerminalIdentityEnvVar(key: string): boolean {
  if (terminalIdentityEnvKeys.has(key)) {
    return true
  }

  return terminalIdentityEnvPrefixes.some((prefix) => key.startsWith(prefix))
}

function buildPtyEnv(sessionId: string, hookPort: string): Record<string, string> {
  const env: Record<string, string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== 'string') {
      continue
    }

    if (shouldStripTerminalIdentityEnvVar(key)) {
      continue
    }

    env[key] = value
  }

  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.ONESHIP_HOOK_PORT = hookPort
  env.ONESHIP_SESSION_ID = sessionId

  return env
}

export interface TerminalSession {
  id: string
  projectId: string
  cwd: string
  shell: string
  ptyProcess: pty.IPty
}

export interface TerminalSessionInfo {
  id: string
  projectId: string
  cwd: string
  shell: string
}

export class TerminalManager {
  private static readonly maxReplayBufferChars = 200_000
  private sessions = new Map<string, TerminalSession>()
  private dataListeners = new Map<string, Set<(data: string) => void>>()
  private outputBuffers = new Map<string, string>()
  // Sessions whose bootstrap replay has already been consumed. The replay
  // buffer exists to cover the race where the PTY emits output before the
  // renderer has a chance to subscribe (shell welcome banner, .zshrc echo,
  // etc.). It must only fire on the *first* subscribe per session. Any
  // re-subscribe (tab switch, window focus, StrictMode double-mount, or any
  // future bug) must NOT re-consume the buffer — otherwise the renderer
  // sees the same block of output written into xterm multiple times.
  private replayedSessions = new Set<string>()
  private exitListeners = new Set<(session: TerminalSession) => void>()
  private hookPort = '19876'

  setHookPort(port: number): void {
    this.hookPort = String(port)
  }

  create(projectId: string, cwd: string, shell?: string): string {
    const id = randomUUID()
    const resolvedShell = shell || process.env.SHELL || '/bin/zsh'

    const ptyProcess = pty.spawn(resolvedShell, ['--login'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: buildPtyEnv(id, this.hookPort),
    })

    const session: TerminalSession = {
      id,
      projectId,
      cwd,
      shell: resolvedShell,
      ptyProcess
    }

    this.sessions.set(id, session)
    this.dataListeners.set(id, new Set())
    this.outputBuffers.set(id, '')

    ptyProcess.onData((data: string) => {
      // Only keep appending to the bootstrap replay buffer until the first
      // subscriber has consumed it. After that, the buffer is gone — live
      // data flows straight through to listeners without being re-buffered.
      if (!this.replayedSessions.has(id)) {
        const nextBuffer = `${this.outputBuffers.get(id) ?? ''}${data}`
        this.outputBuffers.set(
          id,
          nextBuffer.length > TerminalManager.maxReplayBufferChars
            ? nextBuffer.slice(-TerminalManager.maxReplayBufferChars)
            : nextBuffer,
        )
      }

      const listeners = this.dataListeners.get(id)
      if (listeners) {
        for (const listener of listeners) {
          listener(data)
        }
      }
    })

    ptyProcess.onExit(() => {
      for (const listener of this.exitListeners) {
        listener(session)
      }
      this.sessions.delete(id)
      this.dataListeners.delete(id)
      this.outputBuffers.delete(id)
      this.replayedSessions.delete(id)
    })

    return id
  }

  write(id: string, data: string): void {
    const session = this.sessions.get(id)
    if (session) {
      session.ptyProcess.write(data)
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id)
    if (session) {
      session.ptyProcess.resize(cols, rows)
    }
  }

  onData(id: string, callback: (data: string) => void): () => void {
    const listeners = this.dataListeners.get(id)
    if (listeners) {
      listeners.add(callback)
    }

    // Only replay the buffered bootstrap output on the very first subscribe
    // per session. Subsequent subscribes (re-attach, focus, reload, bugs)
    // get live data only — never a stale rewind of the buffer. Once the
    // replay fires, we also drop the stored buffer so memory doesn't keep
    // growing for the lifetime of the session.
    if (!this.replayedSessions.has(id)) {
      const bufferedOutput = this.outputBuffers.get(id)
      if (bufferedOutput) {
        callback(bufferedOutput)
      }
      this.replayedSessions.add(id)
      this.outputBuffers.delete(id)
    }

    return () => {
      const ls = this.dataListeners.get(id)
      if (ls) {
        ls.delete(callback)
      }
    }
  }

  kill(id: string): void {
    const session = this.sessions.get(id)
    if (session) {
      session.ptyProcess.kill()
      this.sessions.delete(id)
      this.dataListeners.delete(id)
      this.outputBuffers.delete(id)
      this.replayedSessions.delete(id)
    }
  }

  onSessionExit(callback: (session: TerminalSession) => void): () => void {
    this.exitListeners.add(callback)
    return () => {
      this.exitListeners.delete(callback)
    }
  }

  listSessions(projectId?: string): TerminalSessionInfo[] {
    const result: TerminalSessionInfo[] = []
    for (const session of this.sessions.values()) {
      if (!projectId || session.projectId === projectId) {
        result.push({
          id: session.id,
          projectId: session.projectId,
          cwd: session.cwd,
          shell: session.shell
        })
      }
    }
    return result
  }

  listSessionsWithPid(): Array<{ id: string; pid: number; cwd: string }> {
    const result: Array<{ id: string; pid: number; cwd: string }> = []
    for (const session of this.sessions.values()) {
      result.push({
        id: session.id,
        pid: session.ptyProcess.pid,
        cwd: session.cwd
      })
    }
    return result
  }

  killAll(): void {
    for (const session of this.sessions.values()) {
      session.ptyProcess.kill()
    }
    this.sessions.clear()
    this.dataListeners.clear()
    this.outputBuffers.clear()
    this.replayedSessions.clear()
  }
}
