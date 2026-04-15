import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('conversation-store', () => {
  let tmpRoot: string
  let globalStateDir: string
  let projectPath: string

  beforeEach(() => {
    vi.resetModules()
    tmpRoot = mkdtempSync(join(tmpdir(), 'oneship-conversation-store-'))
    globalStateDir = join(tmpRoot, 'runtime-state')
    projectPath = join(tmpRoot, 'workspace')

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

  afterEach(() => {
    vi.doUnmock('electron')
    vi.doUnmock('../runtime-paths')
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('stores chief conversations under the runtime-scoped global state directory', async () => {
    const { addMessage, getOrCreateConversation, loadConversation, saveConversation } = await import(
      '../conversation-store'
    )

    const conversation = getOrCreateConversation(null, null)
    addMessage(conversation, 'user', 'hello')
    saveConversation(null, conversation)

    const expectedFile = join(globalStateDir, 'conversations', 'chief-agent.json')
    expect(existsSync(expectedFile)).toBe(true)
    expect(loadConversation(null, 'chief-agent')?.messages).toHaveLength(1)
    expect(JSON.parse(readFileSync(expectedFile, 'utf8')).messages).toHaveLength(1)
  })

  it('keeps project conversations under the project-local .oneship directory', async () => {
    const { addMessage, getOrCreateConversation, saveConversation } = await import(
      '../conversation-store'
    )

    const conversation = getOrCreateConversation(projectPath, 'alpha')
    addMessage(conversation, 'assistant', 'saved locally')
    saveConversation(projectPath, conversation)

    const expectedFile = join(projectPath, '.oneship', 'conversations', 'project-alpha.json')
    expect(existsSync(expectedFile)).toBe(true)
    expect(JSON.parse(readFileSync(expectedFile, 'utf8')).messages).toHaveLength(1)
  })
})
