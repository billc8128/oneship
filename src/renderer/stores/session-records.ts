export function upsertSessionRecord(records: SessionRecord[], record: SessionRecord): SessionRecord[] {
  return [...records.filter((existing) => existing.id !== record.id), record]
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

export function orderTerminalSessionsForDisplay(records: SessionRecord[]): SessionRecord[] {
  return [...records].sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return left.createdAt - right.createdAt
    }

    if (left.updatedAt !== right.updatedAt) {
      return left.updatedAt - right.updatedAt
    }

    return left.id.localeCompare(right.id)
  })
}

export function removeSessionRecord(records: SessionRecord[], sessionId: string): SessionRecord[] {
  return records.filter((record) => record.id !== sessionId)
}
