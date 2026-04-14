import { promises as fs, existsSync } from 'fs'
import type { SessionMeta } from '../../shared/agent-protocol'
import { sessionsRoot, metaPath } from './store'
import { readJsonOrNull } from '../services/fs'

/**
 * Enumerate all sessions on disk, returning their metas sorted by
 * updatedAt descending (most recent first). Used by SessionManager
 * on worker startup for lazy hydration.
 *
 * Resilient to broken session directories: a corrupted meta.json (parse
 * error) or an unreadable file is logged and SKIPPED, not propagated.
 * This keeps worker startup survivable even if a previous crash left
 * a half-written meta.json on disk — one bad session should not block
 * every other session from loading.
 *
 * Sort tiebreaker: when two sessions share the same updatedAt (common in
 * tests that create sessions in quick succession), fall back to
 * sessionId lexicographic order so the output is deterministic.
 */
export async function enumerateSessionMetas(): Promise<SessionMeta[]> {
  const root = sessionsRoot()
  if (!existsSync(root)) return []
  const entries = await fs.readdir(root, { withFileTypes: true })
  const metas: SessionMeta[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const meta = await readJsonOrNull<SessionMeta>(metaPath(entry.name))
      if (meta) metas.push(meta)
    } catch (err) {
      // readJsonOrNull only swallows ENOENT; parse errors and permission
      // errors propagate. Catch them here so one broken session dir
      // doesn't abort the whole enumeration.
      console.error(
        `[agent] enumerateSessionMetas: skipping session ${entry.name} due to error:`,
        (err as Error).message ?? err
      )
    }
  }
  metas.sort((a, b) => {
    const byUpdated = b.updatedAt - a.updatedAt
    if (byUpdated !== 0) return byUpdated
    return a.sessionId.localeCompare(b.sessionId)
  })
  return metas
}
