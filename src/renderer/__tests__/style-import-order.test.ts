import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const rendererEntry = readFileSync(resolve(__dirname, '../main.tsx'), 'utf8')
const terminalView = readFileSync(resolve(__dirname, '../components/terminal/terminal-view.tsx'), 'utf8')

describe('renderer style import order', () => {
  it('loads xterm.css before globals.css in the renderer entry', () => {
    const xtermImportIndex = rendererEntry.indexOf("import '@xterm/xterm/css/xterm.css'")
    const globalsImportIndex = rendererEntry.indexOf("import './styles/globals.css'")

    expect(xtermImportIndex).toBeGreaterThanOrEqual(0)
    expect(globalsImportIndex).toBeGreaterThan(xtermImportIndex)
  })

  it('does not import xterm.css from the terminal view component', () => {
    expect(terminalView).not.toContain("@xterm/xterm/css/xterm.css")
  })
})
