import { homedir } from 'os'
import { join } from 'path'
import { atomicWriteJson, readJsonOrNull, ensureDir } from '../services/fs'
import type { SessionMeta } from '../../shared/agent-protocol'

export function sessionsRoot(): string {
  return join(homedir(), '.oneship', 'sessions')
}

export function sessionDir(sessionId: string): string {
  return join(sessionsRoot(), sessionId)
}

export function eventLogPath(sessionId: string): string {
  return join(sessionDir(sessionId), 'events.jsonl')
}

export function metaPath(sessionId: string): string {
  return join(sessionDir(sessionId), 'meta.json')
}

export async function ensureSessionDir(sessionId: string): Promise<void> {
  await ensureDir(sessionDir(sessionId))
}

export async function readMeta(sessionId: string): Promise<SessionMeta | null> {
  return readJsonOrNull<SessionMeta>(metaPath(sessionId))
}

export async function writeMeta(meta: SessionMeta): Promise<void> {
  await ensureSessionDir(meta.sessionId)
  await atomicWriteJson(metaPath(meta.sessionId), meta)
}
