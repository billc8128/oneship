import { describe, expect, it } from 'vitest'
import { appendRepositoryDraft } from '../project-settings-state'

describe('appendRepositoryDraft', () => {
  it('appends a trimmed repository draft to the existing list', () => {
    const result = appendRepositoryDraft(['git@github.com:acme/one.git'], '  git@github.com:acme/two.git  ')

    expect(result).toEqual([
      'git@github.com:acme/one.git',
      'git@github.com:acme/two.git',
    ])
  })

  it('returns null for a blank repository draft', () => {
    expect(appendRepositoryDraft(['git@github.com:acme/one.git'], '   ')).toBeNull()
  })
})
