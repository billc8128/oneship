import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

export interface ProjectRef {
  id: string
  name: string
  path: string | null
  createdAt?: number
}

export interface GlobalConfig {
  projects: ProjectRef[]
}

const CONFIG_DIR = join(app.getPath('userData'), '..', 'ge')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

const DEFAULT_CONFIG: GlobalConfig = {
  projects: []
}

export function loadConfig(): GlobalConfig {
  try {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })
    if (!existsSync(CONFIG_FILE)) {
      writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2))
      return DEFAULT_CONFIG
    }
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveConfig(config: GlobalConfig): void {
  try {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
  } catch (e) {
    console.error('Failed to save config:', e)
  }
}

export function getGlobalStateDir(): string {
  return CONFIG_DIR
}
