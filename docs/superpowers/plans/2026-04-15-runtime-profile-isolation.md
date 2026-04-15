# Runtime Profile Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isolate `prod` and `dev` runtime state so packaged Oneship apps and `pnpm dev` never share Electron `userData`, global app state, Chief Agent session storage, or hook installation side effects.

**Architecture:** Introduce a single runtime-paths layer that derives two profiles only: `prod` for all packaged apps and `dev` for `pnpm dev`. Keep `prod` on its current disk layout to avoid migrating existing user data; move `dev` onto new profile-specific directories. First remove all import-time `userData` reads from the main-process path helpers, then install the dev `userData` override as the first executable statement in `src/main/index.ts` before any runtime state stores are constructed. Thread the derived paths through all stateful codepaths and gate hook installation so `dev` is opt-in.

**Tech Stack:** Electron 41, electron-vite 5, Node filesystem/path utilities, Vitest

---

## File Map

**Create**
- `src/main/runtime-paths.ts`
  Purpose: single source of truth for runtime profile detection, path derivation, and hook-install policy.
- `src/main/__tests__/runtime-paths.test.ts`
  Purpose: pure tests for profile detection, path derivation, and hook-install gating.
- `src/main/__tests__/config-store.test.ts`
  Purpose: verify config-store reads/writes the profile-scoped global state directory.
- `src/main/__tests__/conversation-store.test.ts`
  Purpose: verify chief conversation persistence uses profile-scoped global state and leaves project-local `.oneship` storage unchanged.

**Modify**
- `src/main/index.ts`
  Purpose: install the dev `userData` override before constructing runtime state stores, consume runtime paths, and skip hook installation in `dev` unless explicitly opted in.
- `src/main/config-store.ts`
  Purpose: replace top-level path constants with runtime getters backed by `runtime-paths`.
- `src/main/conversation-store.ts`
  Purpose: replace top-level chief conversation path constants with runtime getters backed by `runtime-paths`.
- `src/main/hook-installer.ts`
  Purpose: install the bridge script into the profile-scoped agent root instead of hardcoding `~/.oneship/bin`.
- `src/main/agent-host.ts`
  Purpose: pass the resolved agent root to the utility worker through `utilityProcess.fork(..., { env })`.
- `src/main/__tests__/hook-installer.test.ts`
  Purpose: verify the bridge script lands in the injected profile-scoped directory.
- `src/main/__tests__/agent-host.test.ts`
  Purpose: verify the helper that builds worker env injects `ONESHIP_AGENT_ROOT` without mutating unrelated env.
- `src/agent/session/store.ts`
  Purpose: prefer `process.env.ONESHIP_AGENT_ROOT` over the legacy `~/.oneship` fallback.
- `src/agent/session/__tests__/session.test.ts`
- `src/agent/session/__tests__/session-manager.test.ts`
- `src/agent/session/__tests__/resume.test.ts`
  Purpose: verify all agent session disk paths honor the injected root.

**No-change / out of scope**
- `package.json`
  Script naming stays as-is (`app:make`). This plan only addresses runtime state isolation.
- `electron.vite.config.ts`, `release*`, `build/*`, and data migration scripts
  Do not add migration logic in this pass; `prod` keeps its current paths.

## Agreed Constraints

- Only two profiles exist in this implementation: `prod` and `dev`.
- Any packaged app (`app.isPackaged === true`) is `prod`.
- Only `pnpm dev` (`app.isPackaged === false`) is `dev`.
- `prod` must keep its current disk layout unchanged:
  - Electron userData: use the current default resolved by Electron at runtime.
  - main-process global state: keep the current sibling `../ge` layout.
  - Chief Agent root: keep `~/.oneship`.
- `dev` gets new isolated roots:
  - Electron userData: `~/Library/Application Support/oneship-dev`
  - main-process global state: `~/Library/Application Support/oneship-dev/state`
  - Chief Agent root: `~/.oneship-dev`
- `dev` must not auto-install Claude/Codex hooks unless `ONESHIP_INSTALL_HOOKS=1` is set.
- Claude Code and Codex hook config files remain global singleton files (`~/.claude/settings.json` and `~/.codex/hooks.json`), so only one Oneship profile may own hook installation at a time.
- This pass does not introduce a third packaged-dev profile.

## Task 1: Add Runtime Profile + Path Derivation

**Files:**
- Create: `src/main/runtime-paths.ts`
- Test: `src/main/__tests__/runtime-paths.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  deriveRuntimeProfile,
  deriveRuntimePaths,
  shouldAutoInstallHooks,
} from '../runtime-paths'

describe('runtime-paths', () => {
  it('derives prod for packaged apps and dev for unpackaged apps', () => {
    expect(deriveRuntimeProfile({ isPackaged: true, env: {} })).toBe('prod')
    expect(deriveRuntimeProfile({ isPackaged: false, env: {} })).toBe('dev')
  })

  it('allows ONESHIP_PROFILE to override packaged detection for test harnesses', () => {
    expect(deriveRuntimeProfile({ isPackaged: true, env: { ONESHIP_PROFILE: 'dev' } })).toBe('dev')
  })

  it('keeps prod paths on the current layout and isolates dev paths', () => {
    expect(deriveRuntimePaths({
      profile: 'prod',
      appDataDir: '/Users/a/Library/Application Support',
      currentUserDataDir: '/Users/a/Library/Application Support/oneship',
      homeDir: '/Users/a',
    })).toMatchObject({
      userData: '/Users/a/Library/Application Support/oneship',
      globalState: '/Users/a/Library/Application Support/ge',
      agentRoot: '/Users/a/.oneship',
    })

    expect(deriveRuntimePaths({
      profile: 'dev',
      appDataDir: '/Users/a/Library/Application Support',
      currentUserDataDir: '/Users/a/Library/Application Support/oneship',
      homeDir: '/Users/a',
    })).toMatchObject({
      userData: '/Users/a/Library/Application Support/oneship-dev',
      globalState: '/Users/a/Library/Application Support/oneship-dev/state',
      agentRoot: '/Users/a/.oneship-dev',
    })
  })

  it('auto-installs hooks only for prod unless ONESHIP_INSTALL_HOOKS=1 is set', () => {
    expect(shouldAutoInstallHooks('prod', {})).toBe(true)
    expect(shouldAutoInstallHooks('dev', {})).toBe(false)
    expect(shouldAutoInstallHooks('dev', { ONESHIP_INSTALL_HOOKS: '1' })).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/main/__tests__/runtime-paths.test.ts`
Expected: FAIL because `runtime-paths.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Implement in `src/main/runtime-paths.ts`:
- `export type RuntimeProfile = 'prod' | 'dev'`
- `deriveRuntimeProfile({ isPackaged, env })`
- `deriveRuntimePaths({ profile, appDataDir, currentUserDataDir, homeDir })`
- `shouldAutoInstallHooks(profile, env)`
- thin wrappers:
  - `runtimeProfile()`
  - `runtimePaths()`
  - `installRuntimeUserDataPath()` that only calls `app.setPath('userData', ...)` for `dev`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/main/__tests__/runtime-paths.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/runtime-paths.ts src/main/__tests__/runtime-paths.test.ts
git commit -m "refactor: add runtime profile path derivation"
```

## Task 2: Remove Import-Time Main-Process Path Reads

**Files:**
- Modify: `src/main/config-store.ts`
- Modify: `src/main/conversation-store.ts`
- Modify: `src/main/index.ts`
- Test: `src/main/__tests__/config-store.test.ts`
- Test: `src/main/__tests__/conversation-store.test.ts`

- [ ] **Step 1: Inventory the path call sites that must become lazy**

Run:

```bash
rg -n "getGlobalStateDir\\(|app\\.getPath\\('userData'\\)|'\\.\\.', 'ge'|\\.oneship" src/main src/agent
```

Record every module-scope path read. Before moving to Step 2, confirm the only main-process import-time `userData` readers are `config-store.ts` and `conversation-store.ts`.

- [ ] **Step 2: Write the failing tests**

`config-store.test.ts`
- mock `../runtime-paths` to return a temp `globalState`
- assert `loadConfig()` creates and reads `<temp>/config.json`
- assert `getGlobalStateDir()` returns the mocked runtime path

`conversation-store.test.ts`
- mock `../runtime-paths` to return a temp `globalState`
- assert chief conversations persist under `<temp>/conversations`
- assert project conversations still persist under `<project>/.oneship/conversations`

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- src/main/__tests__/config-store.test.ts src/main/__tests__/conversation-store.test.ts`
Expected: FAIL because the stores still use hardcoded top-level constants.

- [ ] **Step 4: Write minimal implementation**

Change `config-store.ts`:
- replace `const CONFIG_DIR = ...` and `const CONFIG_FILE = ...` with getters that call `runtimePaths().globalState`
- keep `getGlobalStateDir()` as the single migration seam for downstream stores like `SessionStore` and `TerminalThemeStore`

Change `conversation-store.ts`:
- replace `join(app.getPath('userData'), '..', 'ge', ...)` with `join(runtimePaths().globalState, ...)`
- keep project-local `.oneship/conversations` behavior unchanged

Change `index.ts`:
- keep constructing `SessionStore` and `TerminalThemeStore` from `getGlobalStateDir()`
- do not introduce direct `runtimePaths().globalState` usage there; the change should propagate through `getGlobalStateDir()`

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/main/__tests__/config-store.test.ts src/main/__tests__/conversation-store.test.ts src/main/__tests__/runtime-paths.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/config-store.ts src/main/conversation-store.ts src/main/index.ts src/main/__tests__/config-store.test.ts src/main/__tests__/conversation-store.test.ts
git commit -m "refactor: route main-process state through runtime paths"
```

## Task 3: Install the Dev userData Override Before Store Construction

**Files:**
- Modify: `src/main/index.ts`
- Reuse test: `src/main/__tests__/runtime-paths.test.ts`

- [ ] **Step 1: Verify the precondition from Task 2**

Re-run:

```bash
rg -n "app\\.getPath\\('userData'\\)" src/main
```

Expected: only the runtime-path wrappers remain. No other imported main-process module should read `userData` at module scope.

- [ ] **Step 2: Write minimal implementation**

In `src/main/index.ts`:
- import `installRuntimeUserDataPath` from `./runtime-paths`
- call it as the first executable statement after the import block
- leave the rest of the main entry shape intact
- ensure `sessionStore` / `terminalThemeStore` construction stays below that call

- [ ] **Step 3: Run targeted verification**

Run: `npm test -- src/main/__tests__/runtime-paths.test.ts src/main/__tests__/config-store.test.ts src/main/__tests__/conversation-store.test.ts`
Expected: PASS

Manual smoke check:
- Run `pnpm dev`
- confirm the dev app creates `~/Library/Application Support/oneship-dev`
- confirm it creates `~/Library/Application Support/oneship-dev/state`
- confirm it does **not** create or touch prod-only Electron cache under the current `prod` userData path

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "refactor: install dev userData override before store init"
```

## Task 4: Isolate Chief Agent Worker Session Storage

**Files:**
- Modify: `src/main/agent-host.ts`
- Modify: `src/agent/session/store.ts`
- Modify: `src/main/__tests__/agent-host.test.ts`
- Modify: `src/agent/session/__tests__/session.test.ts`
- Modify: `src/agent/session/__tests__/session-manager.test.ts`
- Modify: `src/agent/session/__tests__/resume.test.ts`

- [ ] **Step 1: Write the failing tests**

In `agent-host.test.ts`, add a pure helper test:

```ts
import { buildWorkerEnv } from '../agent-host'

it('injects ONESHIP_AGENT_ROOT into the worker env', () => {
  expect(buildWorkerEnv({ PATH: '/bin' }, '/tmp/oneship-dev')).toMatchObject({
    PATH: '/bin',
    ONESHIP_AGENT_ROOT: '/tmp/oneship-dev',
  })
})
```

In the agent session tests:
- keep the existing `HOME` redirection in place
- also set `process.env.ONESHIP_AGENT_ROOT = <tmp>/.oneship-dev`
- assert `sessionDir(...)`, resume enumeration, and manager disk reads all live under the injected root instead of `HOME/.oneship`
- add one test proving `ONESHIP_AGENT_ROOT` wins over `HOME/.oneship`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/main/__tests__/agent-host.test.ts src/agent/session/__tests__/session.test.ts src/agent/session/__tests__/session-manager.test.ts src/agent/session/__tests__/resume.test.ts`
Expected: FAIL because no env override exists yet.

- [ ] **Step 3: Write minimal implementation**

In `agent-host.ts`:
- add `buildWorkerEnv(baseEnv, agentRoot)`
- call `utilityProcess.fork(path, [], { ..., env: buildWorkerEnv(process.env, runtimePaths().agentRoot) })`

In `src/agent/session/store.ts`:
- add `agentRoot(env = process.env, homeDir = homedir())`
- prefer `env.ONESHIP_AGENT_ROOT` when present
- fall back to `join(homeDir, '.oneship')` when it is not
- derive `sessionsRoot()` from that helper

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/main/__tests__/agent-host.test.ts src/agent/session/__tests__/session.test.ts src/agent/session/__tests__/session-manager.test.ts src/agent/session/__tests__/resume.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-host.ts src/agent/session/store.ts src/main/__tests__/agent-host.test.ts src/agent/session/__tests__/session.test.ts src/agent/session/__tests__/session-manager.test.ts src/agent/session/__tests__/resume.test.ts
git commit -m "refactor: isolate chief agent session storage by profile"
```

## Task 5: Gate Hook Installation and Move Bridge Script Under the Profile Root

**Files:**
- Modify: `src/main/hook-installer.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/__tests__/hook-installer.test.ts`
- Reuse test: `src/main/__tests__/runtime-paths.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `hook-installer.test.ts`:
- `installHooks({ bridgeDir: <tmp>/.oneship-dev/bin })` writes `oneship-bridge.js` into the provided directory
- existing Claude/Codex config that already points at a different Oneship bridge path is rejected instead of overwritten

Add to `runtime-paths.test.ts`:
- `shouldAutoInstallHooks('dev', {}) === false`
- `shouldAutoInstallHooks('dev', { ONESHIP_INSTALL_HOOKS: '1' }) === true`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/main/__tests__/hook-installer.test.ts src/main/__tests__/runtime-paths.test.ts`
Expected: FAIL because `installHooks` has no injectable bridge dir and main still always installs hooks.

- [ ] **Step 3: Write minimal implementation**

In `hook-installer.ts`:
- change `installHooks()` to accept `{ bridgeDir?: string }`
- default to `runtimePaths().hookBridgeDir`
- stop hardcoding `homedir()/.oneship/bin`
- detect an existing Oneship hook command that points at a different bridge path and return `{ installed: false, error }` instead of overwriting it silently
- document in comments/tests that Claude/Codex hook config is singleton state, so `prod` and `dev` hooks are mutually exclusive

In `index.ts`:
- derive `const paths = runtimePaths()`
- call `installHooks({ bridgeDir: paths.hookBridgeDir })` only when `shouldAutoInstallHooks(paths.profile, process.env)` is true
- when skipped in `dev`, leave `hookRuntimeStatus.installed = false` and do not mutate external CLI config files
- if `dev` is explicitly opted into hooks and the installer refuses because another Oneship bridge already owns the global CLI config, surface that error instead of forcing overwrite

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/main/__tests__/hook-installer.test.ts src/main/__tests__/runtime-paths.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/hook-installer.ts src/main/index.ts src/main/__tests__/hook-installer.test.ts src/main/__tests__/runtime-paths.test.ts
git commit -m "refactor: disable automatic hook installs in dev"
```

## Task 6: Full Verification and Concurrent Runtime Smoke Test

**Files:**
- No new code expected unless a verification failure reveals a missed path.

- [ ] **Step 1: Run the full automated test suite**

Run: `npm test`
Expected: PASS with all test files green.

- [ ] **Step 2: Verify dev path creation**

Run: `pnpm dev`

Verify on disk:
- `~/Library/Application Support/oneship-dev`
- `~/Library/Application Support/oneship-dev/state`
- `~/.oneship-dev`

Verify **not** touched:
- existing prod config under `~/Library/Application Support/ge`
- existing prod agent root under `~/.oneship`

- [ ] **Step 3: Verify prod path compatibility**

Run: `pnpm app:make`

Install or run the packaged app and verify it still reads:
- Electron userData from the existing prod location
- global state from the existing `.../ge`
- agent state from `~/.oneship`
- at least one known existing project still appears in the project list
- the known Chief Agent session/thread you already have still appears
- the current terminal theme / terminal theme state is preserved

- [ ] **Step 4: Verify concurrent isolation**

With packaged `prod` running and `pnpm dev` running at the same time:
- create or inspect a terminal session in `prod`
- confirm starting `dev` does not mark the prod session interrupted
- confirm `dev` terminal/theme/config state is independent
- confirm `dev` does not rewrite Claude/Codex hook config unless `ONESHIP_INSTALL_HOOKS=1` was set
- if `ONESHIP_INSTALL_HOOKS=1` is set for `dev` while prod hooks already own the global CLI config, confirm the installer refuses with a clear error instead of overwriting prod’s bridge path

- [ ] **Step 5: Commit only if verification required a follow-up fix**

If no extra fixes were needed, do **not** create a verification-only commit.
If a follow-up fix was needed, commit with a narrow message describing the missed path.

## Manual Review Checklist for Claude

Before implementation starts, ask Claude Code to challenge these assumptions specifically:
- Is preserving prod’s current `globalState = ../ge` layout acceptable for this pass, or should the plan include a migration?
- Is `utilityProcess.fork(..., { env })` supported in this Electron version and build path?
- Are there any additional runtime write targets under `src/main` or `src/agent` not listed in the file map?
- Is gating hook installation at the `index.ts` call site sufficient, or should `hook-installer.ts` also reject unsafe default usage when another Oneship bridge already owns the global CLI config?
- Does any existing test rely on `HOME`-based `~/.oneship` semantics that should be updated to prefer `ONESHIP_AGENT_ROOT`?

## Execution Notes

- Do not rewrite existing prod data directories in this plan.
- Do not add a third `packaged-dev` profile in this plan.
- Do not fold unrelated build-script naming or packaging refactors into this work.
- Do not add backup/restore logic for `~/.claude/settings.json` or `~/.codex/hooks.json` in this pass; treat hook ownership as a singleton limitation and fail safely on conflicting bridge ownership.
