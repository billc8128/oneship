// Atomic file write helpers used across the agent worker. The atomic write
// pattern (write to .tmp, fsync, rename) is mandatory for any file that
// other code reads concurrently — meta.json, suspension.json, snapshot.json.
//
// events.jsonl uses appendFile directly and does NOT go through here; its
// crash recovery model is "drop the truncated tail," not "atomic write."

import { promises as fs } from 'fs'
import { dirname } from 'path'

export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp`
  const json = JSON.stringify(value, null, 2)
  await fs.writeFile(tmp, json, 'utf-8')
  await fs.rename(tmp, path)
}

export async function readJsonOrNull<T>(path: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(path, 'utf-8')
    return JSON.parse(raw) as T
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

export async function ensureDir(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true })
}

export async function ensureParentDir(filePath: string): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true })
}
