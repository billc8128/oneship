import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface ClonePlan {
  cloneUrl: string
  destinationParent: string
  repoName: string
  targetPath: string
}

function parseRepoName(cloneUrl: string): string {
  const trimmed = cloneUrl.trim().replace(/\/$/, '')
  const lastSegment = trimmed.split(/[:/]/).pop()?.replace(/\.git$/, '') ?? ''

  if (!lastSegment) {
    throw new Error('Unable to determine repository name from clone URL')
  }

  return lastSegment
}

function targetExists(pathValue: string): boolean {
  if (!existsSync(pathValue)) {
    return false
  }

  return true
}

export function planCloneProject(input: {
  cloneUrl: string
  destinationParent: string
}): ClonePlan {
  const cloneUrl = input.cloneUrl.trim()
  const destinationParent = input.destinationParent.trim()

  if (!cloneUrl) {
    throw new Error('Clone URL is required')
  }

  if (!destinationParent) {
    throw new Error('Destination folder is required')
  }

  const repoName = parseRepoName(cloneUrl)
  const targetPath = join(destinationParent, repoName)

  if (targetExists(targetPath)) {
    if (!statSync(targetPath).isDirectory()) {
      throw new Error(`Clone target already exists: ${targetPath}`)
    }

    const hasContents = readdirSync(targetPath).length > 0
    if (hasContents) {
      throw new Error(`Clone target already exists: ${targetPath}`)
    }
  }

  return {
    cloneUrl,
    destinationParent,
    repoName,
    targetPath,
  }
}
