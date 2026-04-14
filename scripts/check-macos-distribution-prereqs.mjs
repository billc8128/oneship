import { execFileSync } from 'node:child_process'

function hasDeveloperIdApplicationCertificate() {
  try {
    const output = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return output.includes('Developer ID Application:')
  } catch {
    return false
  }
}

function hasNotarizationCredentials() {
  const env = process.env

  if (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) {
    return true
  }

  if (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) {
    return true
  }

  if (env.APPLE_KEYCHAIN_PROFILE) {
    return true
  }

  return false
}

function fail(message, details) {
  console.error(message)
  if (details.length > 0) {
    for (const detail of details) {
      console.error(`- ${detail}`)
    }
  }
  process.exit(1)
}

if (process.platform !== 'darwin') {
  fail('macOS distribution builds must run on macOS.', [])
}

const issues = []

if (!hasDeveloperIdApplicationCertificate()) {
  issues.push('Install a "Developer ID Application" certificate into the login keychain. An Apple Development certificate is not enough for outside-the-App-Store distribution.')
}

if (!hasNotarizationCredentials()) {
  issues.push('Provide notarization credentials via one of: APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER, APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, or APPLE_KEYCHAIN_PROFILE.')
}

if (issues.length > 0) {
  fail('Cannot build a distributable macOS package yet.', issues)
}

console.log('macOS distribution signing prerequisites look good.')
