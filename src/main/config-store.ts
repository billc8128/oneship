import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { runtimePaths } from './runtime-paths'

export interface ProjectRef {
  id: string
  name: string
  path: string | null
  createdAt?: number
}

export interface GlobalConfig {
  projects: ProjectRef[]
}

const DEFAULT_CONFIG: GlobalConfig = {
  projects: []
}

function getConfigDir(): string {
  return runtimePaths().globalState
}

function getConfigFile(): string {
  return join(getConfigDir(), 'config.json')
}

export function loadConfig(): GlobalConfig {
  try {
    const configDir = getConfigDir()
    const configFile = getConfigFile()
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true })
    if (!existsSync(configFile)) {
      writeFileSync(configFile, JSON.stringify(DEFAULT_CONFIG, null, 2))
      return DEFAULT_CONFIG
    }
    return JSON.parse(readFileSync(configFile, 'utf-8'))
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveConfig(config: GlobalConfig): void {
  try {
    const configDir = getConfigDir()
    const configFile = getConfigFile()
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true })
    writeFileSync(configFile, JSON.stringify(config, null, 2))
  } catch (e) {
    console.error('Failed to save config:', e)
  }
}

export function getGlobalStateDir(): string {
  return getConfigDir()
}
