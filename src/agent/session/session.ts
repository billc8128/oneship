import { nanoid } from 'nanoid'
import type {
  SessionMeta,
  TriggeredBy,
  PermissionMode,
  AgentUIMessage,
  SegmentFinishReason,
} from '../../shared/agent-protocol'
import {
  ensureSessionDir,
  eventLogPath,
  readMeta,
  writeMeta,
} from './store'
import { readEvents } from '../services/event-log'
import {
  replay,
  writeMessageStart,
  writePartAppend,
  writeMessageFinish,
} from '../services/conversation-store'

const PHASE1_STUB_REPLY = 'Hello from Chief Agent (Phase 1 stub — no LLM yet).'

export interface CreateSessionOptions {
  sessionId?: string
  model?: string
  permissionMode?: PermissionMode
  triggeredBy?: TriggeredBy
}

export class Session {
  meta: SessionMeta
  uiMessages: AgentUIMessage[]

  private constructor(meta: SessionMeta, uiMessages: AgentUIMessage[]) {
    this.meta = meta
    this.uiMessages = uiMessages
  }

  static async create(opts: CreateSessionOptions = {}): Promise<Session> {
    const now = Date.now()
    const meta: SessionMeta = {
      sessionId: opts.sessionId ?? `s_${nanoid(10)}`,
      createdAt: now,
      updatedAt: now,
      model: opts.model ?? 'phase1-stub',
      permissionMode: opts.permissionMode ?? 'trust',
      planMode: false,
      triggeredBy: opts.triggeredBy ?? { kind: 'user' },
      lastSegmentReason: null,
      title: null,
      eventLogLength: 0,
      snapshotEventOffset: null,
    }
    await ensureSessionDir(meta.sessionId)
    await writeMeta(meta)
    return new Session(meta, [])
  }

  static async open(sessionId: string): Promise<Session> {
    const meta = await readMeta(sessionId)
    if (!meta) throw new Error(`Session ${sessionId} not found`)
    const events = await readEvents(eventLogPath(sessionId))
    const uiMessages = replay(events)
    return new Session(meta, uiMessages)
  }

  /**
   * Append a complete user message: emits message-start, part-append (text),
   * and message-finish, all to the same event log line by line. Returns the
   * resulting AgentUIMessage.
   */
  async appendUserMessage(text: string): Promise<AgentUIMessage> {
    const messageId = `m_${nanoid(10)}`
    const log = eventLogPath(this.meta.sessionId)
    await writeMessageStart(log, this.uiMessages, {
      messageId,
      role: 'user',
      createdAt: Date.now(),
    })
    await writePartAppend(log, this.uiMessages, {
      messageId,
      part: { type: 'text', text } as any,
    })
    await writeMessageFinish(log, this.uiMessages, { messageId })
    // User messages do NOT touch lastSegmentReason — that field is owned
    // by the segment lifecycle, not by message appends. User input arrives
    // between segments, never as part of one.
    await this.touchMeta(3)
    return this.uiMessages[this.uiMessages.length - 1]
  }

  /**
   * Phase 1 hardcoded assistant reply. Phase 2 replaces this with a real
   * LLM-driven runSegment, but the same write-event pattern still applies.
   *
   * Semantically this IS a (trivial) completed segment — the Phase 1 stub
   * stands in for an LLM tool loop — so it marks lastSegmentReason='natural'
   * via touchMeta's `segmentFinishReason` argument.
   */
  async appendAssistantStubReply(): Promise<AgentUIMessage> {
    const messageId = `m_${nanoid(10)}`
    const log = eventLogPath(this.meta.sessionId)
    await writeMessageStart(log, this.uiMessages, {
      messageId,
      role: 'assistant',
      createdAt: Date.now(),
    })
    await writePartAppend(log, this.uiMessages, {
      messageId,
      part: { type: 'text', text: PHASE1_STUB_REPLY } as any,
    })
    await writeMessageFinish(log, this.uiMessages, { messageId })
    await this.touchMeta(3, 'natural')
    return this.uiMessages[this.uiMessages.length - 1]
  }

  /**
   * Update meta after event-log mutations.
   *
   * `segmentFinishReason` is intentionally optional: only pass it from a
   * code path that genuinely finished a segment (the assistant stub reply
   * today, a real LLM runSegment in Phase 2). User-message appends pass
   * nothing, so `lastSegmentReason` keeps whatever value the most recent
   * real segment left it at. This preserves the invariant that a user
   * can send "continue" after an error without overwriting the error reason.
   */
  private async touchMeta(
    eventsAdded: number,
    segmentFinishReason?: SegmentFinishReason
  ): Promise<void> {
    this.meta.updatedAt = Date.now()
    this.meta.eventLogLength += eventsAdded
    if (segmentFinishReason !== undefined) {
      this.meta.lastSegmentReason = segmentFinishReason
    }
    await writeMeta(this.meta)
  }
}
