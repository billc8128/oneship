import { describe, expect, it } from 'vitest'
import { resolveAvailablePort } from '../hook-runtime'

describe('resolveAvailablePort', () => {
  it('falls forward when the preferred port is unavailable', async () => {
    const unavailable = new Set([19876, 19877])

    await expect(
      resolveAvailablePort({
        preferredPort: 19876,
        maxAttempts: 5,
        isPortAvailable: async (port) => !unavailable.has(port),
      }),
    ).resolves.toBe(19878)
  })
})
