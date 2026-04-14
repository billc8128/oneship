import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('terminal-theme-store', () => {
  let changedListener: ((state: unknown) => void) | null = null

  beforeEach(() => {
    vi.resetModules()
    changedListener = null

    ;(globalThis as { window?: Window }).window = {
      electronAPI: {
        terminalTheme: {
          getState: vi.fn(async () => ({
            version: 1,
            activeThemeId: 'builtin-ghostty-paper',
            themes: [
              {
                id: 'builtin-ghostty-paper',
                name: 'Ghostty Paper',
                source: 'builtin',
                locked: true,
                basedOnThemeId: null,
                xterm: {
                  background: '#FAF8F5',
                  foreground: '#2C2520',
                  cursor: '#2C2520',
                  cursorAccent: '#FAF8F5',
                  selectionBackground: '#EDE8E1',
                  selectionForeground: '#2C2520',
                  ansi: {
                    black: '#2C2520',
                    red: '#DC2626',
                    green: '#16A34A',
                    yellow: '#CA8A04',
                    blue: '#2563EB',
                    magenta: '#9333EA',
                    cyan: '#0891B2',
                    white: '#B8AFA6',
                    brightBlack: '#6B6058',
                    brightRed: '#EF4444',
                    brightGreen: '#22C55E',
                    brightYellow: '#EAB308',
                    brightBlue: '#3B82F6',
                    brightMagenta: '#A855F7',
                    brightCyan: '#06B6D4',
                    brightWhite: '#FAF8F5',
                  },
                },
                typography: {
                  fontFamily: 'IBM Plex Mono',
                  fontSize: 13,
                  lineHeight: 1.5,
                  cursorStyle: 'bar',
                  cursorBlink: true,
                },
                chrome: {
                  terminalBackground: '#FAF8F5',
                  tabBarBackground: '#FFFFFF',
                  tabActiveBackground: '#F0ECE6',
                  tabActiveForeground: '#2C2520',
                  tabInactiveForeground: '#8C8078',
                  borderColor: '#EDE8E1',
                },
              },
            ],
          })),
          onDidChange: vi.fn((listener: (state: unknown) => void) => {
            changedListener = listener
            return () => {
              changedListener = null
            }
          }),
        },
      },
    } as unknown as Window
  })

  it('initializes from IPC and updates the active theme when broadcasts arrive', async () => {
    const store = await import('../terminal-theme-store')

    await store.ensureTerminalThemeStoreInitialized()

    expect(store.getTerminalThemeSnapshot().state.activeThemeId).toBe('builtin-ghostty-paper')

    changedListener?.({
      version: 1,
      activeThemeId: 'custom-1',
      themes: [
        {
          ...store.getTerminalThemeSnapshot().state.themes[0],
          id: 'custom-1',
          name: 'My Theme',
          source: 'custom',
          locked: false,
          basedOnThemeId: 'builtin-ghostty-paper',
          xterm: {
            ...store.getTerminalThemeSnapshot().state.themes[0].xterm,
            background: '#101010',
          },
        },
      ],
    })

    expect(store.getTerminalThemeSnapshot().state.activeThemeId).toBe('custom-1')
    expect(store.getTerminalThemeSnapshot().resolvedActiveTheme.xterm.background).toBe('#101010')
  })
})
