import { useEffect, useMemo, useState } from 'react'
import { Badge } from '../components/ui/badge'
import { StatCard } from '../components/ui/stat-card'
import { useProjects } from '../stores/project-store'
import {
  buildProjectActivity,
  getSessionBadgeVariant,
  getSessionStateLabel,
} from '../../shared/session-activity'

function relativeTime(timestampMs: number): string {
  const diff = Date.now() - timestampMs
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function TasksPage() {
  const { projects } = useProjects()
  const [sessions, setSessions] = useState<SessionRecord[]>([])

  useEffect(() => {
    const sync = () => {
      window.electronAPI.session.list().then(setSessions)
    }

    sync()
    const interval = setInterval(sync, 2000)
    return () => clearInterval(interval)
  }, [])

  const summaries = useMemo(() => buildProjectActivity(projects, sessions), [projects, sessions])
  const stats = useMemo(() => summaries.reduce((acc, summary) => ({
    liveTerminals: acc.liveTerminals + summary.liveTerminals,
    waitingTerminals: acc.waitingTerminals + summary.waitingTerminals,
    workingTerminals: acc.workingTerminals + summary.workingTerminals,
    projectsWithActivity: acc.projectsWithActivity + (summary.sessions.length > 0 ? 1 : 0),
  }), {
    liveTerminals: 0,
    waitingTerminals: 0,
    workingTerminals: 0,
    projectsWithActivity: 0,
  }), [summaries])

  return (
    <div className="p-8">
      <h1 className="font-heading text-2xl font-bold text-espresso mb-6">Activity</h1>

      <div className="flex gap-4 mb-8">
        <StatCard label="Projects With Activity" value={String(stats.projectsWithActivity)} unit={`${projects.length} total`} />
        <StatCard label="Live Terminals" value={String(stats.liveTerminals)} unit={`${stats.waitingTerminals} waiting`} unitColor="text-danger" />
        <StatCard label="Working" value={String(stats.workingTerminals)} />
      </div>

      {projects.length === 0 ? (
        <div className="bg-surface rounded-xl px-5 py-8 shadow-card text-center">
          <p className="font-body text-sm text-muted">No projects yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {summaries.map((summary) => (
            <div key={summary.project.id} className="bg-surface rounded-xl shadow-card overflow-hidden">
              <div className="px-5 py-4 border-b border-border">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-heading text-base font-semibold text-espresso truncate">{summary.project.name}</h2>
                    <p className="font-mono text-[11px] text-light mt-1">
                      {summary.lastActivityAt ? `Last activity ${relativeTime(summary.lastActivityAt)}` : 'No session activity yet'}
                    </p>
                  </div>
                  <Badge variant={summary.project.status === 'active' ? 'active' : summary.project.status === 'done' ? 'done' : 'planning'}>
                    {summary.project.status}
                  </Badge>
                </div>
              </div>

              <div className="px-5 py-4 border-b border-border grid grid-cols-3 gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-light">Live</p>
                  <p className="font-heading text-2xl text-espresso mt-1">{summary.liveTerminals}</p>
                </div>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-light">Working</p>
                  <p className="font-heading text-2xl text-espresso mt-1">{summary.workingTerminals}</p>
                </div>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-light">Waiting</p>
                  <p className="font-heading text-2xl text-espresso mt-1">{summary.waitingTerminals}</p>
                </div>
              </div>

              <div className="px-5 py-4">
                <p className="font-mono text-[10px] font-medium text-light tracking-wider uppercase mb-3">Live Now</p>
                {summary.activeSessions.length === 0 ? (
                  <p className="font-body text-sm text-muted">No live sessions.</p>
                ) : (
                  <div className="space-y-2">
                    {summary.activeSessions.slice(0, 4).map((session) => {
                      const isWaiting = session.lastStatus === 'waiting'
                      const dotSize = isWaiting ? 'w-2.5 h-2.5' : 'w-2 h-2'
                      const dotClass =
                        isWaiting
                          ? 'bg-danger ring-2 ring-danger/40 animate-pulse'
                          : session.lastStatus === 'working'
                            ? 'bg-amber-400 animate-pulse'
                            : session.lastStatus === 'error'
                              ? 'bg-danger'
                              : 'bg-success'
                      return (
                      <div key={session.id} className="flex items-center gap-3">
                        <span className={`${dotSize} rounded-full shrink-0 ${dotClass}`} />
                        <div className="flex-1 min-w-0">
                          <p className="font-body text-sm text-espresso truncate">{session.label}</p>
                          <p className="font-mono text-[11px] text-light mt-0.5">
                            {relativeTime(session.updatedAt)}
                          </p>
                        </div>
                        <Badge variant={getSessionBadgeVariant(session)}>{getSessionStateLabel(session)}</Badge>
                      </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="px-5 py-4 border-t border-border">
                <p className="font-mono text-[10px] font-medium text-light tracking-wider uppercase mb-3">History</p>
                {summary.historySessions.length === 0 ? (
                  <p className="font-body text-sm text-muted">No terminal history yet.</p>
                ) : (
                  <div className="space-y-2">
                    {summary.historySessions.map((session) => (
                      <div key={session.id} className="flex items-center gap-3">
                        <span className="w-2 h-2 rounded-full bg-light shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-body text-sm text-muted truncate">{session.label}</p>
                          <p className="font-mono text-[11px] text-light mt-0.5">
                            {getSessionKindLabel(session)} / {session.lastEventSummary || 'No hook activity'} / {relativeTime(session.updatedAt)}
                          </p>
                        </div>
                        <Badge variant={getSessionBadgeVariant(session)}>{getSessionStateLabel(session)}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
