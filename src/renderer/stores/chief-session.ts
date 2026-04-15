import { useEffect, useRef, useState, useCallback } from 'react'
import type { ToMain, ToWorker, SessionMeta, AgentUIMessage } from '../../shared/agent-protocol'

interface ChiefSessionState {
  status: 'booting' | 'idle' | 'sending' | 'error'
  activeSessionId: string | null
  uiMessages: AgentUIMessage[]
  knownSessions: SessionMeta[]
  error: string | null
}

const INITIAL: ChiefSessionState = {
  status: 'booting',
  activeSessionId: null,
  uiMessages: [],
  knownSessions: [],
  error: null,
}

export function useChiefSession() {
  const [state, setState] = useState<ChiefSessionState>(INITIAL)
  const stateRef = useRef(state)
  stateRef.current = state

  // Per-mount guard against React Strict Mode's double-invocation of effects
  // in dev. Strict Mode runs: mount → effect → cleanup → effect again, with
  // state and refs PRESERVED across the two effect runs (the whole point of
  // the double-invocation is to verify effect idempotency, not to reset
  // state). So a ref initialized to `false` here survives to the second
  // effect call and gates the bootstrap.
  //
  // Critically, this ref is PER REACT COMPONENT INSTANCE — unlike a module-
  // level flag. When the user navigates away from /chief and back, React
  // mounts a FRESH ChiefChat component with a FRESH useChiefSession hook
  // with a FRESH ref, so bootstrap re-runs correctly on return visits.
  // (A module-level flag would break remounts.)
  const bootstrappedRef = useRef(false)

  // Single rejection-handling funnel for every ToWorker message the hook
  // sends via the chief IPC. The Main-side `chief:send` handler throws
  // when AgentHost has no live worker (initial startup failure, or gate
  // exhaustion after repeated post-ready crashes). Without catching here,
  // the rejection becomes an unhandled promise rejection AND leaves any
  // state transitions that initiated the send (e.g. the `sending` flip
  // in sendUserMessage, or the `booting` initial state for bootstrap)
  // permanently stuck.
  //
  // All four send sites in this hook go through this helper:
  //   - initial `list-sessions` (bootstrap)
  //   - `create-session` on empty disk
  //   - `open-session` on non-empty disk
  //   - `send-user-message` from sendUserMessage
  //
  // `transitionOnFail` is the optional setState callback the caller
  // specifies to keep the UI consistent when a send fails. Defaults to a
  // plain status='error' + error message flip.
  const guardedSend = useCallback(
    (message: ToWorker, transitionOnFail?: (s: ChiefSessionState, errMsg: string) => ChiefSessionState) => {
      window.electronAPI.chief.send(message).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        setState((s) => {
          if (transitionOnFail) return transitionOnFail(s, msg)
          return { ...s, status: 'error', error: msg }
        })
      })
    },
    []
  )

  useEffect(() => {
    const api = window.electronAPI.chief
    const unsubscribe = api.onEvent((message: ToMain) => {
      switch (message.type) {
        case 'session-list': {
          setState((s) => ({ ...s, knownSessions: message.sessions }))
          // Only bootstrap if we have no active session yet. After the first
          // session-list response acts (creates or opens), subsequent
          // session-list responses (from explicit listSessions calls or
          // duplicate Strict Mode bootstraps) are passively reflected in
          // knownSessions and don't trigger a second create/open.
          if (stateRef.current.activeSessionId !== null) break
          if (message.sessions.length === 0) {
            // No sessions on disk — create a fresh interactive one.
            const sessionId = `s_${Date.now().toString(36)}`
            guardedSend({ type: 'create-session', sessionId })
          } else {
            const top = message.sessions[0]
            guardedSend({ type: 'open-session', sessionId: top.sessionId })
          }
          break
        }
        case 'session-created': {
          // Worker also sends session-opened immediately after.
          break
        }
        case 'session-opened': {
          setState((s) => ({
            ...s,
            status: 'idle',
            activeSessionId: message.sessionId,
            uiMessages: message.snapshot.uiMessages,
          }))
          break
        }
        case 'message-complete': {
          setState((s) => {
            if (s.activeSessionId !== message.sessionId) return s
            // Replace if a message with the same id already exists, otherwise append
            const idx = s.uiMessages.findIndex((m) => m.id === message.message.id)
            const next = [...s.uiMessages]
            if (idx >= 0) next[idx] = message.message
            else next.push(message.message)
            return { ...s, uiMessages: next }
          })
          break
        }
        case 'segment-finished': {
          setState((s) => {
            if (s.activeSessionId !== message.sessionId) return s
            return {
              ...s,
              status: message.reason === 'error' ? 'error' : 'idle',
              error: message.reason === 'error' ? (message.error ?? 'Unknown error') : null,
            }
          })
          break
        }
        case 'worker-unavailable': {
          // The agent worker has crashed repeatedly and the respawn gate
          // has exhausted. Any in-flight `sending` states will never get
          // a segment-finished — surface the failure directly so the user
          // isn't left staring at a disabled input. Applies to all sessions
          // since worker failure is global.
          setState((s) => ({
            ...s,
            status: 'error',
            error: message.reason,
          }))
          break
        }
        default:
          break
      }
    })

    // Initial bootstrap. The `bootstrappedRef` guard prevents React Strict
    // Mode's double-invocation in dev from sending list-sessions twice
    // (which otherwise creates an orphan empty session on a clean disk
    // because both responses arrive before the first create-session is
    // reflected in disk state). The ref is per React component instance,
    // so a fresh mount (e.g. navigating away from /chief and back) does
    // bootstrap again. Bootstrap goes through guardedSend so a rejection
    // (e.g. worker already exhausted by a prior crash storm before this
    // mount) lands in the error state instead of leaving the UI stuck
    // in 'booting' forever.
    if (!bootstrappedRef.current) {
      bootstrappedRef.current = true
      guardedSend({ type: 'list-sessions' })
    }

    return () => unsubscribe()
  }, [guardedSend])

  const sendUserMessage = useCallback(
    (text: string) => {
      const sessionId = stateRef.current.activeSessionId
      if (!sessionId) return
      // If the hook is already in 'error' state (worker unavailable), refuse
      // to start a new send — the input is disabled in Chief chat but this
      // is a defense against direct store callers in other contexts.
      if (stateRef.current.status === 'error') return
      setState((s) => ({ ...s, status: 'sending' }))
      // guardedSend handles the IPC rejection by flipping to 'error' with
      // the message. The user's 'sending' transition is visible briefly
      // in the failure path, then overwritten to 'error' — that's fine.
      guardedSend({ type: 'send-user-message', sessionId, content: text })
    },
    [guardedSend]
  )

  return { ...state, sendUserMessage }
}
