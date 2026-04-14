# Terminal Theme System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global terminal theme system with built-in presets, custom themes, live application to open terminals, and a Preferences UI for editing and saving themes.

**Architecture:** Persist a versioned terminal theme file in main, expose it through preload IPC, mirror it in a renderer store, and resolve the active theme into xterm options plus terminal-local chrome tokens. Preferences edits operate on a draft copy, while terminal runtime applies saved active theme changes live without remounting terminals.

**Tech Stack:** Electron, React, TypeScript, xterm.js, Vitest

---

### Task 1: Add shared terminal theme schema

**Files:**
- Create: `src/shared/terminal-theme.ts`
- Create: `src/shared/__tests__/terminal-theme.test.ts`

- [ ] **Step 1: Write failing schema tests**
- [ ] **Step 2: Run focused test to verify failures**
- [ ] **Step 3: Implement terminal theme types, built-in themes, validation, and fallback helpers**
- [ ] **Step 4: Run focused test to verify passes**
- [ ] **Step 5: Commit**

### Task 2: Add main-process terminal theme store and IPC

**Files:**
- Create: `src/main/terminal-theme-store.ts`
- Create: `src/main/__tests__/terminal-theme-store.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/types/electron.d.ts`

- [ ] **Step 1: Write failing store and IPC tests for load/create/update/delete/duplicate/set-active**
- [ ] **Step 2: Run focused tests to verify failures**
- [ ] **Step 3: Implement main store, preload bridge, broadcasts, and typed IPC surface**
- [ ] **Step 4: Run focused tests to verify passes**
- [ ] **Step 5: Commit**

### Task 3: Add renderer terminal theme store and runtime live-apply

**Files:**
- Create: `src/renderer/stores/terminal-theme-store.ts`
- Create: `src/renderer/stores/__tests__/terminal-theme-store.test.ts`
- Modify: `src/renderer/components/terminal/terminal-theme.ts`
- Modify: `src/renderer/components/terminal/terminal-tabs.tsx`
- Modify: `src/renderer/components/terminal/terminal-view.tsx`
- Modify: `src/renderer/stores/terminal-view-store.ts`
- Modify: `src/renderer/app.tsx`

- [ ] **Step 1: Write failing runtime/store tests for theme initialization, subscription, and live xterm/chrome updates**
- [ ] **Step 2: Run focused tests to verify failures**
- [ ] **Step 3: Implement renderer store, resolved theme helpers, and terminal runtime application**
- [ ] **Step 4: Run focused tests to verify passes**
- [ ] **Step 5: Commit**

### Task 4: Add Preferences UI for terminal themes

**Files:**
- Create: `src/renderer/pages/preferences-page.tsx`
- Create: `src/renderer/pages/__tests__/preferences-page.test.tsx`
- Modify: `src/renderer/app.tsx`
- Modify: `src/renderer/components/layout/app-layout.tsx`

- [ ] **Step 1: Write failing UI tests for built-in theme selection, duplicate/customize flow, save, delete, and dirty-guard interactions**
- [ ] **Step 2: Run focused tests to verify failures**
- [ ] **Step 3: Implement Preferences route, theme library/editor UI, and shortcut navigation**
- [ ] **Step 4: Run focused tests to verify passes**
- [ ] **Step 5: Commit**

### Task 5: Verify end-to-end behavior

**Files:**
- Verify only

- [ ] **Step 1: Run `pnpm test`**
- [ ] **Step 2: Run `pnpm build`**
- [ ] **Step 3: Manually verify live theme switching, save-as-new, and persistence after restart**
- [ ] **Step 4: Commit any final touch-ups**
