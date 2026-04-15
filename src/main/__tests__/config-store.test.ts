import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('config-store', () => {
  let tmpRoot: string
  let globalStateDir: string

  beforeEach(() => {
    vi.resetModules()
    tmpRoot = mkdtempSync(join(tmpdir(), 'oneship-config-store-'))
    globalStateDir = join(tmpRoot, 'runtime-state')

    vi.doMock('electron', () => ({
      app: {
        getPath: () => join(tmpRoot, 'electron-user-data'),
      },
    }))

    vi.doMock('../runtime-paths', () => ({
      runtimePaths: () => ({
        globalState: globalStateDir,
      }),
    }))
  })

  it('loads and saves config from the runtime-scoped global state directory', async () => {
    const { getGlobalStateDir, loadConfig, saveConfig } = await import('../config-store')

    expect(getGlobalStateDir()).toBe(globalStateDir)
    expect(loadConfig()).toEqual({ projects: [] })
    expect(existsSync(join(globalStateDir, 'config.json'))).toBe(true)

    saveConfig({
      projects: [{ id: 'p1', name: 'One', path: '/tmp/project' }],
    })

    expect(JSON.parse(readFileSync(join(globalStateDir, 'config.json'), 'utf8'))).toEqual({
      projects: [{ id: 'p1', name: 'One', path: '/tmp/project' }],
    })
  })

  it('reads an existing runtime-scoped config file', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(globalStateDir, { recursive: true })
    writeFileSync(
      join(globalStateDir, 'config.json'),
      JSON.stringify({ projects: [{ id: 'p2', name: 'Existing', path: null }] }),
    )

    const { loadConfig } = await import('../config-store')
    expect(loadConfig()).toEqual({
      projects: [{ id: 'p2', name: 'Existing', path: null }],
    })
  })

  afterEach(() => {
    vi.doUnmock('electron')
    vi.doUnmock('../runtime-paths')
    rmSync(tmpRoot, { recursive: true, force: true })
  })
})
