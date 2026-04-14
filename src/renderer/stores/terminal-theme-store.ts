import { useEffect, useSyncExternalStore } from 'react'
import type {
  TerminalThemeDefinition,
  TerminalThemePatch,
  TerminalThemeState,
} from '../../shared/terminal-theme'
import { createDefaultTerminalThemeState } from '../../shared/terminal-theme'
import {
  defaultResolvedTerminalTheme,
  resolveTerminalTheme,
  type ResolvedTerminalTheme,
} from '../components/terminal/terminal-theme'
import { applyResolvedTerminalThemeToAllViews } from './terminal-view-store'

interface TerminalThemeSnapshot {
  ready: boolean
  state: TerminalThemeState
  activeTheme: TerminalThemeDefinition
  resolvedActiveTheme: ResolvedTerminalTheme
}

const fallbackState = createDefaultTerminalThemeState()
const fallbackActiveTheme = fallbackState.themes.find((theme) => theme.id === fallbackState.activeThemeId) ?? fallbackState.themes[0]!

let snapshot: TerminalThemeSnapshot = {
  ready: false,
  state: fallbackState,
  activeTheme: fallbackActiveTheme,
  resolvedActiveTheme: defaultResolvedTerminalTheme,
}

let initializedPromise: Promise<void> | null = null
let unsubscribeIpc: (() => void) | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function applyState(state: TerminalThemeState): void {
  const activeTheme = state.themes.find((theme) => theme.id === state.activeThemeId) ?? state.themes[0] ?? fallbackActiveTheme
  const resolvedActiveTheme = resolveTerminalTheme(activeTheme)

  snapshot = {
    ready: true,
    state,
    activeTheme,
    resolvedActiveTheme,
  }

  applyResolvedTerminalThemeToAllViews(resolvedActiveTheme)
  emit()
}

export async function ensureTerminalThemeStoreInitialized(): Promise<void> {
  if (initializedPromise) {
    return initializedPromise
  }

  initializedPromise = window.electronAPI.terminalTheme.getState().then((state) => {
    applyState(state)
    if (!unsubscribeIpc) {
      unsubscribeIpc = window.electronAPI.terminalTheme.onDidChange((nextState) => {
        applyState(nextState)
      })
    }
  })

  return initializedPromise
}

export function getTerminalThemeSnapshot(): TerminalThemeSnapshot {
  return snapshot
}

export function subscribeTerminalThemeStore(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useTerminalThemeSnapshot(): TerminalThemeSnapshot {
  useEffect(() => {
    void ensureTerminalThemeStoreInitialized()
  }, [])

  return useSyncExternalStore(subscribeTerminalThemeStore, getTerminalThemeSnapshot, getTerminalThemeSnapshot)
}

export async function setActiveTerminalTheme(themeId: string): Promise<void> {
  await window.electronAPI.terminalTheme.setActiveTheme(themeId)
}

export async function createTerminalTheme(input?: { basedOnThemeId?: string; name?: string }): Promise<TerminalThemeDefinition> {
  return window.electronAPI.terminalTheme.createTheme(input)
}

export async function updateTerminalTheme(themeId: string, patch: TerminalThemePatch): Promise<TerminalThemeDefinition | null> {
  return window.electronAPI.terminalTheme.updateTheme(themeId, patch)
}

export async function deleteTerminalTheme(themeId: string): Promise<boolean> {
  return window.electronAPI.terminalTheme.deleteTheme(themeId)
}

export async function duplicateTerminalTheme(themeId: string): Promise<TerminalThemeDefinition | null> {
  return window.electronAPI.terminalTheme.duplicateTheme(themeId)
}

export function resetTerminalThemeStoreForTests(): void {
  unsubscribeIpc?.()
  unsubscribeIpc = null
  initializedPromise = null
  snapshot = {
    ready: false,
    state: fallbackState,
    activeTheme: fallbackActiveTheme,
    resolvedActiveTheme: defaultResolvedTerminalTheme,
  }
  listeners.clear()
}
