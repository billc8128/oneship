import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { TerminalTabs, type TerminalTab } from '../components/terminal/terminal-tabs'
import { TerminalView } from '../components/terminal/terminal-view'
import { ConfirmDialog } from '../components/modals/confirm-dialog'
import { useProjects } from '../stores/project-store'
import { useToast } from '../stores/toast-store'
import { destroyTerminalView } from '../stores/terminal-view-store'
import { orderTerminalSessionsForDisplay } from '../stores/session-records'
import { deriveRemovalOutcome, deriveUpdateOutcome } from './terminal-page-state'

const SESSION_SYNC_INTERVAL_MS = 15_000

export function TerminalPage() {
  const { projectId = 'default', sessionId: urlSessionId } = useParams()
  const navigate = useNavigate()
  const { projects } = useProjects()
  const { show: showToast } = useToast()
  const project = projects.find(p => p.id === projectId)
  const [records, setRecords] = useState<SessionRecord[]>([])
  const [activeId, setActiveId] = useState<string>('')
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null)
  const initializedRef = useRef(false)
  const recordsRef = useRef<SessionRecord[]>([])
  const activeIdRef = useRef<string>('')
  // Tracks sessions the user just explicitly killed, so the passive-exit
  // detector in onUpdated doesn't show a surprise toast for something the
  // user already confirmed closing. Entries are removed after the event
  // that cleared them is handled.
  const userKilledRef = useRef<Set<string>>(new Set())

  // Every write to records/activeId must go through these helpers. Writing
  // the ref before setState guarantees that any IPC callback that fires
  // between state batches observes the just-written value, not a stale
  // snapshot. Do NOT call setRecords / setActiveId directly anywhere in
  // this component.
  const commitRecords = useCallback((next: SessionRecord[]) => {
    recordsRef.current = next
    setRecords(next)
  }, [])

  const commitActiveId = useCallback((next: string) => {
    activeIdRef.current = next
    setActiveId(next)
  }, [])

  const liveTabs: TerminalTab[] = orderTerminalSessionsForDisplay(
    records.filter((record) => record.lifecycle === 'live'),
  )
    .map((record) => ({
      id: record.id,
      label: record.label,
    }))

  const activeRecord = records.find((record) => record.id === activeId)

  const syncRecords = useCallback(async () => {
    const nextRecords = await window.electronAPI.session.list(projectId)
    commitRecords(nextRecords)
    return nextRecords
  }, [projectId, commitRecords])

  const createTerminal = useCallback(async () => {
    const cwd = project?.path || window.electronAPI?.homeDir || '~'
    const sessionId = await window.electronAPI.terminal.create(projectId, cwd)
    await syncRecords()
    commitActiveId(sessionId)
    navigate(`/project/${projectId}/terminal/${sessionId}`, { replace: true })
    return sessionId
  }, [projectId, project?.path, navigate, syncRecords, commitActiveId])

  const closeTerminal = useCallback((id: string) => {
    // Don't kill immediately — show a confirmation dialog first. The actual
    // kill + state update happens in performClose once the user confirms.
    setPendingCloseId(id)
  }, [])

  const performClose = useCallback((id: string) => {
    // Mark this session as user-killed BEFORE issuing the kill, so the
    // session:updated event that follows (main patches lifecycle=closed)
    // won't trigger a passive-exit toast in onUpdated. All subsequent
    // state transitions — records removal, activeId fallback, navigation
    // — are driven by the session:updated -> session:removed event chain,
    // not by a direct session.list poll from here.
    userKilledRef.current.add(id)
    window.electronAPI.terminal.kill(id)
  }, [])

  const pendingCloseRecord = pendingCloseId
    ? records.find((record) => record.id === pendingCloseId)
    : null

  const renameTerminal = useCallback(async (id: string, newLabel: string) => {
    await window.electronAPI.session.rename(id, newLabel)
    const next = recordsRef.current.map((record) => (
      record.id === id ? { ...record, label: newLabel, updatedAt: Date.now() } : record
    ))
    commitRecords(next)
  }, [commitRecords])

  const handleSelect = useCallback((id: string) => {
    commitActiveId(id)
    navigate(`/project/${projectId}/terminal/${id}`, { replace: true })
  }, [projectId, navigate, commitActiveId])

  // Listen for keyboard shortcuts from the main process
  useEffect(() => {
    const unsubscribe = window.electronAPI.onShortcut((action) => {
      if (action === 'new-terminal') createTerminal()
      if (action === 'close-terminal' && activeId) closeTerminal(activeId)
      if (action.startsWith('switch-terminal-')) {
        const index = parseInt(action.split('-')[2]) - 1
        if (liveTabs[index]) handleSelect(liveTabs[index].id)
      }
    })
    return unsubscribe
  }, [createTerminal, closeTerminal, activeId, liveTabs, handleSelect])

  // If URL has a sessionId, set it as active when tabs load
  useEffect(() => {
    if (urlSessionId && records.length > 0) {
      const found = records.find((record) => record.id === urlSessionId)
      if (found && activeId !== urlSessionId) {
        commitActiveId(urlSessionId)
      }
    }
  }, [urlSessionId, records, activeId, commitActiveId])

  // Load existing sessions from backend on mount, then create if needed
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    syncRecords().then((nextRecords) => {
      const liveRecords = nextRecords.filter((record) => record.lifecycle === 'live')
      if (liveRecords.length > 0) {
        const target = urlSessionId && nextRecords.some((record) => record.id === urlSessionId)
          ? urlSessionId
          : liveRecords[0].id
        commitActiveId(target)
        navigate(`/project/${projectId}/terminal/${target}`, { replace: true })
      } else if (urlSessionId && nextRecords.some((record) => record.id === urlSessionId)) {
        commitActiveId(urlSessionId)
      } else if (!urlSessionId) {
        createTerminal()
      }
    })
  }, [projectId, urlSessionId, createTerminal, navigate, syncRecords, commitActiveId])

  useEffect(() => {
    // urlSessionId stays in the dependency array so callbacks observe the
    // latest route selection. This causes a brief resubscribe during user-
    // driven tab navigation, but that churn is acceptable because it is
    // route-driven and far less frequent than state-driven resubscribe
    // churn. records/activeId deliberately stay out — callbacks read them
    // from refs so the listener lifetime is stable across state updates.
    const unsubscribeRemoved = window.electronAPI.session.onRemoved((sessionId) => {
      const outcome = deriveRemovalOutcome({
        records: recordsRef.current,
        activeId: activeIdRef.current,
        removedSessionId: sessionId,
        urlSessionId,
        projectId,
      })

      if (!outcome.removedExisted) {
        return
      }

      commitRecords(outcome.nextRecords)
      commitActiveId(outcome.nextActiveId)

      destroyTerminalView(sessionId)

      if (outcome.navigateTo) {
        navigate(outcome.navigateTo, { replace: true })
      }
    })

    const unsubscribeUpdated = window.electronAPI.session.onUpdated((record) => {
      if (record.projectId !== projectId) {
        return
      }

      // Detect passive exit: a session we knew as live just transitioned to
      // a non-live lifecycle without us asking (PTY crashed, Claude CLI
      // exited itself, etc.). Show a toast so the user isn't left wondering
      // why a tab vanished, then forget the session on the main side so it
      // doesn't linger in the store as a zombie. Skip the toast if the user
      // themselves initiated this close via performClose (we confirmed it
      // already — no surprise).
      const previous = recordsRef.current.find((r) => r.id === record.id)
      const wasLive = previous?.lifecycle === 'live'
      const isNonLive = record.lifecycle !== 'live'
      if (wasLive && isNonLive) {
        const userKilled = userKilledRef.current.has(record.id)
        userKilledRef.current.delete(record.id)
        if (!userKilled) {
          const verb =
            record.lifecycle === 'crashed'
              ? 'crashed'
              : record.lifecycle === 'interrupted'
                ? 'was interrupted'
                : 'exited'
          showToast(
            `${record.label} ${verb}`,
            record.lifecycle === 'crashed' ? 'danger' : 'warning',
          )
        }
        window.electronAPI.session.remove(record.id).catch(() => {})
        // Let the follow-up session:removed event drive the actual state
        // transition (records removal, activeId fallback, navigation).
        return
      }

      const outcome = deriveUpdateOutcome({
        records: recordsRef.current,
        activeId: activeIdRef.current,
        record,
        urlSessionId,
        projectId,
      })

      commitRecords(outcome.nextRecords)
      commitActiveId(outcome.nextActiveId)

      if (outcome.navigateTo) {
        navigate(outcome.navigateTo, { replace: true })
      }
    })

    return () => {
      unsubscribeRemoved()
      unsubscribeUpdated()
    }
  }, [projectId, urlSessionId, navigate, commitRecords, commitActiveId, showToast])

  // Keep a low-frequency backend sync as a safety net in case session update events are missed.
  useEffect(() => {
    const sync = () => {
      window.electronAPI.session.list(projectId).then((nextRecords) => {
        commitRecords(nextRecords)
        const liveRecords = nextRecords.filter((record) => record.lifecycle === 'live')
        const liveIds = new Set(liveRecords.map((record) => record.id))
        const current = activeIdRef.current

        if (current && liveIds.has(current)) {
          return
        }
        if (current && nextRecords.some((record) => record.id === current && record.lifecycle !== 'live')) {
          return
        }
        if (urlSessionId && nextRecords.some((record) => record.id === urlSessionId)) {
          commitActiveId(urlSessionId)
          return
        }
        if (liveRecords.length > 0) {
          const next = liveRecords[0].id
          commitActiveId(next)
          navigate(`/project/${projectId}/terminal/${next}`, { replace: true })
          return
        }
        if (!current) {
          commitActiveId('')
          return
        }
        commitActiveId('')
        navigate(`/project/${projectId}/terminal`, { replace: true })
      })
    }
    const interval = setInterval(sync, SESSION_SYNC_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [projectId, navigate, urlSessionId, commitRecords, commitActiveId])

  useEffect(() => {
    for (const record of records) {
      if (record.lifecycle !== 'live') {
        destroyTerminalView(record.id)
      }
    }
  }, [records])

  return (
    <div className="flex flex-col h-full">
      <TerminalTabs
        tabs={liveTabs}
        activeId={activeRecord?.lifecycle === 'live' ? activeId : ''}
        onSelect={handleSelect}
        onClose={closeTerminal}
        onCreate={createTerminal}
        onRename={renameTerminal}
      />

      <div className="flex-1 bg-canvas relative overflow-hidden">
        {liveTabs.length === 0 ? (
          <div className="flex-1 flex items-center justify-center h-full">
            <p className="font-body text-sm text-muted">No terminal sessions</p>
          </div>
        ) : activeRecord && activeRecord.lifecycle === 'live' ? (
          <TerminalView
            key={activeRecord.id}
            sessionId={activeRecord.id}
            isActive={true}
          />
        ) : null}
      </div>

      <ConfirmDialog
        open={pendingCloseId !== null}
        title="Close Terminal?"
        message={
          pendingCloseRecord
            ? `Closing "${pendingCloseRecord.label}" will kill its process. This cannot be undone.`
            : 'Closing this terminal will kill its process. This cannot be undone.'
        }
        confirmLabel="Close"
        variant="danger"
        onCancel={() => setPendingCloseId(null)}
        onConfirm={() => {
          if (pendingCloseId) performClose(pendingCloseId)
          setPendingCloseId(null)
        }}
      />
    </div>
  )
}
