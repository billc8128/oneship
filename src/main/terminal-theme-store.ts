import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  createDefaultTerminalThemeState,
  duplicateTerminalTheme,
  normalizeTerminalThemeState,
  type TerminalThemeDefinition,
  type TerminalThemePatch,
  type TerminalThemeState,
  updateTerminalTheme,
} from '../shared/terminal-theme'

const TERMINAL_THEME_FILE = 'terminal-themes.json'

export class TerminalThemeStore {
  private readonly stateDir: string
  private readonly filePath: string
  private state: TerminalThemeState

  constructor(stateDir: string) {
    this.stateDir = stateDir
    this.filePath = join(stateDir, TERMINAL_THEME_FILE)
    this.state = this.load()
  }

  getState(): TerminalThemeState {
    return {
      ...this.state,
      themes: this.state.themes.map((theme) => ({ ...theme })),
    }
  }

  setActiveTheme(themeId: string): TerminalThemeState {
    if (!this.state.themes.some((theme) => theme.id === themeId)) {
      return this.getState()
    }

    this.state = {
      ...this.state,
      activeThemeId: themeId,
    }
    this.save()
    return this.getState()
  }

  duplicateTheme(themeId: string): TerminalThemeDefinition | null {
    const source = this.state.themes.find((theme) => theme.id === themeId)
    if (!source) {
      return null
    }

    const duplicated = duplicateTerminalTheme(source, `custom-${randomUUID()}`)
    this.state = {
      ...this.state,
      themes: [...this.state.themes, duplicated],
    }
    this.save()
    return { ...duplicated }
  }

  createTheme(input?: { basedOnThemeId?: string; name?: string }): TerminalThemeDefinition {
    const baseTheme =
      this.state.themes.find((theme) => theme.id === input?.basedOnThemeId) ??
      this.state.themes.find((theme) => theme.id === this.state.activeThemeId) ??
      this.state.themes[0]

    const created = duplicateTerminalTheme(baseTheme, `custom-${randomUUID()}`, input?.name)
    this.state = {
      ...this.state,
      themes: [...this.state.themes, created],
    }
    this.save()
    return { ...created }
  }

  updateTheme(themeId: string, patch: TerminalThemePatch): TerminalThemeDefinition | null {
    const index = this.state.themes.findIndex((theme) => theme.id === themeId)
    if (index === -1) {
      return null
    }

    const current = this.state.themes[index]
    if (current.locked) {
      return null
    }

    const updated = updateTerminalTheme(current, patch)
    const themes = [...this.state.themes]
    themes[index] = updated
    this.state = {
      ...this.state,
      themes,
    }
    this.save()
    return { ...updated }
  }

  deleteTheme(themeId: string): boolean {
    const current = this.state.themes.find((theme) => theme.id === themeId)
    if (!current || current.locked) {
      return false
    }

    const themes = this.state.themes.filter((theme) => theme.id !== themeId)
    const fallback = themes.find((theme) => theme.locked) ?? createDefaultTerminalThemeState().themes[0]

    this.state = {
      ...this.state,
      activeThemeId: this.state.activeThemeId === themeId ? fallback.id : this.state.activeThemeId,
      themes,
    }
    this.save()
    return true
  }

  private load(): TerminalThemeState {
    try {
      this.ensureDir()
      if (!existsSync(this.filePath)) {
        const next = createDefaultTerminalThemeState()
        this.write(next)
        return next
      }

      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8'))
      const normalized = normalizeTerminalThemeState(parsed)
      this.write(normalized)
      return normalized
    } catch {
      try {
        if (existsSync(this.filePath)) {
          renameSync(this.filePath, `${this.filePath}.corrupt`)
        }
      } catch {
        // best effort only
      }
      const fallback = createDefaultTerminalThemeState()
      this.write(fallback)
      return fallback
    }
  }

  private save(): void {
    this.write(this.state)
  }

  private write(state: TerminalThemeState): void {
    this.ensureDir()
    writeFileSync(this.filePath, JSON.stringify(state, null, 2))
  }

  private ensureDir(): void {
    if (!existsSync(this.stateDir)) {
      mkdirSync(this.stateDir, { recursive: true })
    }
  }
}
