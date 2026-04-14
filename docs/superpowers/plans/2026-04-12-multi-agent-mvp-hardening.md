# Multi-Agent MVP Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize Oneship as a credible multi coding-agent management MVP by fixing onboarding/data-loss bugs, tightening local security boundaries, making hook transport reliable, and replacing fake management surfaces with session-backed state.

**Architecture:** Keep the current Electron main-process-first architecture, but extract fragile logic out of `src/main/index.ts` into small services that can be unit-tested. Treat terminals as the live execution plane, hooks as the event plane, and persisted project/session metadata as the control plane. Do not attempt true PTY reattachment in this pass; persist session history and agent metadata instead.

**Tech Stack:** Electron, React, TypeScript, node-pty, xterm.js, Vite; add Vitest for unit/integration coverage around extracted main-process services.

---

## Scope and sequencing

This work should be delivered in four phases:

1. **Stop the obvious breakage**
   Fix clone onboarding, planning-chat migration, dotfile preview, and add regression tests.
2. **Make the local runtime safe and diagnosable**
   Re-enable Electron security defaults where possible, scope filesystem IPC to trusted roots, and make hook runtime status visible.
3. **Make agent state durable**
   Persist terminal/agent metadata and activity so the app still makes sense after restart, even though live PTYs do not survive.
4. **Make the UI honest**
   Replace fake task/status surfaces with hook-backed activity and session metadata.

Out of scope for this plan:

- Full agent runtime / LLM execution
- True terminal process reattachment after app restart
- Remote sync / cloud control plane

---

## File structure

**Create**
- `vitest.config.ts` — test runner config
- `src/main/clone-flow.ts` — clone onboarding orchestration
- `src/main/path-guard.ts` — allowlist validation for file IPC
- `src/main/project-linking.ts` — path-link + conversation migration helpers
- `src/main/hook-runtime.ts` — hook port allocation, status, and health model
- `src/main/session-store.ts` — persisted agent/session metadata and activity log
- `src/main/__tests__/clone-flow.test.ts`
- `src/main/__tests__/project-linking.test.ts`
- `src/main/__tests__/path-guard.test.ts`
- `src/main/__tests__/file-read.test.ts`
- `src/main/__tests__/hook-runtime.test.ts`
- `src/main/__tests__/session-store.test.ts`

**Modify**
- `package.json`
- `src/main/index.ts`
- `src/main/project-store.ts`
- `src/main/conversation-store.ts`
- `src/main/terminal-manager.ts`
- `src/main/hook-server.ts`
- `src/main/hook-installer.ts`
- `src/preload/index.ts`
- `src/renderer/types/electron.d.ts`
- `src/renderer/components/modals/new-project-modal.tsx`
- `src/renderer/components/layout/files-panel.tsx`
- `src/renderer/components/sidebar/sidebar-projects.tsx`
- `src/renderer/pages/global-dashboard.tsx`
- `src/renderer/pages/project-dashboard.tsx`
- `src/renderer/pages/project-settings.tsx`
- `src/renderer/pages/tasks-page.tsx`
- `src/renderer/pages/terminal-page.tsx`

---

### Task 1: Add a regression harness around extracted main-process logic

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/main/__tests__/clone-flow.test.ts`
- Create: `src/main/__tests__/project-linking.test.ts`
- Create: `src/main/__tests__/path-guard.test.ts`
- Create: `src/main/__tests__/file-read.test.ts`
- Create: `src/main/__tests__/hook-runtime.test.ts`
- Create: `src/main/__tests__/session-store.test.ts`

- [ ] Add `vitest` as a dev dependency and a `test` script.
- [ ] Configure Vitest to run in a Node environment against `src/main/**/__tests__`.
- [ ] Write the first failing tests for:
  - clone destination precondition handling
  - planning project conversation migration
  - dotfile text-file detection
  - file path allowlist decisions
  - hook port allocation / status model
  - persisted session metadata reads and writes
- [ ] Run the new test suite and confirm the expected failures.
- [ ] Commit: `test: add regression harness for main-process services`

**Verification**
- `npm test`
- Expected: failing tests that match the current known bugs

---

### Task 2: Fix clone onboarding so project bootstrap and git clone stop fighting each other

**Files:**
- Create: `src/main/clone-flow.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/components/modals/new-project-modal.tsx`
- Modify: `src/main/project-store.ts`
- Test: `src/main/__tests__/clone-flow.test.ts`

- [ ] Extract clone planning into `clone-flow.ts` with helpers to:
  - validate repo URL and destination parent
  - compute repo name and final path
  - decide when `.oneship` should be created
- [ ] Change the UI flow so a cloned project is not persisted as an active linked workspace until clone success is confirmed.
- [ ] Create a temporary `"cloning"` client-side state in the modal and terminal flow instead of eagerly initializing `.oneship` in the target directory.
- [ ] Add a post-clone completion path in main process that links the finished repo directory and only then writes `.oneship/project.json`.
- [ ] Add failure handling for clone errors so the user sees an actionable error and no broken project entry is left behind.
- [ ] Run clone-flow tests and make them pass.
- [ ] Commit: `fix: repair clone onboarding flow`

**Verification**
- `npm test -- clone-flow`
- Manual smoke: start clone from UI, confirm clone succeeds into empty target directory and new project opens with linked path

---

### Task 3: Preserve planning conversations and notes when a project becomes linked to a folder

**Files:**
- Create: `src/main/project-linking.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/conversation-store.ts`
- Modify: `src/main/project-store.ts`
- Test: `src/main/__tests__/project-linking.test.ts`

- [ ] Extract “link project to path” behavior out of `index.ts`.
- [ ] Add migration logic that moves or copies the conversation file from global storage to project-local `.oneship/conversations` when a planning project gets its first path.
- [ ] Preserve notes, repositories, createdAt, and status during the same transition.
- [ ] Make the migration idempotent so repeated path updates do not duplicate or erase data.
- [ ] Add tests covering:
  - planning project with existing messages
  - linked project with no existing `.oneship`
  - re-linking to the same path
- [ ] Run tests and make them pass.
- [ ] Commit: `fix: preserve planning project data when linking workspace`

**Verification**
- `npm test -- project-linking`
- Manual smoke: create planning project, send messages, attach folder, confirm the same conversation remains visible

---

### Task 4: Tighten Electron and filesystem trust boundaries

**Files:**
- Create: `src/main/path-guard.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/types/electron.d.ts`
- Test: `src/main/__tests__/path-guard.test.ts`
- Test: `src/main/__tests__/file-read.test.ts`

- [ ] Re-enable `webSecurity` in BrowserWindow unless a concrete local-only exception is still required.
- [ ] Introduce a project-root allowlist helper that only permits `readDir`, `readFile`, and `writeFile` within:
  - linked project directories
  - the app’s own `.oneship` state directories where needed
- [ ] Validate every filesystem IPC call through the allowlist helper and return structured permission errors to the renderer.
- [ ] Normalize file-type detection in one shared helper so dotfiles like `.env` and `.gitignore` are treated consistently by both renderer and main process.
- [ ] Update the file panel to surface permission and unsupported-file states explicitly instead of failing silently.
- [ ] Run tests and make them pass.
- [ ] Commit: `fix: harden renderer file access boundaries`

**Verification**
- `npm test -- path-guard`
- Manual smoke:
  - project files still preview normally
  - dotfiles render as text
  - paths outside linked workspaces are rejected with a visible error

---

### Task 5: Make hook transport reliable and observable

**Files:**
- Create: `src/main/hook-runtime.ts`
- Modify: `src/main/hook-server.ts`
- Modify: `src/main/hook-installer.ts`
- Modify: `src/main/terminal-manager.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/types/electron.d.ts`
- Modify: `src/renderer/pages/global-dashboard.tsx`
- Modify: `src/renderer/pages/project-settings.tsx`
- Test: `src/main/__tests__/hook-runtime.test.ts`

- [ ] Move hook port selection into `hook-runtime.ts` and allocate an available localhost port at startup instead of assuming `19876`.
- [ ] Thread the resolved port into terminal session environment variables so hook bridge traffic follows the actual server port.
- [ ] Persist hook runtime status in memory with fields for:
  - running / failed
  - port
  - last error
  - last event timestamp
- [ ] Add a preload API to read hook runtime status from renderer.
- [ ] Show hook status in UI:
  - global dashboard card for overall health
  - project settings section for hook installation status and last error
- [ ] Stop silently swallowing startup failure; surface a user-visible warning when the hook server cannot bind or hooks cannot be installed.
- [ ] Add tests for port allocation and failure reporting.
- [ ] Commit: `feat: add hook runtime health and diagnostics`

**Verification**
- `npm test -- hook-runtime`
- Manual smoke:
  - app shows active hook port
  - forced port failure produces a visible error state
  - session status dots still update from real hook events

---

### Task 6: Persist terminal and agent metadata so the control plane survives app restarts

**Files:**
- Create: `src/main/session-store.ts`
- Modify: `src/main/terminal-manager.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/types/electron.d.ts`
- Modify: `src/renderer/components/sidebar/sidebar-projects.tsx`
- Modify: `src/renderer/pages/terminal-page.tsx`
- Modify: `src/renderer/pages/project-dashboard.tsx`
- Test: `src/main/__tests__/session-store.test.ts`

- [ ] Define a persisted session record containing:
  - session id
  - project id
  - cwd
  - shell
  - user label
  - createdAt / updatedAt
  - last hook status
  - last event summary
  - lifecycle state (`live`, `ended`, `crashed`, `stale`)
- [ ] Update terminal creation and exit paths to write session records.
- [ ] Persist tab renames from renderer instead of keeping them only in component state.
- [ ] On app startup, load ended/stale session history so the sidebar and dashboards retain context.
- [ ] Make it explicit in UI that historical sessions are not attachable live after restart; do not fake reattachment.
- [ ] Run tests and make them pass.
- [ ] Commit: `feat: persist agent session metadata and history`

**Verification**
- `npm test -- session-store`
- Manual smoke:
  - rename a terminal, restart app, confirm the label persists
  - ended sessions show as historical instead of disappearing

---

### Task 7: Replace fake management surfaces with session-backed activity

**Files:**
- Modify: `src/renderer/pages/tasks-page.tsx`
- Modify: `src/renderer/pages/project-dashboard.tsx`
- Modify: `src/renderer/components/sidebar/sidebar-projects.tsx`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/types/electron.d.ts`

- [ ] Remove hard-coded task rows from `TasksPage`.
- [ ] Introduce a lightweight “activity feed” model derived from persisted session records and recent hook events.
- [ ] Show per-project cards for:
  - active agents
  - waiting-for-permission agents
  - recently completed sessions
  - last activity timestamp
- [ ] Make dashboard language honest: call these “agents” only when a session has emitted hook traffic; otherwise show them as plain terminals.
- [ ] Keep the UI minimal: no fake assignment/orchestration controls until a real runtime exists.
- [ ] Manual smoke-test the new dashboards against 2-3 simultaneous sessions.
- [ ] Commit: `feat: replace mock task surfaces with session-backed activity`

**Verification**
- Manual smoke:
  - open multiple sessions in one project and across two projects
  - verify activity updates, waiting state, and completion state appear without placeholder data

---

### Task 8: Final hardening pass

**Files:**
- Modify: affected files from Tasks 1-7

- [ ] Run full test suite.
- [ ] Run production build.
- [ ] Run manual smoke checklist:
  - create planning project
  - chat in planning project
  - link folder and confirm chat survives
  - open folder as project
  - clone repo as project
  - launch 2+ agent terminals
  - verify hook status dots update
  - verify dashboard/system status surfaces real data
  - restart app and confirm session metadata persists
- [ ] Update any copy that still overpromises full agent orchestration.
- [ ] Commit: `chore: harden multi-agent MVP flows`

**Verification**
- `npm test`
- `npm run build`
- Expected: all tests pass and production build succeeds

---

## Delivery guidance

Ship this in two mergeable milestones:

1. **Stability milestone**
   Tasks 1-5. This removes broken flows and silent failure modes.
2. **Control-plane milestone**
   Tasks 6-8. This makes the MVP feel like a management tool instead of a terminal launcher.

If time is constrained, do not start on richer orchestration UI before Tasks 2-5 are complete.
