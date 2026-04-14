import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { atomicWriteJson, readJsonOrNull, ensureDir } from '../fs'

describe('fs helpers', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'oneship-fs-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('atomicWriteJson writes the file', async () => {
    await atomicWriteJson(join(dir, 'a.json'), { hello: 'world' })
    const back = await readJsonOrNull<{ hello: string }>(join(dir, 'a.json'))
    expect(back?.hello).toBe('world')
  })

  it('atomicWriteJson does not leave a .tmp behind on success', async () => {
    await atomicWriteJson(join(dir, 'a.json'), { x: 1 })
    expect(existsSync(join(dir, 'a.json.tmp'))).toBe(false)
  })

  it('readJsonOrNull returns null for a missing file', async () => {
    expect(await readJsonOrNull(join(dir, 'nope.json'))).toBeNull()
  })

  it('ensureDir creates nested directories', async () => {
    const p = join(dir, 'a/b/c')
    await ensureDir(p)
    expect(existsSync(p)).toBe(true)
  })
})
