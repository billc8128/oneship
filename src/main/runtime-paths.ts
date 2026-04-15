import { app } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type RuntimeProfile = 'prod' | 'dev'

type RuntimeEnv = NodeJS.ProcessEnv | Record<string, string | undefined>

interface RuntimeProfileInput {
  isPackaged: boolean
  env: RuntimeEnv
}

interface RuntimePathsInput {
  profile: RuntimeProfile
  appDataDir: string
  currentUserDataDir: string
  homeDir: string
}

export interface RuntimePaths {
  profile: RuntimeProfile
  userData: string
  globalState: string
  agentRoot: string
  hookBridgeDir: string
}

export function deriveRuntimeProfile({ isPackaged, env }: RuntimeProfileInput): RuntimeProfile {
  if (env.ONESHIP_PROFILE === 'prod' || env.ONESHIP_PROFILE === 'dev') {
    return env.ONESHIP_PROFILE
  }

  return isPackaged ? 'prod' : 'dev'
}

export function deriveRuntimePaths({
  profile,
  appDataDir,
  currentUserDataDir,
  homeDir,
}: RuntimePathsInput): RuntimePaths {
  if (profile === 'prod') {
    const agentRoot = join(homeDir, '.oneship')
    return {
      profile,
      userData: currentUserDataDir,
      globalState: join(currentUserDataDir, '..', 'ge'),
      agentRoot,
      hookBridgeDir: join(agentRoot, 'bin'),
    }
  }

  const userData = join(appDataDir, 'oneship-dev')
  const agentRoot = join(homeDir, '.oneship-dev')

  return {
    profile,
    userData,
    globalState: join(userData, 'state'),
    agentRoot,
    hookBridgeDir: join(agentRoot, 'bin'),
  }
}

export function shouldAutoInstallHooks(profile: RuntimeProfile, env: RuntimeEnv): boolean {
  return profile === 'prod' || env.ONESHIP_INSTALL_HOOKS === '1'
}

export function runtimeProfile(): RuntimeProfile {
  return deriveRuntimeProfile({ isPackaged: app.isPackaged, env: process.env })
}

export function runtimePaths(): RuntimePaths {
  return deriveRuntimePaths({
    profile: runtimeProfile(),
    appDataDir: app.getPath('appData'),
    currentUserDataDir: app.getPath('userData'),
    homeDir: homedir(),
  })
}

export function installRuntimeUserDataPath(): void {
  const paths = runtimePaths()
  if (paths.profile === 'dev') {
    app.setPath('userData', paths.userData)
  }
}
