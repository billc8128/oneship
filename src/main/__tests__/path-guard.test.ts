import { describe, expect, it } from 'vitest'
import { assertPathAllowed, isPathInsideRoots } from '../path-guard'

describe('path-guard', () => {
  it('allows access within a linked project root', () => {
    expect(
      isPathInsideRoots('/Users/a/project/src/index.ts', ['/Users/a/project']),
    ).toBe(true)
  })

  it('rejects access outside linked project roots', () => {
    expect(
      isPathInsideRoots('/Users/a/.ssh/config', ['/Users/a/project']),
    ).toBe(false)
    expect(() =>
      assertPathAllowed('/Users/a/.ssh/config', ['/Users/a/project']),
    ).toThrow(/outside allowed roots/i)
  })
})
