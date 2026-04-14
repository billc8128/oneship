import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { linkProjectWorkspace } from '../project-linking'

const fsActual = vi.hoisted(() => ({
  renameSync: undefined as typeof import('node:fs').renameSync | undefined,
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  fsActual.renameSync = actual.renameSync
  return {
    ...actual,
    renameSync: vi.fn(actual.renameSync),
  }
})

afterEach(() => {
  vi.mocked(renameSync).mockReset()
  if (fsActual.renameSync) {
    vi.mocked(renameSync).mockImplementation(fsActual.renameSync)
  }
})

describe('linkProjectWorkspace', () => {
  it('moves planning conversations into the linked workspace and preserves metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'oneship-link-'))
    const globalStateDir = join(root, 'state')
    const workspacePath = join(root, 'workspace')

    mkdirSync(join(globalStateDir, 'conversations'), { recursive: true })
    mkdirSync(workspacePath, { recursive: true })

    writeFileSync(
      join(globalStateDir, 'conversations', 'project-alpha.json'),
      JSON.stringify({
        id: 'project-alpha',
        projectId: 'alpha',
        messages: [{ id: '1', role: 'user', content: 'plan this', timestamp: 1 }],
        createdAt: 1,
        updatedAt: 1,
      }),
    )

    const result = linkProjectWorkspace({
      projectId: 'alpha',
      nextPath: workspacePath,
      globalStateDir,
      projectData: {
        status: 'planning',
        createdAt: 123,
        goals: [],
        settings: {},
        repositories: ['git@github.com:acme/repo.git'],
        notes: 'carry this forward',
      },
    })

    expect(result.migratedConversation).toBe(true)
    expect(existsSync(join(globalStateDir, 'conversations', 'project-alpha.json'))).toBe(false)

    const migratedConversation = JSON.parse(
      readFileSync(join(workspacePath, '.oneship', 'conversations', 'project-alpha.json'), 'utf8'),
    )
    const persistedProject = JSON.parse(
      readFileSync(join(workspacePath, '.oneship', 'project.json'), 'utf8'),
    )

    expect(migratedConversation.messages).toHaveLength(1)
    expect(persistedProject).toMatchObject({
      createdAt: 123,
      notes: 'carry this forward',
      repositories: ['git@github.com:acme/repo.git'],
      status: 'planning',
    })
  })

  it('is idempotent when the project is linked to the same workspace again', () => {
    const root = mkdtempSync(join(tmpdir(), 'oneship-link-'))
    const globalStateDir = join(root, 'state')
    const workspacePath = join(root, 'workspace')

    mkdirSync(workspacePath, { recursive: true })

    linkProjectWorkspace({
      projectId: 'alpha',
      nextPath: workspacePath,
      globalStateDir,
      projectData: {
        status: 'active',
        createdAt: 123,
        goals: [],
        settings: {},
      },
    })

    expect(() =>
      linkProjectWorkspace({
        projectId: 'alpha',
        nextPath: workspacePath,
        globalStateDir,
        projectData: {
          status: 'active',
          createdAt: 123,
          goals: [],
          settings: {},
        },
      }),
    ).not.toThrow()
  })

  it('swallows rename races when the destination conversation appears first', () => {
    const root = mkdtempSync(join(tmpdir(), 'oneship-link-'))
    const globalStateDir = join(root, 'state')
    const workspacePath = join(root, 'workspace')

    mkdirSync(join(globalStateDir, 'conversations'), { recursive: true })
    mkdirSync(join(workspacePath, '.oneship', 'conversations'), { recursive: true })

    writeFileSync(
      join(globalStateDir, 'conversations', 'project-alpha.json'),
      JSON.stringify({ id: 'project-alpha', projectId: 'alpha', messages: [], createdAt: 1, updatedAt: 1 }),
    )
    vi.mocked(renameSync).mockImplementationOnce(() => {
      writeFileSync(
        join(workspacePath, '.oneship', 'conversations', 'project-alpha.json'),
        JSON.stringify({ id: 'project-alpha', projectId: 'alpha', messages: [{ id: '1' }], createdAt: 1, updatedAt: 1 }),
      )
      const error = new Error('destination exists') as NodeJS.ErrnoException
      error.code = 'EEXIST'
      throw error
    })

    expect(() =>
      linkProjectWorkspace({
        projectId: 'alpha',
        nextPath: workspacePath,
        globalStateDir,
        projectData: {
          status: 'active',
          createdAt: 123,
          goals: [],
          settings: {},
        },
      }),
    ).not.toThrow()
  })
})
