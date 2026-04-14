import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronState = vi.hoisted(() => {
  let exposedApi: unknown

  return {
    getExposedApi() {
      return exposedApi
    },
    setExposedApi(api: unknown) {
      exposedApi = api
    },
    ipcInvoke: vi.fn(),
    ipcOn: vi.fn(),
    ipcRemoveListener: vi.fn(),
    ipcSend: vi.fn(),
  }
})

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn((_key: string, api: unknown) => {
      electronState.setExposedApi(api)
    }),
  },
  ipcRenderer: {
    invoke: electronState.ipcInvoke,
    on: electronState.ipcOn,
    removeListener: electronState.ipcRemoveListener,
    send: electronState.ipcSend,
  },
}))

describe('preload session events', () => {
  beforeEach(async () => {
    vi.resetModules()
    electronState.ipcInvoke.mockReset()
    electronState.ipcOn.mockReset()
    electronState.ipcRemoveListener.mockReset()
    electronState.ipcSend.mockReset()
    electronState.setExposedApi(undefined)

    await import('../index')
  })

  it('exposes session.onRemoved wired to the session:removed ipc channel', () => {
    const api = electronState.getExposedApi() as {
      session: { onRemoved: (callback: (sessionId: string) => void) => () => void }
    }
    const callback = vi.fn()

    const unsubscribe = api.session.onRemoved(callback)

    expect(electronState.ipcOn).toHaveBeenCalledWith('session:removed', expect.any(Function))

    const listener = electronState.ipcOn.mock.calls.find(([channel]) => channel === 'session:removed')?.[1]
    expect(listener).toBeTypeOf('function')

    listener?.({}, 'session-42')
    expect(callback).toHaveBeenCalledWith('session-42')

    unsubscribe()
    expect(electronState.ipcRemoveListener).toHaveBeenCalledWith('session:removed', listener)
  })

  it('keeps the legacy electronAPI.chat namespace exposed for ProjectChat', () => {
    const api = electronState.getExposedApi() as {
      chat: {
        getConversation: (projectId: string | null) => unknown
        sendMessage: (projectId: string | null, content: string) => unknown
        getMessages: (projectId: string | null) => unknown
      }
    }

    expect(typeof api.chat.getConversation).toBe('function')
    expect(typeof api.chat.sendMessage).toBe('function')
    expect(typeof api.chat.getMessages).toBe('function')

    api.chat.getConversation('project-a')
    expect(electronState.ipcInvoke).toHaveBeenCalledWith('chat:getConversation', 'project-a')

    api.chat.sendMessage('project-a', 'hi')
    expect(electronState.ipcInvoke).toHaveBeenCalledWith('chat:sendMessage', 'project-a', 'hi')

    api.chat.getMessages(null)
    expect(electronState.ipcInvoke).toHaveBeenCalledWith('chat:getMessages', null)
  })

  it('exposes electronAPI.chief namespace wired to chief:send and chief:event', () => {
    const api = electronState.getExposedApi() as {
      chief: {
        send: (message: { type: string }) => unknown
        onEvent: (callback: (message: { type: string }) => void) => () => void
      }
    }

    expect(typeof api.chief.send).toBe('function')
    expect(typeof api.chief.onEvent).toBe('function')

    expect(() => api.chief.send({ type: 'list-sessions' })).not.toThrow()
    expect(electronState.ipcInvoke).toHaveBeenCalledWith('chief:send', { type: 'list-sessions' })

    const callback = vi.fn()
    const unsubscribe = api.chief.onEvent(callback)

    expect(electronState.ipcOn).toHaveBeenCalledWith('chief:event', expect.any(Function))

    const listener = electronState.ipcOn.mock.calls.find(([channel]) => channel === 'chief:event')?.[1]
    expect(listener).toBeTypeOf('function')

    listener?.({}, { type: 'ready' })
    expect(callback).toHaveBeenCalledWith({ type: 'ready' })

    unsubscribe()
    expect(electronState.ipcRemoveListener).toHaveBeenCalledWith('chief:event', listener)
  })
})
