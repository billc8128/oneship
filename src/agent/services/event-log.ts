import { promises as fs, existsSync } from 'fs'
import type { AgentUIMessagePart } from '../../shared/agent-protocol'

// One line per LogEvent in events.jsonl. The full type union from spec §15.2.1
// includes 'part-update'. Phase 1 never writes part-update events, but the
// type lives here so future phases (suspension protocol) only need to add
// the writer, not the type.
//
// AgentUIMessagePart is defined once in src/shared/agent-protocol.ts — see
// the "Shared UIMessage aliases" block there. Do not import the bare
// UIMessagePart from 'ai' directly; it has required generic parameters
// with no defaults and triggers TS2314.
export type LogEvent =
  | { type: 'message-start'; messageId: string; role: 'user' | 'assistant' | 'system'; createdAt: number }
  | { type: 'part-append'; messageId: string; part: AgentUIMessagePart }
  | { type: 'part-update'; messageId: string; partIndex: number; part: AgentUIMessagePart }
  | { type: 'message-finish'; messageId: string }

/**
 * Append one event as a single JSONL line. Creates the file if missing.
 *
 * Phase 1 does NOT fsync per write — it relies on the OS page cache and
 * fsyncs at segment boundaries via `fsyncEventLog` (not implemented in
 * Phase 1; see Task notes). Streaming-text batching mentioned in §15.2.3
 * is also Phase 2 territory.
 */
export async function appendEvent(logPath: string, event: LogEvent): Promise<void> {
  const line = JSON.stringify(event) + '\n'
  await fs.appendFile(logPath, line, 'utf-8')
}

/**
 * Read all events from disk, parsing one JSON object per line.
 *
 * Lines that fail to parse are dropped silently (truncated tail from a
 * crash mid-write — §15.2.2). A missing file is treated as an empty log.
 */
export async function readEvents(logPath: string): Promise<LogEvent[]> {
  if (!existsSync(logPath)) return []
  const raw = await fs.readFile(logPath, 'utf-8')
  const out: LogEvent[] = []
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue
    try {
      out.push(JSON.parse(line) as LogEvent)
    } catch {
      // Truncated tail. Stop reading — anything past a parse failure
      // could be partial data with later valid-looking lines that
      // belong to a different state. Conservative: stop.
      break
    }
  }
  return out
}
