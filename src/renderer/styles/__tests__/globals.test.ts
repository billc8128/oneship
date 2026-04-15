import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const globalsCss = readFileSync(resolve(__dirname, '../globals.css'), 'utf8')

describe('global renderer styles', () => {
  it('reserves terminal gutter space so the scrollbar does not cover the last characters', () => {
    expect(globalsCss).toContain('.xterm {')
    expect(globalsCss).toContain('box-sizing: border-box;')
    expect(globalsCss).toContain('padding-right:')
    expect(globalsCss).toContain('scrollbar-gutter: stable;')
  })

  it('overrides xterm viewport black fill so the scrollbar gutter matches the active terminal background', () => {
    expect(globalsCss).toContain('.xterm .xterm-viewport {')
    expect(globalsCss).toContain('background-color: transparent;')
  })
})
