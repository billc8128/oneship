import { describe, expect, it } from 'vitest'
import {
  deriveRuntimePaths,
  deriveRuntimeProfile,
  shouldAutoInstallHooks,
} from '../runtime-paths'

describe('runtime-paths', () => {
  it('derives prod for packaged apps and dev for unpackaged apps', () => {
    expect(deriveRuntimeProfile({ isPackaged: true, env: {} })).toBe('prod')
    expect(deriveRuntimeProfile({ isPackaged: false, env: {} })).toBe('dev')
  })

  it('allows ONESHIP_PROFILE to override packaged detection for test harnesses', () => {
    expect(
      deriveRuntimeProfile({ isPackaged: true, env: { ONESHIP_PROFILE: 'dev' } }),
    ).toBe('dev')
  })

  it('keeps prod paths on the current layout and isolates dev paths', () => {
    expect(
      deriveRuntimePaths({
        profile: 'prod',
        appDataDir: '/Users/a/Library/Application Support',
        currentUserDataDir: '/Users/a/Library/Application Support/oneship',
        homeDir: '/Users/a',
      }),
    ).toMatchObject({
      userData: '/Users/a/Library/Application Support/oneship',
      globalState: '/Users/a/Library/Application Support/ge',
      agentRoot: '/Users/a/.oneship',
    })

    expect(
      deriveRuntimePaths({
        profile: 'dev',
        appDataDir: '/Users/a/Library/Application Support',
        currentUserDataDir: '/Users/a/Library/Application Support/oneship',
        homeDir: '/Users/a',
      }),
    ).toMatchObject({
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
