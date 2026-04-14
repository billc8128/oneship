export type SidebarBrandMenuItem = {
  id: string
  label: string
  shortcut?: string
  to: string
}

export const sidebarBrandMenuItems: SidebarBrandMenuItem[] = [
  {
    id: 'preferences',
    label: 'Preferences',
    shortcut: '⌘,',
    to: '/preferences/terminal',
  },
]
