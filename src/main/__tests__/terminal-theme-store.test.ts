import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TerminalThemeStore } from '../terminal-theme-store'

describe('TerminalThemeStore', () => {
  it('initializes a default theme file with built-ins and an active theme', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'oneship-terminal-themes-'))
    const store = new TerminalThemeStore(stateDir)

    const state = store.getState()

    expect(state.activeThemeId).toBe('builtin-ghostty-paper')
    expect(state.themes.map((theme) => theme.id)).toContain('builtin-midnight-terminal')
  })

  it('duplicates a built-in theme as a custom theme and persists it', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'oneship-terminal-themes-'))
    const store = new TerminalThemeStore(stateDir)

    const duplicated = store.duplicateTheme('builtin-ghostty-paper')

    expect(duplicated).toMatchObject({
      source: 'custom',
      locked: false,
      basedOnThemeId: 'builtin-ghostty-paper',
    })
    expect(store.getState().themes).toContainEqual(expect.objectContaining({ id: duplicated?.id }))
  })

  it('updates and deletes custom themes while keeping activeThemeId valid', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'oneship-terminal-themes-'))
    const store = new TerminalThemeStore(stateDir)
    const duplicated = store.duplicateTheme('builtin-ghostty-paper')

    expect(duplicated).not.toBeNull()

    store.updateTheme(duplicated!.id, {
      name: 'My Paper Theme',
      typography: {
        fontSize: 16,
      },
    })
    store.setActiveTheme(duplicated!.id)

    expect(store.getState().activeThemeId).toBe(duplicated!.id)
    expect(store.getState().themes).toContainEqual(
      expect.objectContaining({
        id: duplicated!.id,
        name: 'My Paper Theme',
        typography: expect.objectContaining({ fontSize: 16 }),
      }),
    )

    expect(store.deleteTheme(duplicated!.id)).toBe(true)
    expect(store.getState().activeThemeId).toBe('builtin-ghostty-paper')
  })

  it('recovers from a corrupted theme file without throwing', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'oneship-terminal-themes-'))
    writeFileSync(join(stateDir, 'terminal-themes.json'), '{"version": ')

    const store = new TerminalThemeStore(stateDir)

    expect(store.getState().activeThemeId).toBe('builtin-ghostty-paper')
  })
})
