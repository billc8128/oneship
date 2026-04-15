import { describe, expect, it } from 'vitest'
import {
  defaultResolvedTerminalTheme,
  terminalTabsBarClassName,
  terminalViewPanelClassName,
  terminalViewShellClassName,
} from '../terminal-theme'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tailwindConfig = require('../../../../../tailwind.config.js')

describe('terminal theme', () => {
  it('defines a semantic danger color for destructive controls', () => {
    expect(tailwindConfig.theme.extend.colors.danger).toMatch(/^#/)
  })

  it('keeps the terminal content palette aligned with the app canvas baseline', () => {
    expect(defaultResolvedTerminalTheme.xterm.background).toBe(tailwindConfig.theme.extend.colors.canvas)
    expect(defaultResolvedTerminalTheme.xterm.brightWhite).toBe(tailwindConfig.theme.extend.colors.canvas)
  })

  it('keeps the terminal area inset instead of flattening it into the workspace canvas', () => {
    expect(terminalViewShellClassName).toContain('p-2')
    expect(terminalViewShellClassName).not.toContain('bg-canvas')
    expect(terminalViewPanelClassName).not.toContain('bg-canvas')
    expect(terminalViewPanelClassName).not.toContain('rounded')
    expect(terminalViewPanelClassName).not.toContain('border')
    expect(terminalViewPanelClassName).not.toContain('shadow')
    expect(terminalTabsBarClassName).toContain('bg-surface')
  })
})
