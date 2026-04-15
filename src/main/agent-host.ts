import { utilityProcess, type UtilityProcess, app } from 'electron'
import { join } from 'path'
import type { ToWorker, ToMain } from '../shared/agent-protocol'
import { isToMain } from '../shared/agent-protocol'
import { runtimePaths } from './runtime-paths'

/**
 * Tracks recent respawn timestamps and decides whether another respawn
 * is permitted (max N within window). Pure class — testable without Electron.
 *
 * `opts` is public readonly so AgentHost can include the config in error
 * messages when the gate exhausts.
 */
export class RespawnGate {
  private timestamps: number[] = []
  constructor(public readonly opts: { max: number; windowMs: number }) {}

  allow(now = Date.now()): boolean {
    this.timestamps = this.timestamps.filter((t) => now - t < this.opts.windowMs)
    if (this.timestamps.length >= this.opts.max) return false
    this.timestamps.push(now)
    return true
  }
}

export interface AgentHostOptions {
  /** Override the path to the worker bundle. Defaults to dist/main/agent.js (Plan B from Task 1). */
  workerPath?: string
}

export type ToMainListener = (message: ToMain) => void

export function buildWorkerEnv(
  baseEnv: NodeJS.ProcessEnv,
  agentRoot: string,
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    ONESHIP_AGENT_ROOT: agentRoot,
  }
}

/**
 * Internal: a single "I'm waiting for the worker to be ready" ticket.
 * Outlives any individual spawnWorker() call — respawns can satisfy or
 * reject the same ticket. start() creates it, start() awaits it, and the
 * spawn/exit machinery is responsible for either resolving (on a 'ready'
 * message) or rejecting (on terminal failure such as respawn-gate exhaustion).
 */
interface ReadyTicket {
  promise: Promise<void>
  resolve: () => void
  reject: (err: Error) => void
  settled: boolean
}

// Exported so unit tests in src/main/__tests__/agent-host.test.ts can
// exercise the ticket lifecycle without spinning up Electron's utilityProcess.
// AgentHost is the only production caller.
//
// The returned `resolve`/`reject` wrappers are SAFE BY CONSTRUCTION:
// they self-set `settled` and silently no-op on subsequent calls. The
// caller does not need to check `settled` before calling, and a stray
// double-settle (e.g. a respawned worker also reporting 'ready' after
// the first ticket already resolved) cannot accidentally trigger the
// underlying Promise twice. This is a reflection of the same idempotency
// guard in AgentHost.settleReady — keeping it on the helper itself
// closes the gap that an earlier review flagged as untested.
export function makeReadyTicket(): ReadyTicket {
  let rawResolve!: () => void
  let rawReject!: (err: Error) => void
  const promise = new Promise<void>((res, rej) => {
    rawResolve = res
    rawReject = rej
  })
  const ticket: ReadyTicket = {
    promise,
    resolve: () => {
      if (ticket.settled) return
      ticket.settled = true
      rawResolve()
    },
    reject: (err: Error) => {
      if (ticket.settled) return
      ticket.settled = true
      rawReject(err)
    },
    settled: false,
  }
  return ticket
}

export class AgentHost {
  private proc: UtilityProcess | null = null
  private listeners: Set<ToMainListener> = new Set()
  private currentReadyTicket: ReadyTicket | null = null
  private respawnGate = new RespawnGate({ max: 3, windowMs: 60_000 })
  private intentionalShutdown = false

  constructor(private options: AgentHostOptions = {}) {}

  /**
   * Default location: dist/main/agent.js relative to the Electron app root.
   *
   * Note: Task 1 used Plan B for the electron-vite build config — the agent
   * worker is a second input under the `main` build, so it bundles to
   * dist/main/agent.js, NOT the originally-planned dist/agent/index.js.
   * Verify with `ls dist/main/agent.js` after `pnpm build`.
   */
  private workerPath(): string {
    if (this.options.workerPath) return this.options.workerPath
    // app.getAppPath() returns the directory containing package.json in dev,
    // or the app.asar root in production.
    return join(app.getAppPath(), 'dist', 'main', 'agent.js')
  }

  /**
   * Fork the worker and wait until *some* spawn (the first one or a respawn
   * after early crashes) reports 'ready'. If the worker crashes before
   * reporting ready and the respawn gate has more attempts left, this method
   * keeps waiting on the same promise — the next successful spawn satisfies
   * it. If the respawn gate exhausts before any spawn reports ready, the
   * promise rejects and start() throws.
   */
  async start(): Promise<void> {
    if (this.proc) return
    this.intentionalShutdown = false
    if (!this.currentReadyTicket || this.currentReadyTicket.settled) {
      this.currentReadyTicket = makeReadyTicket()
    }
    this.spawnWorker()
    await this.currentReadyTicket.promise
  }

  private settleReady(kind: 'resolve', err?: undefined): void
  private settleReady(kind: 'reject', err: Error): void
  private settleReady(kind: 'resolve' | 'reject', err?: Error): void {
    const ticket = this.currentReadyTicket
    if (!ticket) return
    // ticket.resolve / ticket.reject are themselves idempotent — they self-
    // check `settled` and no-op on a second call. We just decide which side
    // to fire here.
    if (kind === 'resolve') ticket.resolve()
    else ticket.reject(err as Error)
  }

  private spawnWorker(): void {
    const path = this.workerPath()
    console.log('[agent-host] forking worker:', path)

    const proc = utilityProcess.fork(path, [], {
      env: buildWorkerEnv(process.env, runtimePaths().agentRoot),
      stdio: 'inherit',
      serviceName: 'oneship-agent',
    })
    this.proc = proc

    proc.on('message', (message) => {
      if (!isToMain(message)) return
      if (message.type === 'ready') {
        this.settleReady('resolve')
      }
      for (const l of this.listeners) l(message)
    })

    proc.on('exit', (code) => {
      console.log('[agent-host] worker exited code=', code, 'intentional=', this.intentionalShutdown)
      this.proc = null
      if (this.intentionalShutdown) return

      // If we crashed before sending 'ready', the existing readyTicket is
      // still unresolved. Decide whether to respawn (and let the next spawn
      // potentially resolve the same ticket) or to reject the ticket.
      if (this.respawnGate.allow()) {
        console.log('[agent-host] respawning worker')
        this.spawnWorker()
        // The new spawn shares the same currentReadyTicket. If it succeeds,
        // start() unblocks. If it also dies pre-ready, we recurse here.
      } else {
        const reason = `Agent worker respawn rate exceeded (${this.respawnGate.opts.max} crashes within ${this.respawnGate.opts.windowMs}ms)`
        console.error('[agent-host] respawn rate exceeded; giving up')
        // If anything is still waiting on currentReadyTicket, free them.
        // (This is a no-op if the ticket already resolved on an earlier
        // successful ready — that's the post-ready crash path.)
        this.settleReady('reject', new Error(reason))
        // Broadcast a synthetic `worker-unavailable` ToMain to every
        // listener so the UI can surface a real error instead of leaving
        // in-flight `sending` state hanging forever. This is the post-
        // ready-exhaustion path's only signal to the renderer — without
        // it, the UI sits stuck with no idea the worker is gone.
        const unavailable: ToMain = { type: 'worker-unavailable', reason }
        for (const l of this.listeners) l(unavailable)
      }
    })
  }

  /**
   * Post a ToWorker message to the live worker. Throws if no worker is
   * live (either not yet started, or the respawn gate exhausted after a
   * post-ready crash). Callers — specifically the `chief:send` IPC handler
   * in Main — should let the throw propagate so it becomes a Promise
   * rejection across the IPC boundary, and the renderer's
   * `sendUserMessage` catches it and flips status back to error.
   *
   * This replaces the earlier warn-and-drop behavior, which left the
   * renderer stuck in 'sending' with no signal that the send actually
   * went nowhere.
   */
  send(message: ToWorker): void {
    if (!this.proc) {
      throw new Error(
        `Agent worker is not available (message type: ${message.type}). ` +
          `The worker has either not started yet or the respawn gate exhausted ` +
          `after repeated crashes.`
      )
    }
    this.proc.postMessage(message)
  }

  on(listener: ToMainListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async shutdown(): Promise<void> {
    if (!this.proc) return
    this.intentionalShutdown = true
    this.send({ type: 'shutdown' })
    // Give the worker 3s to exit gracefully, then kill.
    await new Promise<void>((resolve) => {
      const proc = this.proc
      if (!proc) { resolve(); return }
      const timeout = setTimeout(() => {
        proc.kill()
        resolve()
      }, 3000)
      proc.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
    this.proc = null
  }
}
