import { createServer, type Server } from 'http'
import { BrowserWindow } from 'electron'

interface HookEvent {
  source: string
  event: {
    hook_event_name?: string
    tool_name?: string
    notification_type?: string
  }
  cwd: string
  terminalSessionId?: string
  timestamp: number
}

export interface AgentStatusEvent {
  source: string
  cwd: string
  sessionId: string
  status: 'idle' | 'working' | 'waiting' | 'done' | 'error'
  hookName: string
  toolName?: string
  timestamp: number
}

export interface HookStatusInput {
  hookName: string
  notificationType?: string | null
  previousStatus?: AgentStatusEvent['status'] | null
}

function mapNotificationToStatus(input: HookStatusInput): AgentStatusEvent['status'] {
  switch (input.notificationType) {
    case 'permission_prompt':
    case 'elicitation_dialog':
      return 'waiting'
    case 'idle_prompt':
      return input.previousStatus === 'done' ? 'done' : 'idle'
    case 'auth_success':
      return input.previousStatus === 'waiting' ? 'working' : (input.previousStatus ?? 'idle')
    default:
      return input.previousStatus ?? 'working'
  }
}

export function mapHookEventToStatus(input: HookStatusInput): AgentStatusEvent['status'] {
  switch (input.hookName) {
    case 'SessionStart':
      return 'idle'
    case 'UserPromptSubmit':
      return 'working'
    case 'PreToolUse':
      return 'working'
    case 'PostToolUse':
      return 'working'
    case 'PostToolUseFailure':
      return 'working'
    case 'PermissionRequest':
      return 'waiting'
    case 'PermissionDenied':
      return 'working'
    case 'Elicitation':
      return 'waiting'
    case 'ElicitationResult':
      return 'working'
    case 'Stop':
      return 'done'
    case 'StopFailure':
      return 'error'
    case 'SessionEnd':
      return 'idle'
    case 'Notification':
      return mapNotificationToStatus(input)
    default:
      return 'working'
  }
}

export function mapHookNameToStatus(hookName: string): AgentStatusEvent['status'] {
  return mapHookEventToStatus({ hookName })
}

export class HookServer {
  private server: Server | null = null
  private win: BrowserWindow | null = null
  private readonly onEvent?: (event: HookEvent) => void
  private readonly onError?: (error: Error) => void

  constructor(input?: {
    onEvent?: (event: HookEvent) => void
    onError?: (error: Error) => void
  }) {
    this.onEvent = input?.onEvent
    this.onError = input?.onError
  }

  async start(win: BrowserWindow, port: number) {
    this.win = win
    this.server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/hook') {
        let body = ''
        req.on('data', (chunk: Buffer) => (body += chunk))
        req.on('end', () => {
          try {
            const event: HookEvent = JSON.parse(body)
            this.handleEvent(event)
          } catch {
            // ignore malformed payloads
          }
          res.writeHead(200)
          res.end('ok')
        })
      } else {
        res.writeHead(404)
        res.end()
      }
    })

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject)
      this.server?.listen(port, '127.0.0.1', () => {
        console.log(`Hook server listening on port ${port}`)
        resolve()
      })
    })

    this.server.on('error', (err) => {
      console.error('Hook server error:', err)
      this.onError?.(err as Error)
    })
  }

  private handleEvent(event: HookEvent) {
    this.onEvent?.(event)

    const hookName = event.event?.hook_event_name || ''
    const status = mapHookEventToStatus({
      hookName,
      notificationType: event.event?.notification_type ?? null,
    })

    this.win?.webContents.send('agent:status', {
      source: event.source,
      cwd: event.cwd,
      sessionId: event.terminalSessionId || '',
      status,
      hookName,
      toolName: event.event?.tool_name,
      timestamp: event.timestamp
    } satisfies AgentStatusEvent)
  }

  stop() {
    this.server?.close()
  }
}
