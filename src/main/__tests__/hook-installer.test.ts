import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('installHooks', () => {
  let homeDir: string

  beforeEach(() => {
    vi.resetModules()
    homeDir = mkdtempSync(join(tmpdir(), 'oneship-hook-installer-'))
  })

  it('installs the current Claude hook events needed for status tracking', async () => {
    vi.doMock('os', async () => {
      const actual = await vi.importActual<typeof import('node:os')>('node:os')
      return {
        ...actual,
        homedir: () => homeDir,
      }
    })

    try {
      const { installHooks } = await import('../hook-installer')
      expect(installHooks()).toEqual({ installed: true })

      const settings = JSON.parse(readFileSync(join(homeDir, '.claude', 'settings.json'), 'utf-8')) as {
        hooks: Record<string, unknown[]>
      }

      expect(Object.keys(settings.hooks)).toEqual(expect.arrayContaining([
        'SessionStart',
        'UserPromptSubmit',
        'PreToolUse',
        'PermissionRequest',
        'PermissionDenied',
        'PostToolUse',
        'PostToolUseFailure',
        'Notification',
        'Elicitation',
        'ElicitationResult',
        'Stop',
        'StopFailure',
        'SessionEnd',
      ]))
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
    }
  })

  it('installs only the Codex hook events supported by the current docs', async () => {
    vi.doMock('os', async () => {
      const actual = await vi.importActual<typeof import('node:os')>('node:os')
      return {
        ...actual,
        homedir: () => homeDir,
      }
    })

    try {
      const codexDir = join(homeDir, '.codex')
      mkdirSync(codexDir, { recursive: true })
      writeFileSync(join(codexDir, 'hooks.json'), JSON.stringify({
        hooks: {
          Notification: [
            {
              matcher: '*',
              hooks: [{ type: 'command', command: 'node "/tmp/oneship-bridge.js" --source=codex' }],
            },
          ],
          PermissionRequest: [
            {
              matcher: '*',
              hooks: [{ type: 'command', command: 'node "/tmp/oneship-bridge.js" --source=codex', timeout: 86400 }],
            },
          ],
        },
      }), 'utf-8')

      const { installHooks } = await import('../hook-installer')
      expect(installHooks()).toEqual({ installed: true })

      const config = JSON.parse(readFileSync(join(homeDir, '.codex', 'hooks.json'), 'utf-8')) as {
        hooks: Record<string, Array<Record<string, unknown>>>
      }

      expect(Object.keys(config.hooks).sort()).toEqual([
        'PostToolUse',
        'PreToolUse',
        'SessionStart',
        'Stop',
        'UserPromptSubmit',
      ])

      expect(config.hooks.SessionStart[0]).toMatchObject({
        matcher: 'startup|resume',
      })
      expect(config.hooks.PreToolUse[0]).toMatchObject({
        matcher: 'Bash',
      })
      expect(config.hooks.PostToolUse[0]).toMatchObject({
        matcher: 'Bash',
      })
      expect(config.hooks.UserPromptSubmit[0]).not.toHaveProperty('matcher')
      expect(config.hooks.Stop[0]).not.toHaveProperty('matcher')
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
    }
  })
})
