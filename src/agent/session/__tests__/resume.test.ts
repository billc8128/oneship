import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { enumerateSessionMetas } from '../resume'

let originalHome: string | undefined
let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'oneship-resume-test-'))
  originalHome = process.env.HOME
  process.env.HOME = tmp
})

afterEach(() => {
  process.env.HOME = originalHome
  rmSync(tmp, { recursive: true, force: true })
})

describe('resume', () => {
  it('returns [] if sessions root does not exist', async () => {
    expect(await enumerateSessionMetas()).toEqual([])
  })

  it('returns metas for each session directory', async () => {
    const root = join(tmp, '.oneship', 'sessions')
    mkdirSync(join(root, 's_a'), { recursive: true })
    mkdirSync(join(root, 's_b'), { recursive: true })
    writeFileSync(join(root, 's_a', 'meta.json'), JSON.stringify({
      sessionId: 's_a', createdAt: 1, updatedAt: 2, model: 'x',
      permissionMode: 'trust', planMode: false,
      triggeredBy: { kind: 'user' }, lastSegmentReason: null,
      title: null, eventLogLength: 0, snapshotEventOffset: null,
    }))
    writeFileSync(join(root, 's_b', 'meta.json'), JSON.stringify({
      sessionId: 's_b', createdAt: 1, updatedAt: 5, model: 'x',
      permissionMode: 'trust', planMode: false,
      triggeredBy: { kind: 'user' }, lastSegmentReason: null,
      title: null, eventLogLength: 0, snapshotEventOffset: null,
    }))

    const metas = await enumerateSessionMetas()
    expect(metas).toHaveLength(2)
    // Sorted by updatedAt desc
    expect(metas[0].sessionId).toBe('s_b')
    expect(metas[1].sessionId).toBe('s_a')
  })

  it('skips directories without meta.json', async () => {
    const root = join(tmp, '.oneship', 'sessions')
    mkdirSync(join(root, 's_orphan'), { recursive: true })
    expect(await enumerateSessionMetas()).toEqual([])
  })

  it('skips directories with corrupted meta.json instead of throwing', async () => {
    // A previous worker crash could leave a half-written meta.json on disk.
    // enumeration must survive that — one bad session must NOT block all
    // other sessions from loading.
    const root = join(tmp, '.oneship', 'sessions')
    mkdirSync(join(root, 's_broken'), { recursive: true })
    mkdirSync(join(root, 's_good'), { recursive: true })
    writeFileSync(join(root, 's_broken', 'meta.json'), '{ this is not valid json')
    writeFileSync(
      join(root, 's_good', 'meta.json'),
      JSON.stringify({
        sessionId: 's_good', createdAt: 1, updatedAt: 1, model: 'x',
        permissionMode: 'trust', planMode: false,
        triggeredBy: { kind: 'user' }, lastSegmentReason: null,
        title: null, eventLogLength: 0, snapshotEventOffset: null,
      })
    )

    const metas = await enumerateSessionMetas()
    expect(metas).toHaveLength(1)
    expect(metas[0].sessionId).toBe('s_good')
  })
})
