// Architecture note:
// This store lifts xterm instances out of the React tree so they survive
// page navigation. Each session's Terminal, FitAddon, and host <div> live
// here, keyed by sessionId. TerminalView is a thin React wrapper that only
// calls attachTerminalView / detachTerminalView to move the host DOM in and
// out of whatever container is currently visible.
//
// Current strategy: TerminalPage renders at most ONE TerminalView (the active
// tab). Switching tabs unmounts the old TerminalView and mounts a new one,
// which moves the xterm host between containers. Because only one container
// is ever visible, fit() always runs against a real layout — no hidden
// display:none measurement bugs.
//
// Future direction (do not implement until needed):
// If we add split view, tab-to-window tear-off, terminal thumbnails, or any
// feature requiring one session to appear in multiple places, this store
// should evolve into a "single viewport + store-as-router" model:
//   - Delete the TerminalView component entirely.
//   - TerminalPage holds one (or many) plain <div ref={viewport} />.
//   - Store exposes setActiveViewport(sessionId, element) that moves the
//     appropriate xterm host into the given element and runs fit.
// The attach/detach API today is a stepping stone toward that design; it is
// not the final shape.
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import {
  defaultResolvedTerminalTheme,
  type ResolvedTerminalTheme,
} from '../components/terminal/terminal-theme'

interface DisposableLike {
  dispose(): void
}

interface ManagedTerminalView {
  attachedContainer: HTMLDivElement | null
  fitAddon: FitAddon
  host: HTMLDivElement
  onResizeDisposable: DisposableLike
  onTerminalDataDisposable: DisposableLike
  resizeObserver: ResizeObserver | null
  terminal: Terminal
  unsubscribeRendererData: () => void
  // Coalesces multiple scheduleFit calls into a single RAF so that attach,
  // focus, and ResizeObserver don't each fire their own fit on top of each
  // other during a tab switch.
  pendingFit: boolean
  // Last (cols, rows) we actually forwarded to the PTY. We de-dup here so
  // that identical fit results don't spam pty.resize and make TUI apps
  // (Claude Code, vim, less) repaint their whole screen every time the
  // user switches tabs.
  lastPtyCols: number
  lastPtyRows: number
  awaitingResizeRedrawClear: boolean
  hasPendingPtyResize: boolean
  pendingPtyCols: number
  pendingPtyRows: number
  pendingResizeRedrawBuffer: string
  pendingResizeRedrawExpiryTimer: ReturnType<typeof setTimeout> | null
  pendingResizeRedrawTimer: ReturnType<typeof setTimeout> | null
  forwardedResizes: Array<{
    at: number
    cols: number
    rows: number
  }>
}

interface TerminalBufferSnapshot {
  cols: number
  rows: number
  cursorX: number
  cursorY: number
  ybase: number
  ydisp: number
  length: number
  lines: string[]
}

interface TerminalDebugSnapshot {
  active: TerminalBufferSnapshot
  forwardedResizes: Array<{
    at: number
    cols: number
    rows: number
  }>
  modes: {
    synchronizedOutputMode: boolean
  }
  normal: TerminalBufferSnapshot
  sessionId: string
  viewportDataUrl: string | null
}

const terminalViews = new Map<string, ManagedTerminalView>()
let beforeUnloadRegistered = false
let viewportListenersRegistered = false
let windowResizeListener: (() => void) | null = null
let visualViewportResizeListener: (() => void) | null = null
let devicePixelRatioQuery: MediaQueryList | null = null
let devicePixelRatioChangeListener: ((event: MediaQueryListEvent) => void) | null = null
let activeResolvedTerminalTheme = defaultResolvedTerminalTheme
const isDevelopment = import.meta.env.DEV
const NO_REFLOW_WINDOWS_PTY = { backend: 'conpty', buildNumber: 1 } as const
const RESIZE_REDRAW_BUFFER_MS = 32
// Treat resize redraw interception as a short-lived handshake only. If the
// TUI does not start redrawing soon after SIGWINCH, later full-screen output
// is more likely to be a normal repaint than the resize response we were
// trying to de-scrollback.
const RESIZE_REDRAW_START_WINDOW_MS = 150

declare global {
  interface Window {
    __oneshipTerminalDebug?: {
      dumpSession(sessionId: string): TerminalDebugSnapshot | null
      listSessions(): string[]
    }
  }
}

function createTerminalHost(): HTMLDivElement {
  const host = document.createElement('div')
  host.className = 'h-full w-full overflow-hidden'
  host.style.width = '100%'
  host.style.height = '100%'
  return host
}

function runFitWithoutReflow(view: ManagedTerminalView, fit: () => void): void {
  const terminalOptions = view.terminal.options as Record<string, unknown>
  const hadWindowsPty = Object.prototype.hasOwnProperty.call(terminalOptions, 'windowsPty')
  const previousWindowsPty = terminalOptions.windowsPty

  // xterm reflows the primary buffer on resize whenever scrollback is enabled.
  // Claude stays on the normal buffer and redraws via CSI 2J/H on SIGWINCH,
  // so a fit-triggered resize will otherwise push the old UI frame into
  // scrollback before Claude repaints the new one. Temporarily advertising a
  // pre-21376 ConPTY disables reflow for the duration of this fit only.
  terminalOptions.windowsPty = { ...NO_REFLOW_WINDOWS_PTY }

  try {
    fit()
  } finally {
    if (hadWindowsPty) {
      terminalOptions.windowsPty = previousWindowsPty
    } else {
      delete terminalOptions.windowsPty
    }
  }
}

function serializeBuffer(terminal: Terminal, buffer: typeof terminal.buffer.active): TerminalBufferSnapshot {
  const lines: string[] = []
  for (let index = 0; index < buffer.length; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) ?? '')
  }

  return {
    cols: terminal.cols,
    rows: terminal.rows,
    cursorX: buffer.cursorX,
    cursorY: buffer.cursorY,
    ybase: buffer.baseY,
    ydisp: buffer.viewportY,
    length: buffer.length,
    lines,
  }
}

function captureViewportDataUrl(host: HTMLDivElement): string | null {
  const canvas = host.querySelector('canvas')
  if (!canvas || typeof canvas.toDataURL !== 'function') {
    return null
  }

  try {
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

function dumpTerminalSession(sessionId: string): TerminalDebugSnapshot | null {
  const view = terminalViews.get(sessionId)
  if (!view) {
    return null
  }

  return {
    sessionId,
    active: serializeBuffer(view.terminal, view.terminal.buffer.active),
    normal: serializeBuffer(view.terminal, view.terminal.buffer.normal),
    forwardedResizes: [...view.forwardedResizes],
    modes: {
      synchronizedOutputMode: view.terminal.modes.synchronizedOutputMode,
    },
    viewportDataUrl: captureViewportDataUrl(view.host),
  }
}

function exposeTerminalDebugHelpers(): void {
  if (typeof window === 'undefined') {
    return
  }

  window.__oneshipTerminalDebug = {
    dumpSession: dumpTerminalSession,
    listSessions: () => [...terminalViews.keys()],
  }
}

function fitTerminalView(view: ManagedTerminalView): void {
  // Don't fit into a container that has no layout yet (display:none, not
  // yet inserted, zero-sized wrapper). Fitting against a 0x0 box drives
  // xterm to cols=1 and then a follow-up fit has to drag it back to real
  // size — each of those transitions is a resize event the PTY forwards
  // to the TUI process, producing a screen repaint.
  const container = view.attachedContainer
  if (!container) return
  if (container.clientWidth <= 0 || container.clientHeight <= 0) return

  try {
    runFitWithoutReflow(view, () => {
      view.fitAddon.fit()
    })
  } catch {
    // Ignore fit errors while the host is detached or the layout is mid-transition.
  }
}

function clearPendingPtyResize(view: ManagedTerminalView): void {
  view.hasPendingPtyResize = false
}

function clearPendingResizeRedraw(view: ManagedTerminalView): void {
  if (view.pendingResizeRedrawTimer) {
    clearTimeout(view.pendingResizeRedrawTimer)
    view.pendingResizeRedrawTimer = null
  }
  if (view.pendingResizeRedrawExpiryTimer) {
    clearTimeout(view.pendingResizeRedrawExpiryTimer)
    view.pendingResizeRedrawExpiryTimer = null
  }
  view.pendingResizeRedrawBuffer = ''
  view.awaitingResizeRedrawClear = false
}

function commitPendingPtyResize(view: ManagedTerminalView, sessionId: string): void {
  if (!view.hasPendingPtyResize) {
    return
  }

  if (view.lastPtyCols === view.pendingPtyCols && view.lastPtyRows === view.pendingPtyRows) {
    clearPendingPtyResize(view)
    return
  }

  view.lastPtyCols = view.pendingPtyCols
  view.lastPtyRows = view.pendingPtyRows
  view.forwardedResizes.push({
    cols: view.pendingPtyCols,
    rows: view.pendingPtyRows,
    at: Date.now(),
  })
  if (view.forwardedResizes.length > 100) {
    view.forwardedResizes.shift()
  }
  view.awaitingResizeRedrawClear = true
  if (view.pendingResizeRedrawExpiryTimer) {
    clearTimeout(view.pendingResizeRedrawExpiryTimer)
  }
  view.pendingResizeRedrawExpiryTimer = setTimeout(() => {
    view.pendingResizeRedrawExpiryTimer = null
    view.awaitingResizeRedrawClear = false
  }, RESIZE_REDRAW_START_WINDOW_MS)
  window.electronAPI.terminal.resize(sessionId, view.pendingPtyCols, view.pendingPtyRows)
  clearPendingPtyResize(view)
}

function schedulePtyResize(view: ManagedTerminalView, sessionId: string, cols: number, rows: number): void {
  if (view.lastPtyCols === cols && view.lastPtyRows === rows) {
    clearPendingPtyResize(view)
    view.pendingPtyCols = cols
    view.pendingPtyRows = rows
    return
  }

  if (view.hasPendingPtyResize && view.pendingPtyCols === cols && view.pendingPtyRows === rows) {
    return
  }

  view.pendingPtyCols = cols
  view.pendingPtyRows = rows
  view.hasPendingPtyResize = true
}

function flushPendingResizeRedraw(view: ManagedTerminalView): void {
  if (!view.pendingResizeRedrawBuffer) {
    clearPendingResizeRedraw(view)
    return
  }

  const bufferedData = view.pendingResizeRedrawBuffer
  const shouldClear = view.awaitingResizeRedrawClear && bufferedData.includes('\u001b[2J')

  clearPendingResizeRedraw(view)

  if (shouldClear) {
    view.terminal.clear()
  }

  view.terminal.write(bufferedData)
}

function handleRendererData(view: ManagedTerminalView, data: string): boolean {
  if (!view.awaitingResizeRedrawClear && !view.pendingResizeRedrawTimer) {
    return false
  }

  if (view.pendingResizeRedrawExpiryTimer) {
    clearTimeout(view.pendingResizeRedrawExpiryTimer)
    view.pendingResizeRedrawExpiryTimer = null
  }
  view.pendingResizeRedrawBuffer += data
  if (view.pendingResizeRedrawTimer) {
    clearTimeout(view.pendingResizeRedrawTimer)
  }
  view.pendingResizeRedrawTimer = setTimeout(() => {
    flushPendingResizeRedraw(view)
  }, RESIZE_REDRAW_BUFFER_MS)
  return true
}

function scheduleFit(view: ManagedTerminalView): void {
  // Coalesce all pending fit requests into a single RAF. Without this the
  // attach path fires 3 fits back to back (reattach + focus + the initial
  // ResizeObserver callback) and each one can push a slightly different
  // (cols, rows) down to the PTY.
  if (view.pendingFit) return
  view.pendingFit = true
  requestAnimationFrame(() => {
    view.pendingFit = false
    fitTerminalView(view)
  })
}

function scheduleFitForAttachedViews(): void {
  for (const view of terminalViews.values()) {
    if (view.attachedContainer) {
      scheduleFit(view)
    }
  }
}

function addMediaQueryChangeListener(
  query: MediaQueryList,
  listener: (event: MediaQueryListEvent) => void,
): void {
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', listener)
    return
  }

  query.addListener(listener)
}

function removeMediaQueryChangeListener(
  query: MediaQueryList,
  listener: (event: MediaQueryListEvent) => void,
): void {
  if (typeof query.removeEventListener === 'function') {
    query.removeEventListener('change', listener)
    return
  }

  query.removeListener(listener)
}

function refreshDevicePixelRatioWatcher(): void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return
  }

  if (devicePixelRatioQuery && devicePixelRatioChangeListener) {
    removeMediaQueryChangeListener(devicePixelRatioQuery, devicePixelRatioChangeListener)
  }

  devicePixelRatioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
  devicePixelRatioChangeListener = () => {
    refreshDevicePixelRatioWatcher()
    scheduleFitForAttachedViews()
  }
  addMediaQueryChangeListener(devicePixelRatioQuery, devicePixelRatioChangeListener)
}

function ensureViewportFitListeners(): void {
  if (viewportListenersRegistered || typeof window === 'undefined') {
    return
  }

  windowResizeListener = () => {
    scheduleFitForAttachedViews()
  }
  window.addEventListener('resize', windowResizeListener)

  if (window.visualViewport) {
    visualViewportResizeListener = () => {
      scheduleFitForAttachedViews()
    }
    window.visualViewport.addEventListener('resize', visualViewportResizeListener)
  }

  refreshDevicePixelRatioWatcher()
  viewportListenersRegistered = true
}

function cleanupViewportFitListeners(): void {
  if (typeof window !== 'undefined') {
    if (windowResizeListener) {
      window.removeEventListener('resize', windowResizeListener)
    }

    if (window.visualViewport && visualViewportResizeListener) {
      window.visualViewport.removeEventListener('resize', visualViewportResizeListener)
    }
  }

  if (devicePixelRatioQuery && devicePixelRatioChangeListener) {
    removeMediaQueryChangeListener(devicePixelRatioQuery, devicePixelRatioChangeListener)
  }

  windowResizeListener = null
  visualViewportResizeListener = null
  devicePixelRatioQuery = null
  devicePixelRatioChangeListener = null
  viewportListenersRegistered = false
}

function attachResizeObserver(view: ManagedTerminalView, container: HTMLDivElement): void {
  view.resizeObserver?.disconnect()

  const resizeObserver = new ResizeObserver(() => {
    scheduleFit(view)
  })

  resizeObserver.observe(container)
  view.resizeObserver = resizeObserver
}

function moveHostIntoContainer(host: HTMLDivElement, container: HTMLDivElement): void {
  if (host.parentElement !== container) {
    host.remove()
    container.replaceChildren(host)
  }
}

function applyResolvedTerminalTheme(view: ManagedTerminalView, theme: ResolvedTerminalTheme): void {
  view.terminal.options.theme = theme.xterm
  view.terminal.options.fontFamily = theme.typography.fontFamily
  view.terminal.options.fontSize = theme.typography.fontSize
  view.terminal.options.lineHeight = theme.typography.lineHeight
  view.terminal.options.cursorStyle = theme.typography.cursorStyle
  view.terminal.options.cursorBlink = theme.typography.cursorBlink
  scheduleFit(view)
}

function createTerminalView(sessionId: string, container: HTMLDivElement): ManagedTerminalView {
  const terminal = new Terminal({
    fontFamily: activeResolvedTerminalTheme.typography.fontFamily,
    fontSize: activeResolvedTerminalTheme.typography.fontSize,
    lineHeight: activeResolvedTerminalTheme.typography.lineHeight,
    cursorBlink: activeResolvedTerminalTheme.typography.cursorBlink,
    cursorStyle: activeResolvedTerminalTheme.typography.cursorStyle,
    allowProposedApi: true,
    theme: activeResolvedTerminalTheme.xterm,
  })

  const fitAddon = new FitAddon()
  const webLinksAddon = new WebLinksAddon()
  const host = createTerminalHost()

  moveHostIntoContainer(host, container)

  terminal.loadAddon(fitAddon)
  terminal.loadAddon(webLinksAddon)
  terminal.open(host)

  // Holds a forward reference so the onResize closure can read the latest
  // view state (lastPtyCols/lastPtyRows) even though the view object is
  // constructed below.
  let viewRef: ManagedTerminalView
  const unsubscribeRendererData = window.electronAPI.terminal.onData(sessionId, (data: string) => {
    if (viewRef && handleRendererData(viewRef, data)) {
      return
    }
    terminal.write(data)
  })

  window.electronAPI.terminal.subscribe(sessionId)

  const onTerminalDataDisposable = terminal.onData((data: string) => {
    if (viewRef?.hasPendingPtyResize) {
      commitPendingPtyResize(viewRef, sessionId)
    }
    window.electronAPI.terminal.write(sessionId, data)
  })

  const onResizeDisposable = terminal.onResize(({ cols, rows }) => {
    if (!viewRef) {
      return
    }
    schedulePtyResize(viewRef, sessionId, cols, rows)
  })

  const view: ManagedTerminalView = {
    attachedContainer: container,
    fitAddon,
    host,
    onResizeDisposable,
    onTerminalDataDisposable,
    resizeObserver: null,
    terminal,
    unsubscribeRendererData,
    pendingFit: false,
    lastPtyCols: 0,
    lastPtyRows: 0,
    awaitingResizeRedrawClear: false,
    hasPendingPtyResize: false,
    pendingPtyCols: 0,
    pendingPtyRows: 0,
    pendingResizeRedrawBuffer: '',
    pendingResizeRedrawExpiryTimer: null,
    pendingResizeRedrawTimer: null,
    forwardedResizes: [],
  }
  viewRef = view

  // Same ordering as attachTerminalView's reattach path: schedule our fit
  // first, then install the observer. pendingFit coalesces any observer
  // initial callback into the already-queued fit.
  scheduleFit(view)
  attachResizeObserver(view, container)

  return view
}

function ensureBeforeUnloadCleanup(): void {
  if (typeof window === 'undefined') {
    return
  }

  ensureViewportFitListeners()

  if (beforeUnloadRegistered) {
    return
  }

  window.addEventListener('beforeunload', destroyAllTerminalViews)
  beforeUnloadRegistered = true
}

export function attachTerminalView(sessionId: string, container: HTMLDivElement): void {
  ensureBeforeUnloadCleanup()

  let view = terminalViews.get(sessionId)
  if (!view) {
    view = createTerminalView(sessionId, container)
    terminalViews.set(sessionId, view)
    return
  }

  if (view.attachedContainer !== null && view.attachedContainer !== container) {
    const message = `Terminal session ${sessionId} is already attached to another container.`
    if (isDevelopment) {
      throw new Error(message)
    }
    console.warn(message)
  }

  moveHostIntoContainer(view.host, container)
  view.attachedContainer = container
  // Schedule the fit BEFORE installing the ResizeObserver. Both of them
  // converge on scheduleFit(), which coalesces via pendingFit — so the
  // observer's spec-mandated initial callback will be a no-op while our
  // explicit fit is already pending. If the observer doesn't fire at all
  // (some engines skip the initial call when dimensions match), our
  // explicit scheduleFit guarantees we still run exactly one fit.
  scheduleFit(view)
  attachResizeObserver(view, container)
}

export function detachTerminalView(sessionId: string, container: HTMLDivElement): void {
  const view = terminalViews.get(sessionId)
  if (!view || view.attachedContainer !== container) {
    return
  }

  view.resizeObserver?.disconnect()
  view.resizeObserver = null
  clearPendingPtyResize(view)
  clearPendingResizeRedraw(view)
  view.attachedContainer = null
  view.host.remove()
}

export function focusTerminalView(sessionId: string): void {
  const view = terminalViews.get(sessionId)
  if (!view) {
    return
  }

  // Don't schedule a fit here — attachTerminalView and the ResizeObserver
  // already own that responsibility. Firing a third fit from focus just
  // risks producing another pty.resize event on top of the existing ones,
  // which makes TUI apps (Claude Code, vim, less) repaint. Just grab focus.
  requestAnimationFrame(() => {
    view.terminal.focus()
  })
}

export function applyResolvedTerminalThemeToAllViews(theme: ResolvedTerminalTheme): void {
  activeResolvedTerminalTheme = theme
  for (const view of terminalViews.values()) {
    applyResolvedTerminalTheme(view, theme)
  }
}

export function destroyTerminalView(sessionId: string): void {
  const view = terminalViews.get(sessionId)
  if (!view) {
    return
  }

  view.resizeObserver?.disconnect()
  view.resizeObserver = null
  clearPendingPtyResize(view)
  clearPendingResizeRedraw(view)
  view.host.remove()
  view.attachedContainer = null
  view.onTerminalDataDisposable.dispose()
  view.onResizeDisposable.dispose()
  view.unsubscribeRendererData()
  window.electronAPI.terminal.unsubscribe(sessionId)
  view.terminal.dispose()
  terminalViews.delete(sessionId)
}

export function destroyAllTerminalViews(): void {
  for (const sessionId of [...terminalViews.keys()]) {
    destroyTerminalView(sessionId)
  }
}

export function resetTerminalViewStoreForTests(): void {
  destroyAllTerminalViews()
  cleanupViewportFitListeners()
  activeResolvedTerminalTheme = defaultResolvedTerminalTheme

  if (beforeUnloadRegistered && typeof window !== 'undefined') {
    window.removeEventListener('beforeunload', destroyAllTerminalViews)
  }

  beforeUnloadRegistered = false
}

exposeTerminalDebugHelpers()
