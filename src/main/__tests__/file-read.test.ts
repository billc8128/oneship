import { describe, expect, it } from 'vitest'
import { getFileKind } from '../file-type'

describe('getFileKind', () => {
  it('treats dotfiles that hold text as text files', () => {
    expect(getFileKind('.env')).toBe('text')
    expect(getFileKind('.gitignore')).toBe('text')
    expect(getFileKind('.env.local')).toBe('text')
  })

  it('recognizes common image formats', () => {
    expect(getFileKind('logo.png')).toBe('image')
  })

  it('recognizes common source and markup files as text', () => {
    expect(getFileKind('main.cpp')).toBe('text')
    expect(getFileKind('App.java')).toBe('text')
    expect(getFileKind('pom.xml')).toBe('text')
  })
})
