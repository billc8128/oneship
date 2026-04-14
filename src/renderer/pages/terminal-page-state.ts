import { removeSessionRecord, upsertSessionRecord } from '../stores/session-records'

type DeriveUpdateOutcomeArgs = {
  records: SessionRecord[]
  activeId: string
  record: SessionRecord
  urlSessionId?: string
  projectId: string
}

type UpdateOutcome = {
  nextRecords: SessionRecord[]
  nextActiveId: string
  navigateTo: string | null
}

type DeriveRemovalOutcomeArgs = {
  records: SessionRecord[]
  activeId: string
  removedSessionId: string
  urlSessionId?: string
  projectId: string
}

type RemovalOutcome = {
  nextRecords: SessionRecord[]
  nextActiveId: string
  navigateTo: string | null
  removedExisted: boolean
}

export function deriveUpdateOutcome({
  records,
  activeId,
  record,
  urlSessionId,
  projectId,
}: DeriveUpdateOutcomeArgs): UpdateOutcome {
  const nextRecords = upsertSessionRecord(records, record)

  if (activeId) {
    return {
      nextRecords,
      nextActiveId: activeId,
      navigateTo: null,
    }
  }

  if (urlSessionId && record.id === urlSessionId) {
    return {
      nextRecords,
      nextActiveId: urlSessionId,
      navigateTo: null,
    }
  }

  if (record.lifecycle === 'live') {
    return {
      nextRecords,
      nextActiveId: record.id,
      navigateTo: `/project/${projectId}/terminal/${record.id}`,
    }
  }

  return {
    nextRecords,
    nextActiveId: activeId,
    navigateTo: null,
  }
}

export function deriveRemovalOutcome({
  records,
  activeId,
  removedSessionId,
  urlSessionId,
  projectId,
}: DeriveRemovalOutcomeArgs): RemovalOutcome {
  if (!records.some((record) => record.id === removedSessionId)) {
    return {
      nextRecords: records,
      nextActiveId: activeId,
      navigateTo: null,
      removedExisted: false,
    }
  }

  const nextRecords = removeSessionRecord(records, removedSessionId)
  const nextLive = nextRecords.filter((record) => record.lifecycle === 'live')

  if (activeId !== removedSessionId) {
    return {
      nextRecords,
      nextActiveId: activeId,
      navigateTo: null,
      removedExisted: true,
    }
  }

  if (urlSessionId && nextRecords.some((record) => record.id === urlSessionId)) {
    return {
      nextRecords,
      nextActiveId: urlSessionId,
      navigateTo: null,
      removedExisted: true,
    }
  }

  if (nextLive.length > 0) {
    const next = nextLive[0].id
    return {
      nextRecords,
      nextActiveId: next,
      navigateTo: `/project/${projectId}/terminal/${next}`,
      removedExisted: true,
    }
  }

  return {
    nextRecords,
    nextActiveId: '',
    navigateTo: `/project/${projectId}/terminal`,
    removedExisted: true,
  }
}
