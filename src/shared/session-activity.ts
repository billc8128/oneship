export interface ActivityProjectLike {
  id: string
  name: string
  status: 'active' | 'planning' | 'done'
  path: string | null
  createdAt: number
}

export interface ActivitySessionLike {
  id: string
  projectId: string
  cwd: string
  shell: string
  label: string
  createdAt: number
  updatedAt: number
  lifecycle: 'live' | 'closed' | 'exited' | 'crashed' | 'interrupted'
  lastStatus: 'idle' | 'working' | 'waiting' | 'done' | 'error'
  lastEventSummary: string
  source?: string | null
  lastHookName?: string | null
  lastToolName?: string | null
}

export interface ProjectActivitySummary {
  project: ActivityProjectLike
  sessions: ActivitySessionLike[]
  activeSessions: ActivitySessionLike[]
  historySessions: ActivitySessionLike[]
  liveTerminals: number
  waitingTerminals: number
  workingTerminals: number
  lastActivityAt: number | null
}

export function getSessionBadgeVariant(session: ActivitySessionLike): 'running' | 'planning' | 'active' | 'done' {
  if (session.lifecycle !== 'live') {
    return 'done'
  }

  if (session.lastStatus === 'working') {
    return 'running'
  }

  if (session.lastStatus === 'waiting') {
    return 'planning'
  }

  return 'active'
}

export function getSessionStateLabel(session: ActivitySessionLike): string {
  if (session.lifecycle !== 'live') {
    return session.lifecycle
  }

  if (session.lastStatus === 'working') {
    return 'working'
  }

  if (session.lastStatus === 'waiting') {
    return 'waiting'
  }

  if (session.lastStatus === 'error') {
    return 'error'
  }

  if (session.lastStatus === 'done') {
    return 'done'
  }

  return 'idle'
}

export function buildProjectActivity(
  projects: ActivityProjectLike[],
  sessions: ActivitySessionLike[],
): ProjectActivitySummary[] {
  return projects
    .map((project) => {
      const projectSessions = sessions
        .filter((session) => session.projectId === project.id)
        .sort((left, right) => right.updatedAt - left.updatedAt)

      const activeSessions = projectSessions.filter((session) => session.lifecycle === 'live')
      const historySessions = projectSessions
        .filter((session) => session.lifecycle !== 'live')

      return {
        project,
        sessions: projectSessions,
        activeSessions,
        historySessions,
        liveTerminals: activeSessions.length,
        waitingTerminals: activeSessions.filter((session) => session.lastStatus === 'waiting').length,
        workingTerminals: activeSessions.filter((session) => session.lastStatus === 'working').length,
        lastActivityAt: projectSessions[0]?.updatedAt ?? null,
      }
    })
    .sort((left, right) => {
      const rightTime = right.lastActivityAt ?? right.project.createdAt
      const leftTime = left.lastActivityAt ?? left.project.createdAt
      return rightTime - leftTime
    })
}
