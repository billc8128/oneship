export const TERMINAL_THEME_FILE_VERSION = 1

export type TerminalThemeSource = 'builtin' | 'custom'
export type TerminalCursorStyle = 'bar' | 'block' | 'underline'

export interface TerminalAnsiPalette {
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export interface TerminalThemeXterm {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  selectionForeground: string
  ansi: TerminalAnsiPalette
}

export interface TerminalThemeTypography {
  fontFamily: string
  fontSize: number
  lineHeight: number
  cursorStyle: TerminalCursorStyle
  cursorBlink: boolean
}

export interface TerminalThemeChrome {
  terminalBackground: string
  tabBarBackground: string
  tabActiveBackground: string
  tabActiveForeground: string
  tabInactiveForeground: string
  borderColor: string
}

export interface TerminalThemeDefinition {
  id: string
  name: string
  source: TerminalThemeSource
  locked: boolean
  basedOnThemeId?: string | null
  xterm: TerminalThemeXterm
  typography: TerminalThemeTypography
  chrome: TerminalThemeChrome
}

export interface TerminalThemeState {
  version: number
  activeThemeId: string
  themes: TerminalThemeDefinition[]
}

export interface TerminalThemePatch {
  name?: string
  xterm?: Partial<TerminalThemeXterm> & { ansi?: Partial<TerminalAnsiPalette> }
  typography?: Partial<TerminalThemeTypography>
  chrome?: Partial<TerminalThemeChrome>
}

const APP_CANVAS = '#FAF8F5'
const APP_SURFACE = '#FFFFFF'
const APP_SAND = '#F0ECE6'
const APP_BORDER = '#EDE8E1'
const APP_FOREGROUND = '#2C2520'
const APP_MUTED = '#8C8078'

function createAnsiPalette(base: Partial<TerminalAnsiPalette>): TerminalAnsiPalette {
  return {
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
    brightWhite: APP_CANVAS,
    ...base,
  }
}

function createTheme(definition: {
  id: string
  name: string
  source: TerminalThemeSource
  locked: boolean
  basedOnThemeId?: string | null
  xterm?: Partial<TerminalThemeXterm> & { ansi?: Partial<TerminalAnsiPalette> }
  typography?: Partial<TerminalThemeTypography>
  chrome?: Partial<TerminalThemeChrome>
}): TerminalThemeDefinition {
  return {
    id: definition.id,
    name: definition.name,
    source: definition.source,
    locked: definition.locked,
    basedOnThemeId: definition.basedOnThemeId ?? null,
    xterm: {
      background: APP_CANVAS,
      foreground: APP_FOREGROUND,
      cursor: APP_FOREGROUND,
      cursorAccent: APP_CANVAS,
      selectionBackground: APP_BORDER,
      selectionForeground: APP_FOREGROUND,
      ...definition.xterm,
      ansi: createAnsiPalette(definition.xterm?.ansi ?? {}),
    },
    typography: {
      fontFamily: 'IBM Plex Mono',
      fontSize: 13,
      lineHeight: 1.5,
      cursorStyle: 'bar',
      cursorBlink: true,
      ...definition.typography,
    },
    chrome: {
      terminalBackground: APP_CANVAS,
      tabBarBackground: APP_SURFACE,
      tabActiveBackground: APP_SAND,
      tabActiveForeground: APP_FOREGROUND,
      tabInactiveForeground: APP_MUTED,
      borderColor: APP_BORDER,
      ...definition.chrome,
    },
  }
}

export function getBuiltinTerminalThemes(): TerminalThemeDefinition[] {
  return [
    createTheme({
      id: 'builtin-ghostty-paper',
      name: 'Ghostty Paper',
      source: 'builtin',
      locked: true,
    }),
    createTheme({
      id: 'builtin-ghostty-ink',
      name: 'Ghostty Ink',
      source: 'builtin',
      locked: true,
      xterm: {
        background: '#151312',
        foreground: '#F5EFE8',
        cursor: '#F5EFE8',
        cursorAccent: '#151312',
        selectionBackground: '#2B241F',
        selectionForeground: '#F5EFE8',
        ansi: {
          black: '#151312',
          white: '#DDD3C7',
          brightBlack: '#6E625B',
          brightWhite: '#F5EFE8',
        },
      },
      chrome: {
        terminalBackground: '#151312',
        tabBarBackground: '#1B1816',
        tabActiveBackground: '#2B241F',
        tabActiveForeground: '#F5EFE8',
        tabInactiveForeground: '#B6AA9D',
        borderColor: '#2B241F',
      },
    }),
    createTheme({
      id: 'builtin-warm-sand',
      name: 'Warm Sand',
      source: 'builtin',
      locked: true,
      xterm: {
        background: '#F7F1E7',
        cursorAccent: '#F7F1E7',
        selectionBackground: '#E6DCCF',
        ansi: {
          brightWhite: '#F7F1E7',
        },
      },
      chrome: {
        terminalBackground: '#F7F1E7',
        tabBarBackground: '#FBF6EE',
        tabActiveBackground: '#E8DECF',
      },
    }),
    createTheme({
      id: 'builtin-midnight-terminal',
      name: 'Midnight Terminal',
      source: 'builtin',
      locked: true,
      xterm: {
        background: '#0F172A',
        foreground: '#E2E8F0',
        cursor: '#F8FAFC',
        cursorAccent: '#0F172A',
        selectionBackground: '#1E293B',
        selectionForeground: '#E2E8F0',
        ansi: {
          black: '#0F172A',
          red: '#F87171',
          green: '#34D399',
          yellow: '#FBBF24',
          blue: '#60A5FA',
          magenta: '#C084FC',
          cyan: '#22D3EE',
          white: '#CBD5E1',
          brightBlack: '#334155',
          brightRed: '#FCA5A5',
          brightGreen: '#6EE7B7',
          brightYellow: '#FCD34D',
          brightBlue: '#93C5FD',
          brightMagenta: '#D8B4FE',
          brightCyan: '#67E8F9',
          brightWhite: '#F8FAFC',
        },
      },
      chrome: {
        terminalBackground: '#0F172A',
        tabBarBackground: '#111827',
        tabActiveBackground: '#1E293B',
        tabActiveForeground: '#F8FAFC',
        tabInactiveForeground: '#94A3B8',
        borderColor: '#334155',
      },
    }),
  ]
}

export function createDefaultTerminalThemeState(): TerminalThemeState {
  const themes = getBuiltinTerminalThemes()
  return {
    version: TERMINAL_THEME_FILE_VERSION,
    activeThemeId: themes[0].id,
    themes,
  }
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }
  return Math.min(max, Math.max(min, value))
}

function normalizeTheme(candidate: unknown, builtinsById: Map<string, TerminalThemeDefinition>): TerminalThemeDefinition | null {
  if (!candidate || typeof candidate !== 'object') {
    return null
  }

  const raw = candidate as Partial<TerminalThemeDefinition>
  if (typeof raw.id !== 'string') return null

  const builtin = builtinsById.get(raw.id)
  if (builtin) {
    return builtin
  }

  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Custom Theme'
  const theme = createTheme({
    id: raw.id,
    name,
    source: 'custom',
    locked: false,
    basedOnThemeId: typeof raw.basedOnThemeId === 'string' ? raw.basedOnThemeId : null,
    xterm: {
      background: isHexColor(raw.xterm?.background) ? raw.xterm.background : undefined,
      foreground: isHexColor(raw.xterm?.foreground) ? raw.xterm.foreground : undefined,
      cursor: isHexColor(raw.xterm?.cursor) ? raw.xterm.cursor : undefined,
      cursorAccent: isHexColor(raw.xterm?.cursorAccent) ? raw.xterm.cursorAccent : undefined,
      selectionBackground: isHexColor(raw.xterm?.selectionBackground) ? raw.xterm.selectionBackground : undefined,
      selectionForeground: isHexColor(raw.xterm?.selectionForeground) ? raw.xterm.selectionForeground : undefined,
      ansi: Object.fromEntries(
        Object.entries(raw.xterm?.ansi ?? {}).filter(([, value]) => isHexColor(value)),
      ) as Partial<TerminalAnsiPalette>,
    },
    typography: {
      fontFamily: typeof raw.typography?.fontFamily === 'string' && raw.typography.fontFamily.trim()
        ? raw.typography.fontFamily
        : undefined,
      fontSize: normalizeNumber(raw.typography?.fontSize, 13, 11, 20),
      lineHeight: normalizeNumber(raw.typography?.lineHeight, 1.5, 1.2, 1.8),
      cursorStyle: raw.typography?.cursorStyle === 'block'
        || raw.typography?.cursorStyle === 'underline'
        || raw.typography?.cursorStyle === 'bar'
        ? raw.typography.cursorStyle
        : undefined,
      cursorBlink: typeof raw.typography?.cursorBlink === 'boolean' ? raw.typography.cursorBlink : undefined,
    },
    chrome: {
      terminalBackground: isHexColor(raw.chrome?.terminalBackground) ? raw.chrome.terminalBackground : undefined,
      tabBarBackground: isHexColor(raw.chrome?.tabBarBackground) ? raw.chrome.tabBarBackground : undefined,
      tabActiveBackground: isHexColor(raw.chrome?.tabActiveBackground) ? raw.chrome.tabActiveBackground : undefined,
      tabActiveForeground: isHexColor(raw.chrome?.tabActiveForeground) ? raw.chrome.tabActiveForeground : undefined,
      tabInactiveForeground: isHexColor(raw.chrome?.tabInactiveForeground) ? raw.chrome.tabInactiveForeground : undefined,
      borderColor: isHexColor(raw.chrome?.borderColor) ? raw.chrome.borderColor : undefined,
    },
  })

  return theme
}

export function normalizeTerminalThemeState(input: unknown): TerminalThemeState {
  const fallback = createDefaultTerminalThemeState()
  if (!input || typeof input !== 'object') {
    return fallback
  }

  const raw = input as Partial<TerminalThemeState>
  const builtins = getBuiltinTerminalThemes()
  const builtinsById = new Map(builtins.map((theme) => [theme.id, theme]))

  const customThemes = Array.isArray(raw.themes)
    ? raw.themes
        .map((theme) => normalizeTheme(theme, builtinsById))
        .filter((theme): theme is TerminalThemeDefinition => theme !== null && theme.source === 'custom')
    : []

  const themes = [...builtins, ...customThemes]
  const activeThemeId = typeof raw.activeThemeId === 'string' && themes.some((theme) => theme.id === raw.activeThemeId)
    ? raw.activeThemeId
    : fallback.activeThemeId

  return {
    version: TERMINAL_THEME_FILE_VERSION,
    activeThemeId,
    themes,
  }
}

export function duplicateTerminalTheme(
  sourceTheme: TerminalThemeDefinition,
  id: string,
  name?: string,
): TerminalThemeDefinition {
  return {
    ...sourceTheme,
    id,
    name: name?.trim() || `${sourceTheme.name} Copy`,
    source: 'custom',
    locked: false,
    basedOnThemeId: sourceTheme.id,
  }
}

export function updateTerminalTheme(
  theme: TerminalThemeDefinition,
  patch: TerminalThemePatch,
): TerminalThemeDefinition {
  return createTheme({
    id: theme.id,
    name: typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim() : theme.name,
    source: theme.source,
    locked: theme.locked,
    basedOnThemeId: theme.basedOnThemeId ?? null,
    xterm: {
      ...theme.xterm,
      ...patch.xterm,
      ansi: {
        ...theme.xterm.ansi,
        ...(patch.xterm?.ansi ?? {}),
      },
    },
    typography: {
      ...theme.typography,
      ...patch.typography,
    },
    chrome: {
      ...theme.chrome,
      ...patch.chrome,
    },
  })
}
