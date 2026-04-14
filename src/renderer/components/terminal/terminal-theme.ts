import type { CSSProperties } from 'react'
import {
  createDefaultTerminalThemeState,
  type TerminalThemeChrome,
  type TerminalThemeDefinition,
  type TerminalThemeTypography,
  type TerminalThemeXterm,
} from '../../../shared/terminal-theme'

export interface ResolvedTerminalTheme {
  definition: TerminalThemeDefinition
  xterm: TerminalThemeXterm['ansi'] & {
    background: string
    foreground: string
    cursor: string
    cursorAccent: string
    selectionBackground: string
    selectionForeground: string
  }
  typography: TerminalThemeTypography
  chrome: TerminalThemeChrome
}

export const terminalViewShellClassName = 'w-full h-full p-2'
export const terminalViewPanelClassName = 'flex h-full w-full overflow-hidden'
export const terminalTabsBarClassName = 'flex items-center gap-1 px-6 py-3 border-b bg-surface'

export function resolveTerminalTheme(definition: TerminalThemeDefinition): ResolvedTerminalTheme {
  return {
    definition,
    xterm: {
      background: definition.xterm.background,
      foreground: definition.xterm.foreground,
      cursor: definition.xterm.cursor,
      cursorAccent: definition.xterm.cursorAccent,
      selectionBackground: definition.xterm.selectionBackground,
      selectionForeground: definition.xterm.selectionForeground,
      ...definition.xterm.ansi,
    },
    typography: definition.typography,
    chrome: definition.chrome,
  }
}

export const defaultResolvedTerminalTheme = resolveTerminalTheme(createDefaultTerminalThemeState().themes[0]!)

export function getTerminalTabsBarStyle(theme: ResolvedTerminalTheme): CSSProperties {
  return {
    backgroundColor: theme.chrome.tabBarBackground,
    borderColor: theme.chrome.borderColor,
  }
}

export function getTerminalActiveTabStyle(theme: ResolvedTerminalTheme): CSSProperties {
  return {
    backgroundColor: theme.chrome.tabActiveBackground,
    color: theme.chrome.tabActiveForeground,
  }
}

export function getTerminalInactiveTabStyle(theme: ResolvedTerminalTheme): CSSProperties {
  return {
    color: theme.chrome.tabInactiveForeground,
  }
}

export function getTerminalPanelStyle(theme: ResolvedTerminalTheme): CSSProperties {
  return {
    backgroundColor: theme.chrome.terminalBackground,
  }
}
