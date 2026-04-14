# Terminal Theme System Design

Date: 2026-04-13

## Summary

Build a dedicated terminal theme system for Oneship without introducing a global application theme system.

V1 will support:

- One active terminal theme shared by all terminal sessions
- A library of built-in themes
- User-created custom themes
- Editing and saving custom terminal themes from Preferences
- Live application of theme changes to all open terminals

V1 will not support:

- Global app theme switching
- Per-project terminal themes
- Per-session terminal themes
- Transparent or wallpaper-based terminal backgrounds
- Manual editing of the theme config file
- External file watching / hot reload from disk

## Goals

- Make terminal appearance a first-class, structured feature instead of scattered hardcoded colors
- Support Ghostty-like theme customization for terminal colors, chrome, typography, and cursor behavior
- Keep the architecture stable enough to later add import/export and file-based workflows without redesigning the model
- Apply theme changes live to already-open terminals without requiring page remounts or app restart

## Non-Goals

- Designing a full global design/theme system for the whole app
- Allowing arbitrary CSS or freeform style injection
- Supporting multiple simultaneous theme scopes in V1
- Implementing user-editable config files or file watchers in V1

## Chosen Architecture

V1 uses a `C-lite` architecture:

- Terminal theme state is persisted in a fixed, versioned config file
- The main process is the only read/write authority for that file
- Renderer code never reads or writes theme files directly
- Renderer consumes theme state exclusively through IPC
- The config file schema is treated as a stable product contract, even though hand-editing is not yet exposed

This keeps V1 operationally simple like an app-owned store while preserving a clean path toward later import/export or file-first workflows.

## Source Of Truth

The source of truth is a versioned terminal theme configuration file stored in app data.

Example location on macOS:

- `~/Library/Application Support/oneship/terminal-themes.json`

Renderer state is only a projection of this file. Runtime xterm instances consume resolved theme data derived from this source of truth.

## Data Model

### Top-Level File

```json
{
  "version": 1,
  "activeThemeId": "builtin-ghostty-paper",
  "themes": []
}
```

### Theme Definition

Each theme contains:

- `id`
- `name`
- `source`: `builtin | custom`
- `locked`: boolean
- `xterm`
- `typography`
- `chrome`

### xterm Section

Controls terminal content area styling:

- `background`
- `foreground`
- `cursor`
- `cursorAccent`
- `selectionBackground`
- `selectionForeground`
- `ansi.black`
- `ansi.red`
- `ansi.green`
- `ansi.yellow`
- `ansi.blue`
- `ansi.magenta`
- `ansi.cyan`
- `ansi.white`
- `ansi.brightBlack`
- `ansi.brightRed`
- `ansi.brightGreen`
- `ansi.brightYellow`
- `ansi.brightBlue`
- `ansi.brightMagenta`
- `ansi.brightCyan`
- `ansi.brightWhite`

### Typography Section

- `fontFamily`
- `fontSize`
- `lineHeight`
- `cursorStyle`: `bar | block | underline`
- `cursorBlink`: boolean

### Chrome Section

Controls terminal-specific UI outside xterm:

- `terminalBackground`
- `tabBarBackground`
- `tabActiveBackground`
- `tabActiveForeground`
- `tabInactiveForeground`
- `borderColor`

The rest of the app remains on existing global tokens.

## Visual Baseline Constraint

Terminal themes must preserve the existing app shell hierarchy by default:

- Sidebar remains on the app's `surface` baseline
- The terminal workspace defaults to the app's `canvas` baseline
- Terminal theme chrome may style terminal-local UI, but must not flatten the sidebar/main partition by default

Put differently: terminal theme is allowed to style terminal-local chrome and xterm content, but it does not take ownership of the entire workspace background hierarchy.

## Validation Rules

V1 keeps validation intentionally strict:

- Colors must be `#RRGGBB`
- `fontSize` constrained to a safe range, e.g. `11-20`
- `lineHeight` constrained to a safe range, e.g. `1.2-1.8`
- `cursorStyle` limited to supported values
- Built-in themes cannot be deleted or overwritten
- `activeThemeId` must always point to an existing theme
- At least one built-in theme must always exist as fallback

Invalid or partially corrupted files should recover to the nearest valid state instead of allowing half-applied theme state.

## Built-In Themes

V1 should ship with a small built-in library:

- `Ghostty Paper`
- `Ghostty Ink`
- `Warm Sand`
- `Midnight Terminal`

Built-ins are locked:

- cannot be renamed
- cannot be deleted
- cannot be overwritten in place

Users customize them by duplication or `Save as new`.

## Main Process Responsibilities

Add a dedicated `terminal-theme-store` in main.

Responsibilities:

- Initialize the config file if missing
- Load and validate theme state
- Inject built-in themes
- Expose CRUD operations
- Persist changes atomically
- Guarantee fallback invariants
- Broadcast theme changes to renderer subscribers

### Main Process API Surface

- `getState()`
- `setActiveTheme(themeId)`
- `createTheme(input)`
- `updateTheme(themeId, patch)`
- `deleteTheme(themeId)`
- `duplicateTheme(themeId)`

Main should broadcast full state after every accepted change instead of diffs.

## Preload API

Expose terminal theme APIs under `window.electronAPI.terminalTheme`.

Suggested API:

- `getState()`
- `setActiveTheme(themeId)`
- `createTheme(input)`
- `updateTheme(themeId, patch)`
- `deleteTheme(themeId)`
- `duplicateTheme(themeId)`
- `onDidChange(callback)`

Renderer never reads the config file directly.

## Renderer Architecture

### Renderer Theme Store

Add a dedicated renderer store for terminal theme state.

Responsibilities:

- Hold current terminal theme state
- Initialize from `terminalTheme.getState()`
- Subscribe to `terminalTheme.onDidChange`
- Expose current theme and CRUD actions to UI

### Resolved Theme Layer

Introduce a resolver that turns stored theme definitions into runtime-ready values for:

- xterm options/theme
- terminal chrome tokens

This prevents xterm runtime code and React components from each having to understand raw persisted schema details.

## Runtime Application Model

Theme changes must apply live to all open terminal instances.

### Runtime Flow

1. Preferences changes theme state through IPC
2. Main persists and broadcasts the full terminal theme state
3. Renderer terminal theme store updates
4. Terminal runtime applies the new resolved theme to all existing terminal instances
5. React terminal chrome re-renders using the new terminal chrome tokens

### Hot Application Rules

Immediate live update:

- xterm colors
- cursor colors
- selection colors
- terminal chrome colors

Live update plus `fit()`:

- `fontFamily`
- `fontSize`
- `lineHeight`

V1 should prefer live apply rather than terminal teardown/recreation.

## Preferences UX

V1 should introduce a global Preferences area rather than attaching this feature to Project Settings.

### Navigation

- Add a global `Preferences`
- Add a `Terminal` subsection under Preferences

### Page Layout

Use a master-detail layout:

- Left: Theme Library
- Right: Theme Editor

### Theme Library

Each item shows:

- name
- source badge (`Built-in` or `Custom`)
- active indicator
- small color preview

Available actions:

- select
- set active
- duplicate
- rename custom themes
- delete custom themes
- create new theme

### Theme Editor Sections

1. `Preset`
   - name
   - source
   - active state
   - save actions
2. `Typography`
   - font family
   - font size
   - line height
   - cursor style
   - cursor blink
3. `Colors`
   - terminal colors
   - ANSI palette
   - terminal chrome colors

### Preview Model

V1 should not implement a fake preview mockup.

Instead:

- live apply changes to all open terminals
- show a clear UI note that changes preview live across open terminal sessions

This keeps the feature honest and reduces duplicate rendering systems.

## Editing State Model

Preferences should maintain three distinct values:

- `selectedThemeId`
- `draftTheme`
- `activeThemeId`

These must remain separate.

### Why

- selected theme is what the user is looking at
- draft theme is what the user is editing
- active theme is what is currently applied to all terminals

Combining them would make editing, previewing, and saving conflict with each other.

### Recommended Rules

- Selecting a theme loads a new draft
- Editing only mutates the draft
- If preview is enabled, the draft is applied live
- Saving a custom theme overwrites that custom theme
- Saving a built-in must go through `Save as new`
- Reset restores the draft from last saved state

### Dirty State

If the current draft is dirty and the user switches themes, show a lightweight confirmation:

- `Discard changes`
- `Save as new`
- `Cancel`

V1 should not maintain a draft per theme.

## V1 Editable Fields

Include:

- theme name
- xterm foreground/background/cursor/selection
- ANSI 16 colors
- font family
- font size
- line height
- cursor style
- cursor blink
- terminal chrome colors

Do not include in V1:

- transparency
- blur
- wallpapers
- terminal padding/radius/shadow controls
- scrollbar theming
- per-project overrides
- per-session overrides
- import/export
- external file watching
- manual config editing

## Testing Strategy

### 1. Shared Schema / Pure Helpers

Test:

- default file creation
- schema validation
- migration behavior
- built-in theme injection
- fallback resolution

### 2. Main Store

Test:

- missing file initialization
- invalid file recovery
- create/update/delete/duplicate behavior
- active theme reassignment after deletion
- built-in protection rules

### 3. Renderer Store / Runtime Apply

Test:

- initialization from IPC
- subscription-driven updates
- applying theme changes to open terminal instances
- font-related changes triggering `fit()`

### 4. Preferences Integration

Test:

- built-in themes open read-only or force duplication semantics
- custom themes save in place
- dirty draft confirmation flow
- delete custom theme fallback behavior

### Manual Smoke

Before considering V1 stable:

- switch built-in theme and observe all open terminals update
- adjust font size / line height / font family without clipping or broken layout
- save a new custom theme and verify it persists after restart
- delete the active custom theme and verify fallback to built-in

## Implementation Order

Recommended order:

1. Define shared schema and built-in theme set
2. Implement main `terminal-theme-store`
3. Expose preload IPC bridge
4. Add renderer terminal theme store
5. Make terminal runtime consume resolved active theme
6. Make terminal chrome consume resolved terminal chrome tokens
7. Build Preferences UI
8. Add tests and smoke validation

This order keeps UI implementation from getting ahead of the storage and runtime architecture.

## Future Evolution

V1 is intentionally designed to evolve toward stronger file-based capabilities without reworking the theme model.

### Likely Next Steps

- import/export theme files
- larger built-in theme library
- richer font controls
- optional project-level overrides
- optional session-level overrides

### Later, Not V1

- manual theme config editing
- file watching and live reload from disk
- fully file-first terminal theme management

## Decision Summary

V1 should ship as a structured, shared terminal theme system with:

- one active theme across all terminals
- built-in and custom themes
- stable versioned config file schema
- main-owned persistence
- renderer-only IPC consumption
- live theme application to all open terminal instances
- terminal-only scope, not a full app theming system
