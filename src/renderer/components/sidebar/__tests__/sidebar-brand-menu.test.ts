import { describe, expect, it } from 'vitest'
import { sidebarBrandMenuItems } from '../sidebar-brand-menu'

describe('sidebarBrandMenuItems', () => {
  it('exposes a global preferences entry from the brand menu', () => {
    expect(sidebarBrandMenuItems).toContainEqual({
      id: 'preferences',
      label: 'Preferences',
      shortcut: '⌘,',
      to: '/preferences/terminal',
    })
  })
})
