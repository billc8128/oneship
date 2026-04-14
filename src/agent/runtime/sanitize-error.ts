// Phase 1: sanitize errors before they're shown to the user or written to logs.
// Strips stack traces and absolute paths outside the user's home, leaving only
// the error message. Used by the IPC layer when reporting errors back to Main.

const HOME = process.env.HOME || process.env.USERPROFILE || ''

function scrubHome(msg: string): string {
  if (!HOME) return msg
  // Plain string split/join so HOME characters aren't interpreted as regex.
  return msg.split(HOME).join('~')
}

export function sanitizeErrorMessage(err: unknown): string {
  if (err === null) return 'null'
  if (err === undefined) return 'undefined'
  if (err instanceof Error) return scrubHome(err.message)
  if (typeof err === 'string') return scrubHome(err)

  // Objects: try JSON.stringify, fall back to String(err) on circular refs
  // (or anything else JSON.stringify throws on). Neither of those can return
  // undefined because we've already handled null/undefined above.
  try {
    const json = JSON.stringify(err)
    // JSON.stringify returns undefined for bare `undefined`, functions, and
    // symbols as top-level input. We already handled `undefined`; the other
    // two fall through to String(err).
    if (json === undefined) return String(err)
    return scrubHome(json)
  } catch {
    return scrubHome(String(err))
  }
}
