import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { planCloneProject } from '../clone-flow'

describe('planCloneProject', () => {
  it('rejects clone targets that already exist and contain app metadata', () => {
    const destinationParent = mkdtempSync(join(tmpdir(), 'oneship-clone-'))
    const targetPath = join(destinationParent, 'repo')

    mkdirSync(join(targetPath, '.oneship'), { recursive: true })
    writeFileSync(join(targetPath, '.oneship', 'project.json'), '{"status":"active"}')

    expect(() =>
      planCloneProject({
        cloneUrl: 'https://github.com/acme/repo.git',
        destinationParent,
      }),
    ).toThrow(/already exists/i)
  })

  it('plans clone target path from the repo name when the destination parent is empty', () => {
    const destinationParent = mkdtempSync(join(tmpdir(), 'oneship-clone-'))

    expect(
      planCloneProject({
        cloneUrl: 'git@github.com:acme/repo.git',
        destinationParent,
      }),
    ).toMatchObject({
      repoName: 'repo',
      targetPath: join(destinationParent, 'repo'),
    })
  })

  it('allows cloning into an existing empty target directory', () => {
    const destinationParent = mkdtempSync(join(tmpdir(), 'oneship-clone-'))
    mkdirSync(join(destinationParent, 'repo'), { recursive: true })

    expect(
      planCloneProject({
        cloneUrl: 'https://github.com/acme/repo.git',
        destinationParent,
      }),
    ).toMatchObject({
      repoName: 'repo',
      targetPath: join(destinationParent, 'repo'),
    })
  })
})
