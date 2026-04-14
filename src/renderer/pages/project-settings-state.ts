export function appendRepositoryDraft(repositories: string[], draft: string): string[] | null {
  const trimmed = draft.trim()
  if (!trimmed) {
    return null
  }

  return [...repositories, trimmed]
}
