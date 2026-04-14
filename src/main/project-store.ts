import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

export interface ProjectData {
  status: 'active' | 'planning' | 'done'
  createdAt: number
  goals: unknown[]
  settings: Record<string, unknown>
  repositories?: string[]
  notes?: string
}

export const GE_DIR = '.oneship'

export function geDir(projectPath: string): string {
  return join(projectPath, GE_DIR)
}

export function projectFile(projectPath: string): string {
  return join(geDir(projectPath), 'project.json')
}

export function initProjectDir(projectPath: string): void {
  const base = geDir(projectPath)
  if (!existsSync(base)) mkdirSync(base, { recursive: true })

  const conversationsDir = join(base, 'conversations')
  if (!existsSync(conversationsDir)) mkdirSync(conversationsDir)

  const tasksDir = join(base, 'tasks')
  if (!existsSync(tasksDir)) mkdirSync(tasksDir)
}

export function loadProjectData(projectPath: string): ProjectData | null {
  try {
    const file = projectFile(projectPath)
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

export function saveProjectData(projectPath: string, data: ProjectData): void {
  try {
    initProjectDir(projectPath)
    writeFileSync(projectFile(projectPath), JSON.stringify(data, null, 2))
  } catch (e) {
    console.error('Failed to save project data:', e)
  }
}
