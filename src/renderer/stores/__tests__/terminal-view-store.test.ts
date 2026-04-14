import { beforeEach, describe, expect, it, vi } from 'vitest'

type MockHostElement = {
  className: string
  style: Record<string, string>
  parentElement: MockContainerElement | null
  querySelector: (selector: string) => { toDataURL: () => string } | null
  remove: () => void
}

type MockContainerElement = {
  currentChild: MockHostElement | null
  clientHeight: number
  clientWidth: number
  replaceChildren: (...children: MockHostElement[]) => void
  appendChild: (child: MockHostElement) => void
}

const xtermState = vi.hoisted(() => {
  const terminals: Array<{
    buffer: {
      active: {
        baseY: number
        cursorX: number
        cursorY: number
        length: number
        viewportY: number
        getLine: (index: number) => { translateToString: (_trimRight: boolean) => string } | undefined
      }
      normal: {
        baseY: number
        cursorX: number
        cursorY: number
        length: number
        viewportY: number
        getLine: (index: number) => { translateToString: (_trimRight: boolean) => string } | undefined
      }
    }
    cols: number
    rows: number
    loadAddon: ReturnType<typeof vi.fn>
    modes: { synchronizedOutputMode: boolean }
    open: ReturnType<typeof vi.fn>
    write: ReturnType<typeof vi.fn>
    clear: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    onData: ReturnType<typeof vi.fn>
    onResize: ReturnType<typeof vi.fn>
    options: Record<string, unknown>
  }> = []

  class MockTerminal {
    buffer = {
      active: {
        baseY: 0,
        cursorX: 0,
        cursorY: 0,
        length: 2,
        viewportY: 0,
        getLine: vi.fn((index: number) => {
          const lines = ['active-line-1', 'active-line-2']
          const value = lines[index]
          return value === undefined
            ? undefined
            : { translateToString: vi.fn(() => value) }
        }),
      },
      normal: {
        baseY: 1,
        cursorX: 3,
        cursorY: 4,
        length: 3,
        viewportY: 1,
        getLine: vi.fn((index: number) => {
          const lines = ['normal-line-1', 'normal-line-2', 'normal-line-3']
          const value = lines[index]
          return value === undefined
            ? undefined
            : { translateToString: vi.fn(() => value) }
        }),
      },
    }
    cols = 80
    loadAddon = vi.fn()
    modes = { synchronizedOutputMode: true }
    open = vi.fn()
    rows = 24
    write = vi.fn()
    clear = vi.fn()
    focus = vi.fn()
    dispose = vi.fn()
    onData = vi.fn(() => ({ dispose: vi.fn() }))
    onResize = vi.fn(() => ({ dispose: vi.fn() }))
    options: Record<string, unknown>

    constructor(options: Record<string, unknown> = {}) {
      this.options = { ...options }
      terminals.push(this)
    }
  }

  const fitAddons: Array<{ fit: ReturnType<typeof vi.fn> }> = []

  class MockFitAddon {
    fit = vi.fn()

    constructor() {
      fitAddons.push(this)
    }
  }

  class MockWebLinksAddon {}

  return { terminals, fitAddons, MockTerminal, MockFitAddon, MockWebLinksAddon }
})

const resizeObserverState = vi.hoisted(() => {
  const instances: Array<{ observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = []

  class MockResizeObserver {
    observe = vi.fn()
    disconnect = vi.fn()

    constructor(_callback: ResizeObserverCallback) {
      instances.push(this)
    }
  }

  return { instances, MockResizeObserver }
})

vi.mock('@xterm/xterm', () => ({
  Terminal: xtermState.MockTerminal,
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: xtermState.MockFitAddon,
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: xtermState.MockWebLinksAddon,
}))

function createContainer(): MockContainerElement {
  return {
    currentChild: null,
    clientHeight: 600,
    clientWidth: 960,
    replaceChildren(...children: MockHostElement[]) {
      if (this.currentChild) {
        this.currentChild.parentElement = null
      }

      const [nextChild] = children
      this.currentChild = nextChild ?? null

      if (nextChild) {
        nextChild.parentElement = this
      }
    },
    appendChild(child: MockHostElement) {
      this.replaceChildren(child)
    },
  }
}

function createHost(): MockHostElement {
  const canvas = {
    toDataURL: vi.fn(() => 'data:image/png;base64,canvas-snapshot'),
  }

  return {
    className: '',
    style: {},
    parentElement: null,
    querySelector(selector: string) {
      return selector === 'canvas' ? canvas : null
    },
    remove() {
      this.parentElement?.replaceChildren()
    },
  }
}

describe('terminal-view-store', () => {
  let subscribe: ReturnType<typeof vi.fn>
  let unsubscribe: ReturnType<typeof vi.fn>
  let writeToPty: ReturnType<typeof vi.fn>
  let resizePty: ReturnType<typeof vi.fn>
  let removeRendererListener: ReturnType<typeof vi.fn>
  let emitRendererData: ((data: string) => void) | null
  let mediaQueryChangeListeners: Set<(event: Event) => void>
  let terminalViewStore: typeof import('../terminal-view-store')

  beforeEach(async () => {
    vi.resetModules()

    xtermState.terminals.length = 0
    xtermState.fitAddons.length = 0
    resizeObserverState.instances.length = 0

    subscribe = vi.fn()
    unsubscribe = vi.fn()
    writeToPty = vi.fn()
    resizePty = vi.fn()
    removeRendererListener = vi.fn()
    emitRendererData = null
    mediaQueryChangeListeners = new Set()

    ;(globalThis as { document?: Document }).document = {
      createElement: vi.fn(() => createHost()),
    } as unknown as Document

    ;(globalThis as { window?: Window }).window = {
      electronAPI: {
        terminal: {
          subscribe,
          unsubscribe,
          onData: vi.fn((_sessionId: string, listener: (data: string) => void) => {
            emitRendererData = listener
            return removeRendererListener
          }),
          write: writeToPty,
          resize: resizePty,
        },
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      devicePixelRatio: 1,
      matchMedia: vi.fn(() => ({
        matches: true,
        media: '(resolution: 1dppx)',
        addEventListener: vi.fn((type: string, listener: (event: Event) => void) => {
          if (type === 'change') {
            mediaQueryChangeListeners.add(listener)
          }
        }),
        removeEventListener: vi.fn((type: string, listener: (event: Event) => void) => {
          if (type === 'change') {
            mediaQueryChangeListeners.delete(listener)
          }
        }),
      })),
    } as unknown as Window

    ;(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
      resizeObserverState.MockResizeObserver as unknown as typeof ResizeObserver

    ;(globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
      ((callback: FrameRequestCallback) => {
        callback(0)
        return 1
      }) as typeof requestAnimationFrame

    terminalViewStore = await import('../terminal-view-store')
    terminalViewStore.resetTerminalViewStoreForTests()
  })

  it('reuses the same xterm instance when a session detaches and reattaches', () => {
    const firstContainer = createContainer()
    const secondContainer = createContainer()

    terminalViewStore.attachTerminalView('session-1', firstContainer as unknown as HTMLDivElement)
    terminalViewStore.detachTerminalView('session-1', firstContainer as unknown as HTMLDivElement)
    terminalViewStore.attachTerminalView('session-1', secondContainer as unknown as HTMLDivElement)

    expect(xtermState.terminals).toHaveLength(1)
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(unsubscribe).not.toHaveBeenCalled()
    expect(removeRendererListener).not.toHaveBeenCalled()
    expect(xtermState.terminals[0]?.dispose).not.toHaveBeenCalled()
    expect(firstContainer.currentChild).toBeNull()
    expect(secondContainer.currentChild).not.toBeNull()
  })

  it('fully tears down the terminal session only when explicitly destroyed', () => {
    const container = createContainer()

    terminalViewStore.attachTerminalView('session-1', container as unknown as HTMLDivElement)
    terminalViewStore.destroyTerminalView('session-1')

    expect(removeRendererListener).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledWith('session-1')
    expect(xtermState.terminals[0]?.dispose).toHaveBeenCalledTimes(1)
  })

  it('throws in development when the same session is attached to two containers at once', () => {
    const firstContainer = createContainer()
    const secondContainer = createContainer()

    terminalViewStore.attachTerminalView('session-1', firstContainer as unknown as HTMLDivElement)

    expect(() => {
      terminalViewStore.attachTerminalView('session-1', secondContainer as unknown as HTMLDivElement)
    }).toThrow(/already attached/i)
  })

  it('keeps non-active xterm instances alive across project switches so they can be reused on return', () => {
    // Project A: user opens session-A1, switches to session-A2, switches back to A1
    const projectAContainer1 = createContainer()
    terminalViewStore.attachTerminalView('session-A1', projectAContainer1 as unknown as HTMLDivElement)

    terminalViewStore.detachTerminalView('session-A1', projectAContainer1 as unknown as HTMLDivElement)
    const projectAContainer2 = createContainer()
    terminalViewStore.attachTerminalView('session-A2', projectAContainer2 as unknown as HTMLDivElement)

    // Project B: TerminalPage remounts due to key={projectId}, new session attaches
    terminalViewStore.detachTerminalView('session-A2', projectAContainer2 as unknown as HTMLDivElement)
    const projectBContainer = createContainer()
    terminalViewStore.attachTerminalView('session-B1', projectBContainer as unknown as HTMLDivElement)

    // Sanity check: three distinct xterm instances exist at this point
    expect(xtermState.terminals).toHaveLength(3)
    expect(subscribe).toHaveBeenCalledTimes(3)

    // Project B: user closes B1 (explicit destroy, unlike detach)
    terminalViewStore.destroyTerminalView('session-B1')

    // Return to Project A, reattaching the non-active A2 first (simulating
    // a direct navigation to A2's URL after project switch)
    const projectAContainer2Reborn = createContainer()
    terminalViewStore.attachTerminalView('session-A2', projectAContainer2Reborn as unknown as HTMLDivElement)

    // Then user switches to A1
    terminalViewStore.detachTerminalView('session-A2', projectAContainer2Reborn as unknown as HTMLDivElement)
    const projectAContainer1Reborn = createContainer()
    terminalViewStore.attachTerminalView('session-A1', projectAContainer1Reborn as unknown as HTMLDivElement)

    // The critical invariant: no new xterm instances were created on return.
    // A1 and A2 reuse the exact instances from before the project switch;
    // only B1 was ever destroyed.
    expect(xtermState.terminals).toHaveLength(3)
    expect(subscribe).toHaveBeenCalledTimes(3)
    expect(xtermState.terminals[0]?.dispose).not.toHaveBeenCalled() // A1 alive
    expect(xtermState.terminals[1]?.dispose).not.toHaveBeenCalled() // A2 alive
    expect(xtermState.terminals[2]?.dispose).toHaveBeenCalledTimes(1) // B1 destroyed
  })

  it('re-fits attached terminals when page zoom changes even if the container size is unchanged', () => {
    const container = createContainer()

    terminalViewStore.attachTerminalView('session-zoom', container as unknown as HTMLDivElement)

    expect(xtermState.fitAddons[0]?.fit).toHaveBeenCalledTimes(1)
    expect(mediaQueryChangeListeners.size).toBeGreaterThan(0)

    ;(window as unknown as { devicePixelRatio: number }).devicePixelRatio = 1.25
    for (const listener of [...mediaQueryChangeListeners]) {
      listener(new Event('change'))
    }

    expect(xtermState.fitAddons[0]?.fit).toHaveBeenCalledTimes(2)
  })

  it('applies a resolved terminal theme to already-open xterm instances', () => {
    const container = createContainer()

    terminalViewStore.attachTerminalView('session-theme', container as unknown as HTMLDivElement)

    terminalViewStore.applyResolvedTerminalThemeToAllViews({
      xterm: {
        background: '#101010',
        foreground: '#f5f5f5',
        cursor: '#f5f5f5',
        cursorAccent: '#101010',
        selectionBackground: '#222222',
        selectionForeground: '#f5f5f5',
        black: '#111111',
        red: '#cc6666',
        green: '#99cc99',
        yellow: '#f0c674',
        blue: '#6699cc',
        magenta: '#cc99cc',
        cyan: '#66cccc',
        white: '#dddddd',
        brightBlack: '#444444',
        brightRed: '#ff7777',
        brightGreen: '#aaffaa',
        brightYellow: '#ffdd88',
        brightBlue: '#77aaff',
        brightMagenta: '#ddaaff',
        brightCyan: '#88ffff',
        brightWhite: '#ffffff',
      },
      typography: {
        fontFamily: 'Menlo',
        fontSize: 15,
        lineHeight: 1.6,
        cursorStyle: 'block',
        cursorBlink: false,
      },
      chrome: {
        terminalBackground: '#101010',
        tabBarBackground: '#181818',
        tabActiveBackground: '#222222',
        tabActiveForeground: '#ffffff',
        tabInactiveForeground: '#c7c7c7',
        borderColor: '#333333',
      },
    })

    expect(xtermState.terminals[0]?.options.theme).toEqual(
      expect.objectContaining({
        background: '#101010',
        foreground: '#f5f5f5',
      }),
    )
    expect(xtermState.terminals[0]?.options.fontFamily).toBe('Menlo')
    expect(xtermState.terminals[0]?.options.fontSize).toBe(15)
    expect(xtermState.terminals[0]?.options.lineHeight).toBe(1.6)
    expect(xtermState.terminals[0]?.options.cursorStyle).toBe('block')
    expect(xtermState.terminals[0]?.options.cursorBlink).toBe(false)
    expect(xtermState.fitAddons[0]?.fit).toHaveBeenCalledTimes(2)
  })

  it('temporarily disables xterm reflow while fitting and restores the previous windowsPty option', () => {
    const container = createContainer()

    terminalViewStore.attachTerminalView('session-fit', container as unknown as HTMLDivElement)

    const originalWindowsPty = { backend: 'conpty', buildNumber: 30000 }
    xtermState.terminals[0]!.options.windowsPty = originalWindowsPty

    let windowsPtySeenInsideFit: unknown
    xtermState.fitAddons[0]!.fit.mockImplementation(() => {
      windowsPtySeenInsideFit = xtermState.terminals[0]!.options.windowsPty
    })

    terminalViewStore.applyResolvedTerminalThemeToAllViews({
      xterm: {
        background: '#101010',
        foreground: '#f5f5f5',
        cursor: '#f5f5f5',
        cursorAccent: '#101010',
        selectionBackground: '#222222',
        selectionForeground: '#f5f5f5',
        black: '#111111',
        red: '#cc6666',
        green: '#99cc99',
        yellow: '#f0c674',
        blue: '#6699cc',
        magenta: '#cc99cc',
        cyan: '#66cccc',
        white: '#dddddd',
        brightBlack: '#444444',
        brightRed: '#ff7777',
        brightGreen: '#aaffaa',
        brightYellow: '#ffdd88',
        brightBlue: '#77aaff',
        brightMagenta: '#ddaaff',
        brightCyan: '#88ffff',
        brightWhite: '#ffffff',
      },
      typography: {
        fontFamily: 'Menlo',
        fontSize: 15,
        lineHeight: 1.6,
        cursorStyle: 'block',
        cursorBlink: false,
      },
      chrome: {
        terminalBackground: '#101010',
        tabBarBackground: '#181818',
        tabActiveBackground: '#222222',
        tabActiveForeground: '#ffffff',
        tabInactiveForeground: '#c7c7c7',
        borderColor: '#333333',
      },
    })

    expect(windowsPtySeenInsideFit).toEqual({ backend: 'conpty', buildNumber: 1 })
    expect(xtermState.terminals[0]!.options.windowsPty).toBe(originalWindowsPty)
  })

  it('exposes a debug snapshot with buffers and viewport image data', () => {
    const container = createContainer()

    terminalViewStore.attachTerminalView('session-debug', container as unknown as HTMLDivElement)

    const snapshot = window.__oneshipTerminalDebug?.dumpSession('session-debug')

    expect(window.__oneshipTerminalDebug?.listSessions()).toContain('session-debug')
    expect(snapshot).toEqual(
      expect.objectContaining({
        sessionId: 'session-debug',
        viewportDataUrl: 'data:image/png;base64,canvas-snapshot',
        modes: { synchronizedOutputMode: true },
        forwardedResizes: [],
        active: expect.objectContaining({
          length: 2,
          lines: ['active-line-1', 'active-line-2'],
        }),
        normal: expect.objectContaining({
          length: 3,
          ybase: 1,
          ydisp: 1,
          cursorX: 3,
          cursorY: 4,
          lines: ['normal-line-1', 'normal-line-2', 'normal-line-3'],
        }),
      }),
    )
  })

  it('does not forward PTY resize until it is explicitly flushed', () => {
    vi.useFakeTimers()
    const container = createContainer()

    try {
      terminalViewStore.attachTerminalView('session-resize-trace', container as unknown as HTMLDivElement)

      const onResize = xtermState.terminals[0]!.onResize.mock.calls[0]![0] as (size: {
        cols: number
        rows: number
      }) => void

      onResize({ cols: 100, rows: 30 })
      onResize({ cols: 100, rows: 30 }) // de-duped while pending
      onResize({ cols: 101, rows: 30 })

      expect(resizePty).not.toHaveBeenCalled()

      vi.runAllTimers()

      const snapshot = window.__oneshipTerminalDebug?.dumpSession('session-resize-trace')

      expect(resizePty).not.toHaveBeenCalled()
      expect(snapshot?.forwardedResizes).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('flushes a pending PTY resize before forwarding terminal input', () => {
    vi.useFakeTimers()
    const container = createContainer()

    try {
      terminalViewStore.attachTerminalView('session-input-flush', container as unknown as HTMLDivElement)

      const onResize = xtermState.terminals[0]!.onResize.mock.calls[0]![0] as (size: {
        cols: number
        rows: number
      }) => void
      const onData = xtermState.terminals[0]!.onData.mock.calls[0]![0] as (data: string) => void

      onResize({ cols: 120, rows: 40 })

      expect(resizePty).not.toHaveBeenCalled()

      onData('ls\n')

      expect(resizePty).toHaveBeenCalledWith('session-input-flush', 120, 40)
      expect(writeToPty).toHaveBeenCalledWith('session-input-flush', 'ls\n')
    } finally {
      vi.useRealTimers()
    }
  })

  it('buffers a resize-triggered redraw burst and clears once before writing it', () => {
    vi.useFakeTimers()
    const container = createContainer()

    try {
      terminalViewStore.attachTerminalView('session-resize-redraw', container as unknown as HTMLDivElement)

      const onResize = xtermState.terminals[0]!.onResize.mock.calls[0]![0] as (size: {
        cols: number
        rows: number
      }) => void
      const onData = xtermState.terminals[0]!.onData.mock.calls[0]![0] as (data: string) => void

      onResize({ cols: 120, rows: 40 })
      onData('ls\n')
      emitRendererData?.('\u001b[2J')
      emitRendererData?.('\u001b[Hredraw')

      expect(xtermState.terminals[0]!.clear).not.toHaveBeenCalled()

      vi.runAllTimers()

      expect(xtermState.terminals[0]!.clear).toHaveBeenCalledTimes(1)
      expect(xtermState.terminals[0]!.write).toHaveBeenCalledWith('\u001b[2J\u001b[Hredraw')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not keep treating later full-screen output as resize redraw after the resize window has gone stale', () => {
    vi.useFakeTimers()
    const container = createContainer()

    try {
      terminalViewStore.attachTerminalView('session-stale-resize-redraw', container as unknown as HTMLDivElement)

      const onResize = xtermState.terminals[0]!.onResize.mock.calls[0]![0] as (size: {
        cols: number
        rows: number
      }) => void
      const onData = xtermState.terminals[0]!.onData.mock.calls[0]![0] as (data: string) => void

      onResize({ cols: 120, rows: 40 })
      onData('ls\n')

      vi.advanceTimersByTime(1_000)

      emitRendererData?.('\u001b[2J\u001b[Hlater redraw')
      vi.runAllTimers()

      expect(xtermState.terminals[0]!.clear).not.toHaveBeenCalled()
      expect(xtermState.terminals[0]!.write).toHaveBeenCalledWith('\u001b[2J\u001b[Hlater redraw')
    } finally {
      vi.useRealTimers()
    }
  })
})
