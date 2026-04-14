import { createServer } from 'node:net'

export async function resolveAvailablePort(input: {
  preferredPort: number
  maxAttempts?: number
  isPortAvailable?: (port: number) => Promise<boolean>
}): Promise<number> {
  const maxAttempts = input.maxAttempts ?? 10
  const isPortAvailable = input.isPortAvailable ?? defaultIsPortAvailable

  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = input.preferredPort + offset
    if (await isPortAvailable(port)) {
      return port
    }
  }

  throw new Error('No available hook port found')
}

async function defaultIsPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()

    server.once('error', () => {
      resolve(false)
    })

    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
  })
}
