import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'
import { runtimePaths } from './runtime-paths'

const BRIDGE_MARKER = 'oneship-bridge'

interface InstallHooksOptions {
  bridgeDir?: string
}

function getBridgeDestDir(options?: InstallHooksOptions): string {
  return options?.bridgeDir ?? runtimePaths().hookBridgeDir
}

function getBridgeDestPath(options?: InstallHooksOptions): string {
  return join(getBridgeDestDir(options), 'oneship-bridge.js')
}

const BRIDGE_SCRIPT = `#!/usr/bin/env node
const http = require('http');
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const port = process.env.ONESHIP_HOOK_PORT || '19876';
  const source = process.argv.find(a => a.startsWith('--source='))?.split('=')[1] || 'unknown';
  const payload = JSON.stringify({
    source,
    event: input ? JSON.parse(input) : {},
    cwd: process.env.CLAUDE_CWD || process.env.PWD || '',
    terminalSessionId: process.env.ONESHIP_SESSION_ID || '',
    timestamp: Date.now()
  });
  const req = http.request({
    hostname: '127.0.0.1',
    port: parseInt(port),
    path: '/hook',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, () => {});
  req.on('error', () => {});
  req.write(payload);
  req.end();
});
setTimeout(() => { if (!input) process.stdin.destroy(); }, 100);
`

function copyBridgeScript(options?: InstallHooksOptions): string {
  const dest = getBridgeDestPath(options)
  const destDir = getBridgeDestDir(options)

  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true })
  }

  // Always write the latest version (embedded in code, not copied from file)
  writeFileSync(dest, BRIDGE_SCRIPT, 'utf-8')
  chmodSync(dest, 0o755)

  return dest
}

function makeClaudeCommand(bridgePath: string): string {
  return `node "${bridgePath}" --source=claude`
}

function makeCodexCommand(bridgePath: string): string {
  return `node "${bridgePath}" --source=codex`
}

function isOneshipHook(hook: { command?: string }): boolean {
  return typeof hook.command === 'string' && hook.command.includes(BRIDGE_MARKER)
}

function isOneshipEntry(entry: { hooks?: Array<{ command?: string }> }): boolean {
  return Array.isArray(entry.hooks) && entry.hooks.some(isOneshipHook)
}

function collectOneshipCommands(entries: unknown): string[] {
  if (!Array.isArray(entries)) {
    return []
  }

  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || !('hooks' in entry)) {
      return []
    }

    const hooks = (entry as { hooks?: Array<{ command?: string }> }).hooks
    if (!Array.isArray(hooks)) {
      return []
    }

    return hooks
      .filter(isOneshipHook)
      .flatMap((hook) => (typeof hook.command === 'string' ? [hook.command] : []))
  })
}

function assertCompatibleOneshipCommands(
  entriesByEvent: Record<string, unknown> | undefined,
  expectedCommand: string,
  configLabel: string,
): void {
  if (!entriesByEvent || typeof entriesByEvent !== 'object') {
    return
  }

  for (const entries of Object.values(entriesByEvent)) {
    for (const command of collectOneshipCommands(entries)) {
      if (command !== expectedCommand) {
        throw new Error(
          `${configLabel} is already configured for another Oneship bridge. ` +
            `Expected ${expectedCommand} but found ${command}.`,
        )
      }
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function installClaudeHooks(bridgePath: string): void {
  const settingsPath = join(homedir(), '.claude', 'settings.json')
  const settingsDir = dirname(settingsPath)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let settings: any = {}

  if (!existsSync(settingsDir)) {
    mkdirSync(settingsDir, { recursive: true })
  }

  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    } catch (error) {
      throw new Error(`Failed to parse Claude settings.json: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }

  if (!settings.hooks) {
    settings.hooks = {}
  }

  const command = makeClaudeCommand(bridgePath)
  assertCompatibleOneshipCommands(settings.hooks, command, 'Claude Code settings')

  // Hook events that don't use a matcher
  const simpleEvents = ['SessionStart', 'Stop', 'StopFailure', 'UserPromptSubmit', 'SessionEnd']
  for (const eventName of simpleEvents) {
    if (!settings.hooks[eventName]) {
      settings.hooks[eventName] = []
    }
    // Remove any existing oneship entries to avoid duplicates
    settings.hooks[eventName] = settings.hooks[eventName].filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (entry: any) => !isOneshipEntry(entry)
    )
    // Append our hook
    settings.hooks[eventName].push({
      hooks: [{ type: 'command', command }]
    })
  }

  // Hook events that use a matcher
  const matcherEvents = [
    'PreToolUse',
    'PostToolUse',
    'PostToolUseFailure',
    'PermissionDenied',
    'Notification',
    'Elicitation',
    'ElicitationResult',
  ]
  for (const eventName of matcherEvents) {
    if (!settings.hooks[eventName]) {
      settings.hooks[eventName] = []
    }
    settings.hooks[eventName] = settings.hooks[eventName].filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (entry: any) => !isOneshipEntry(entry)
    )
    settings.hooks[eventName].push({
      matcher: '*',
      hooks: [{ type: 'command', command }]
    })
  }

  // PermissionRequest needs a long timeout so it doesn't kill the agent wait
  if (!settings.hooks['PermissionRequest']) {
    settings.hooks['PermissionRequest'] = []
  }
  settings.hooks['PermissionRequest'] = settings.hooks['PermissionRequest'].filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (entry: any) => !isOneshipEntry(entry)
  )
  settings.hooks['PermissionRequest'].push({
    matcher: '*',
    hooks: [{ type: 'command', command, timeout: 86400 }]
  })

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
  console.log('Installed Oneship hooks into Claude Code settings')
}

function installCodexHooks(bridgePath: string): void {
  const codexDir = join(homedir(), '.codex')
  const hooksPath = join(codexDir, 'hooks.json')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let config: any = {}

  if (!existsSync(codexDir)) {
    mkdirSync(codexDir, { recursive: true })
  }

  if (existsSync(hooksPath)) {
    try {
      config = JSON.parse(readFileSync(hooksPath, 'utf-8'))
    } catch (error) {
      throw new Error(`Failed to parse Codex hooks.json: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }

  if (!config.hooks) {
    config.hooks = {}
  }

  const command = makeCodexCommand(bridgePath)
  assertCompatibleOneshipCommands(config.hooks, command, 'Codex hooks')

  const hookEntries = [
    { eventName: 'SessionStart', matcher: 'startup|resume' },
    { eventName: 'PreToolUse', matcher: 'Bash' },
    { eventName: 'PostToolUse', matcher: 'Bash' },
    { eventName: 'UserPromptSubmit' },
    { eventName: 'Stop' },
  ] as const
  const obsoleteEvents = ['Notification', 'PermissionRequest']

  for (const eventName of obsoleteEvents) {
    if (!config.hooks[eventName]) {
      continue
    }
    config.hooks[eventName] = config.hooks[eventName].filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (existingEntry: any) => !isOneshipEntry(existingEntry)
    )
    if (config.hooks[eventName].length === 0) {
      delete config.hooks[eventName]
    }
  }

  for (const entry of hookEntries) {
    if (!config.hooks[entry.eventName]) {
      config.hooks[entry.eventName] = []
    }
    config.hooks[entry.eventName] = config.hooks[entry.eventName].filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (existingEntry: any) => !isOneshipEntry(existingEntry)
    )
    config.hooks[entry.eventName].push({
      ...(entry.matcher ? { matcher: entry.matcher } : {}),
      hooks: [{ type: 'command', command }]
    })
  }

  writeFileSync(hooksPath, JSON.stringify(config, null, 2), 'utf-8')
  console.log('Installed Oneship hooks into Codex config')
}

export function installHooks(options?: InstallHooksOptions): { installed: boolean; error?: string } {
  try {
    const bridgePath = copyBridgeScript(options)
    installClaudeHooks(bridgePath)
    installCodexHooks(bridgePath)
    return { installed: true }
  } catch (err) {
    console.error('Failed to install hooks:', err)
    return {
      installed: false,
      error: err instanceof Error ? err.message : 'Failed to install hooks'
    }
  }
}
