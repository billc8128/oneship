import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Copy, Palette, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { TerminalThemeDefinition } from '../../shared/terminal-theme'
import { Button } from '../components/ui/button'
import {
  createTerminalTheme,
  deleteTerminalTheme,
  duplicateTerminalTheme,
  setActiveTerminalTheme,
  updateTerminalTheme,
  useTerminalThemeSnapshot,
} from '../stores/terminal-theme-store'

const FONT_OPTIONS = ['IBM Plex Mono', 'Menlo', 'Monaco', 'SF Mono']
const CURSOR_OPTIONS = [
  { value: 'bar', label: 'Bar' },
  { value: 'block', label: 'Block' },
  { value: 'underline', label: 'Underline' },
] as const

function toColorInputValue(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'
}

function ThemeBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-sand text-[10px] font-medium uppercase tracking-wider text-secondary">
      {label}
    </span>
  )
}

export function PreferencesPage() {
  const navigate = useNavigate()
  const { ready, state } = useTerminalThemeSnapshot()
  const [selectedThemeId, setSelectedThemeId] = useState<string>('builtin-ghostty-paper')
  const [draftTheme, setDraftTheme] = useState<TerminalThemeDefinition | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const selectedTheme = useMemo(
    () => state.themes.find((theme) => theme.id === selectedThemeId) ?? state.themes[0] ?? null,
    [selectedThemeId, state.themes],
  )

  useEffect(() => {
    if (!ready) {
      return
    }

    setSelectedThemeId((current) => {
      if (state.themes.some((theme) => theme.id === current)) {
        return current
      }
      return state.activeThemeId
    })
  }, [ready, state.activeThemeId, state.themes])

  useEffect(() => {
    if (!selectedTheme) {
      setDraftTheme(null)
      setDirty(false)
      return
    }

    setDraftTheme(selectedTheme)
    setDirty(false)
  }, [selectedTheme?.id])

  const handleSelectTheme = (themeId: string) => {
    if (themeId === selectedThemeId) {
      return
    }
    if (dirty && !window.confirm('Discard unsaved theme changes?')) {
      return
    }
    setSelectedThemeId(themeId)
  }

  const updateDraft = (updater: (current: TerminalThemeDefinition) => TerminalThemeDefinition) => {
    setDraftTheme((current) => {
      if (!current) return current
      return updater(current)
    })
    setDirty(true)
  }

  const handleSave = async () => {
    if (!draftTheme || draftTheme.locked) {
      return
    }

    setSaving(true)
    try {
      const updated = await updateTerminalTheme(draftTheme.id, {
        name: draftTheme.name,
        xterm: draftTheme.xterm,
        typography: draftTheme.typography,
        chrome: draftTheme.chrome,
      })
      if (updated) {
        setDraftTheme(updated)
        setDirty(false)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleCustomize = async () => {
    if (!selectedTheme) {
      return
    }

    const duplicated = await duplicateTerminalTheme(selectedTheme.id)
    if (duplicated) {
      setSelectedThemeId(duplicated.id)
      setDraftTheme(duplicated)
      setDirty(false)
    }
  }

  const handleSaveAsNew = async () => {
    if (!draftTheme) {
      return
    }

    setSaving(true)
    try {
      const duplicated = await createTerminalTheme({
        basedOnThemeId: selectedTheme?.id ?? state.activeThemeId,
        name: `${draftTheme.name} Copy`,
      })
      const updated = await updateTerminalTheme(duplicated.id, {
        name: `${draftTheme.name} Copy`,
        xterm: draftTheme.xterm,
        typography: draftTheme.typography,
        chrome: draftTheme.chrome,
      })
      setSelectedThemeId(duplicated.id)
      setDraftTheme(updated ?? duplicated)
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedTheme || selectedTheme.locked) {
      return
    }
    if (!window.confirm(`Delete "${selectedTheme.name}"?`)) {
      return
    }

    await deleteTerminalTheme(selectedTheme.id)
    setSelectedThemeId(state.activeThemeId)
  }

  const activeThemeId = state.activeThemeId

  return (
    <div className="p-8 h-full overflow-y-auto">
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={() => navigate(-1)}
          className="text-muted hover:text-secondary transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="font-heading text-2xl font-bold text-espresso">Preferences</h1>
          <p className="font-body text-sm text-muted mt-1">Terminal themes are shared across all terminal sessions.</p>
        </div>
      </div>

      <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-6 items-start">
        <section className="bg-surface rounded-xl shadow-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="font-heading text-sm font-semibold text-espresso">Theme Library</h2>
              <p className="font-body text-xs text-muted mt-1">Built-ins plus your saved custom themes.</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={<Palette size={14} className="text-muted" />}
              onClick={async () => {
                const created = await createTerminalTheme({ basedOnThemeId: activeThemeId, name: 'Custom Theme' })
                setSelectedThemeId(created.id)
              }}
            >
              New
            </Button>
          </div>

          <div className="p-3 space-y-2">
            {state.themes.map((theme) => {
              const isSelected = theme.id === selectedThemeId
              const isActive = theme.id === activeThemeId
              return (
                <button
                  key={theme.id}
                  onClick={() => handleSelectTheme(theme.id)}
                  className={`w-full text-left rounded-xl border px-3 py-3 transition-colors ${
                    isSelected ? 'border-secondary bg-sand/60' : 'border-border hover:bg-sand/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-body text-sm font-medium text-espresso truncate">{theme.name}</div>
                      <div className="flex items-center gap-2 mt-2">
                        <ThemeBadge label={theme.source} />
                        {isActive && <ThemeBadge label="active" />}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0 mt-0.5">
                      {[
                        theme.xterm.background,
                        theme.xterm.foreground,
                        theme.xterm.ansi.blue,
                        theme.chrome.tabActiveBackground,
                      ].map((color) => (
                        <span
                          key={color}
                          className="w-3.5 h-3.5 rounded-full border border-border"
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        <section className="bg-surface rounded-xl shadow-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-4">
            <div>
              <h2 className="font-heading text-sm font-semibold text-espresso">Theme Editor</h2>
              <p className="font-body text-xs text-muted mt-1">
                Saved changes apply to the active theme immediately. Use Set Active to switch presets.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => selectedTheme && setActiveTerminalTheme(selectedTheme.id)}
                disabled={!selectedTheme || selectedTheme.id === activeThemeId}
              >
                Set Active
              </Button>
              {selectedTheme?.locked ? (
                <Button variant="secondary" size="sm" icon={<Copy size={14} className="text-muted" />} onClick={handleCustomize}>
                  Customize
                </Button>
              ) : (
                <>
                  <Button variant="secondary" size="sm" icon={<Copy size={14} className="text-muted" />} onClick={handleSaveAsNew}>
                    Save as New
                  </Button>
                  <Button variant="primary" size="sm" onClick={handleSave} disabled={!dirty || saving}>
                    Save
                  </Button>
                  <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={handleDelete}>
                    Delete
                  </Button>
                </>
              )}
            </div>
          </div>

          {draftTheme && (
            <div className="p-5 space-y-8">
              <section>
                <div className="font-mono text-[10px] font-medium text-light tracking-wider uppercase mb-3">Preset</div>
                <div className="space-y-4">
                  <div>
                    <label className="block font-mono text-[10px] font-medium text-light tracking-wider uppercase mb-2">
                      Name
                    </label>
                    <input
                      type="text"
                      value={draftTheme.name}
                      disabled={draftTheme.locked}
                      onChange={(event) => updateDraft((current) => ({ ...current, name: event.target.value }))}
                      className="w-full bg-canvas border border-border rounded-lg px-3 py-2 text-sm font-body text-espresso focus:outline-none focus:border-secondary transition-colors disabled:opacity-60"
                    />
                  </div>
                </div>
              </section>

              <section>
                <div className="font-mono text-[10px] font-medium text-light tracking-wider uppercase mb-3">Typography</div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block font-mono text-[10px] font-medium text-light tracking-wider uppercase mb-2">Font</label>
                    <select
                      value={draftTheme.typography.fontFamily}
                      disabled={draftTheme.locked}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          typography: { ...current.typography, fontFamily: event.target.value },
                        }))}
                      className="w-full bg-canvas border border-border rounded-lg px-3 py-2 text-sm font-body text-espresso focus:outline-none focus:border-secondary transition-colors disabled:opacity-60"
                    >
                      {FONT_OPTIONS.map((font) => (
                        <option key={font} value={font}>
                          {font}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-mono text-[10px] font-medium text-light tracking-wider uppercase mb-2">Cursor</label>
                    <select
                      value={draftTheme.typography.cursorStyle}
                      disabled={draftTheme.locked}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          typography: {
                            ...current.typography,
                            cursorStyle: event.target.value as TerminalThemeDefinition['typography']['cursorStyle'],
                          },
                        }))}
                      className="w-full bg-canvas border border-border rounded-lg px-3 py-2 text-sm font-body text-espresso focus:outline-none focus:border-secondary transition-colors disabled:opacity-60"
                    >
                      {CURSOR_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center justify-between gap-3 bg-canvas border border-border rounded-lg px-3 py-2">
                    <span className="font-body text-sm text-espresso">Cursor Blink</span>
                    <input
                      type="checkbox"
                      checked={draftTheme.typography.cursorBlink}
                      disabled={draftTheme.locked}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          typography: { ...current.typography, cursorBlink: event.target.checked },
                        }))}
                    />
                  </label>
                  <div>
                    <label className="block font-mono text-[10px] font-medium text-light tracking-wider uppercase mb-2">Font Size</label>
                    <input
                      type="number"
                      min={11}
                      max={20}
                      value={draftTheme.typography.fontSize}
                      disabled={draftTheme.locked}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          typography: { ...current.typography, fontSize: Number(event.target.value) || current.typography.fontSize },
                        }))}
                      className="w-full bg-canvas border border-border rounded-lg px-3 py-2 text-sm font-body text-espresso focus:outline-none focus:border-secondary transition-colors disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block font-mono text-[10px] font-medium text-light tracking-wider uppercase mb-2">Line Height</label>
                    <input
                      type="number"
                      min={1.2}
                      max={1.8}
                      step={0.05}
                      value={draftTheme.typography.lineHeight}
                      disabled={draftTheme.locked}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          typography: { ...current.typography, lineHeight: Number(event.target.value) || current.typography.lineHeight },
                        }))}
                      className="w-full bg-canvas border border-border rounded-lg px-3 py-2 text-sm font-body text-espresso focus:outline-none focus:border-secondary transition-colors disabled:opacity-60"
                    />
                  </div>
                </div>
              </section>

              <section>
                <div className="font-mono text-[10px] font-medium text-light tracking-wider uppercase mb-3">Core Colors</div>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    ['Background', draftTheme.xterm.background, (value: string) => updateDraft((current) => ({ ...current, xterm: { ...current.xterm, background: value, cursorAccent: value } }))],
                    ['Foreground', draftTheme.xterm.foreground, (value: string) => updateDraft((current) => ({ ...current, xterm: { ...current.xterm, foreground: value } }))],
                    ['Cursor', draftTheme.xterm.cursor, (value: string) => updateDraft((current) => ({ ...current, xterm: { ...current.xterm, cursor: value } }))],
                    ['Selection', draftTheme.xterm.selectionBackground, (value: string) => updateDraft((current) => ({ ...current, xterm: { ...current.xterm, selectionBackground: value } }))],
                    ['Selection Text', draftTheme.xterm.selectionForeground, (value: string) => updateDraft((current) => ({ ...current, xterm: { ...current.xterm, selectionForeground: value } }))],
                    ['Terminal Surface', draftTheme.chrome.terminalBackground, (value: string) => updateDraft((current) => ({ ...current, chrome: { ...current.chrome, terminalBackground: value } }))],
                    ['Tab Bar', draftTheme.chrome.tabBarBackground, (value: string) => updateDraft((current) => ({ ...current, chrome: { ...current.chrome, tabBarBackground: value } }))],
                    ['Active Tab', draftTheme.chrome.tabActiveBackground, (value: string) => updateDraft((current) => ({ ...current, chrome: { ...current.chrome, tabActiveBackground: value } }))],
                    ['Active Tab Text', draftTheme.chrome.tabActiveForeground, (value: string) => updateDraft((current) => ({ ...current, chrome: { ...current.chrome, tabActiveForeground: value } }))],
                    ['Inactive Tab Text', draftTheme.chrome.tabInactiveForeground, (value: string) => updateDraft((current) => ({ ...current, chrome: { ...current.chrome, tabInactiveForeground: value } }))],
                    ['Border', draftTheme.chrome.borderColor, (value: string) => updateDraft((current) => ({ ...current, chrome: { ...current.chrome, borderColor: value } }))],
                  ].map(([label, value, onChange]) => (
                    <label key={label} className="flex items-center justify-between gap-3 bg-canvas border border-border rounded-lg px-3 py-2">
                      <span className="font-body text-sm text-espresso">{label}</span>
                      <input
                        type="color"
                        value={toColorInputValue(value as string)}
                        disabled={draftTheme.locked}
                        onChange={(event) => (onChange as (value: string) => void)(event.target.value)}
                        className="w-10 h-8 bg-transparent border-0 p-0"
                      />
                    </label>
                  ))}
                </div>
              </section>

              <section>
                <div className="font-mono text-[10px] font-medium text-light tracking-wider uppercase mb-3">ANSI Palette</div>
                <div className="grid grid-cols-4 gap-3">
                  {Object.entries(draftTheme.xterm.ansi).map(([key, value]) => (
                    <label key={key} className="flex flex-col gap-2 bg-canvas border border-border rounded-lg p-3">
                      <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-light">{key}</span>
                      <input
                        type="color"
                        value={toColorInputValue(value)}
                        disabled={draftTheme.locked}
                        onChange={(event) =>
                          updateDraft((current) => ({
                            ...current,
                            xterm: {
                              ...current.xterm,
                              ansi: {
                                ...current.xterm.ansi,
                                [key]: event.target.value,
                              },
                            },
                          }))}
                        className="w-full h-10 bg-transparent border-0 p-0"
                      />
                    </label>
                  ))}
                </div>
              </section>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
