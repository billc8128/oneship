import { describe, expect, it } from 'vitest'
import {
  createDefaultTerminalThemeState,
  normalizeTerminalThemeState,
} from '../terminal-theme'

describe('terminal theme schema', () => {
  it('creates a default state with locked built-in themes and an active theme', () => {
    const state = createDefaultTerminalThemeState()

    expect(state.version).toBe(1)
    expect(state.activeThemeId).toBe('builtin-ghostty-paper')
    expect(state.themes.map((theme) => theme.id)).toEqual([
      'builtin-ghostty-paper',
      'builtin-ghostty-ink',
      'builtin-warm-sand',
      'builtin-midnight-terminal',
    ])
    expect(state.themes.every((theme) => theme.locked && theme.source === 'builtin')).toBe(true)
  })

  it('recovers malformed state by restoring built-ins and a valid active theme', () => {
    const normalized = normalizeTerminalThemeState({
      version: 99,
      activeThemeId: 'missing-theme',
      themes: [
        {
          id: 'builtin-ghostty-paper',
          name: 'Mutated Builtin',
          source: 'custom',
          locked: false,
          xterm: { background: '#123456' },
        },
        {
          id: 'custom-1',
          name: 'My Theme',
          source: 'custom',
          locked: false,
          xterm: {
            background: '#101010',
            foreground: '#f5f5f5',
            cursor: '#f5f5f5',
            cursorAccent: '#101010',
            selectionBackground: '#222222',
            selectionForeground: '#f5f5f5',
            ansi: {
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
          },
          typography: {
            fontFamily: 'IBM Plex Mono',
            fontSize: 14,
            lineHeight: 1.5,
            cursorStyle: 'bar',
            cursorBlink: true,
          },
          chrome: {
            terminalBackground: '#101010',
            tabBarBackground: '#181818',
            tabActiveBackground: '#222222',
            tabActiveForeground: '#ffffff',
            tabInactiveForeground: '#c7c7c7',
            borderColor: '#333333',
          },
        },
      ],
    })

    expect(normalized.version).toBe(1)
    expect(normalized.activeThemeId).toBe('builtin-ghostty-paper')
    expect(normalized.themes[0]).toMatchObject({
      id: 'builtin-ghostty-paper',
      source: 'builtin',
      locked: true,
      name: 'Ghostty Paper',
    })
    expect(normalized.themes).toContainEqual(
      expect.objectContaining({
        id: 'custom-1',
        name: 'My Theme',
        source: 'custom',
        locked: false,
      }),
    )
  })
})
