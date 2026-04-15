// Agent Worker entry point. Loaded by Electron's `utilityProcess.fork`.
//
// Communication with Main goes through `process.parentPort`, which is a
// MessagePortMain provided by Electron. Anything more sophisticated is
// handled in src/agent/ipc/server.ts.
//
// Process lifecycle: this file owns the `process.exit()` decision because
// the IPC server shouldn't know about process concerns. On receiving a
// `shutdown` message, we let the server do its internal cleanup first
// (Phase 1 is a no-op, Phase 2+ will flush pending writes), then exit
// cleanly. Without this, AgentHost.shutdown() in Main would always fall
// through to its 3-second hard-kill timeout.

import { startIpcServer, type IpcChannel } from './ipc/server'
import type { ToWorker, ToMain } from '../shared/agent-protocol'

declare const process: NodeJS.Process & {
  parentPort?: {
    postMessage(message: ToMain): void
    on(event: 'message', listener: (e: { data: ToWorker }) => void): void
  }
}

const port = process.parentPort
if (!port) {
  console.error('[agent] No parentPort — was this loaded outside utilityProcess?')
  process.exit(1)
}

const channel: IpcChannel = {
  postMessage(message) {
    port.postMessage(message)
  },
  onMessage(callback) {
    port.on('message', (e) => callback(e.data))
  },
}

startIpcServer(channel)
  .then((handle) => {
    // Install a separate shutdown listener that coexists with the server's
    // channel.onMessage subscription. Node EventEmitters support multiple
    // listeners on the same event — both fire for every incoming message.
    // The server gets to run its cleanup path first, then we exit.
    port.on('message', (e) => {
      if (e.data?.type === 'shutdown') {
        handle
          .shutdown()
          .catch((err) => console.error('[agent] server shutdown failed:', err))
          .finally(() => process.exit(0))
      }
    })
  })
  .catch((err) => {
    console.error('[agent] startIpcServer failed:', err)
    process.exit(1)
  })
