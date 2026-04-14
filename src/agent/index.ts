// Agent Worker entry point. Loaded by Electron's `utilityProcess.fork`.
//
// Communication with Main goes through `process.parentPort`, which is a
// MessagePortMain provided by Electron. Anything more sophisticated is
// handled in src/agent/ipc/server.ts.

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

startIpcServer(channel).catch((err) => {
  console.error('[agent] startIpcServer failed:', err)
  process.exit(1)
})
