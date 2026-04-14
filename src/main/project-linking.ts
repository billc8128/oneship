import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { initProjectDir, saveProjectData, type ProjectData } from './project-store'

const ONESHIP_DIR = '.oneship'
const CONVERSATIONS_DIR = 'conversations'

export interface LinkProjectWorkspaceResult {
  migratedConversation: boolean
  conversationPath: string
  projectDataPath: string
}

function conversationFilename(projectId: string): string {
  return `project-${projectId}.json`
}

export function linkProjectWorkspace(input: {
  projectId: string
  nextPath: string
  globalStateDir: string
  projectData: ProjectData
}): LinkProjectWorkspaceResult {
  initProjectDir(input.nextPath)
  saveProjectData(input.nextPath, input.projectData)

  const sourceConversationPath = join(
    input.globalStateDir,
    CONVERSATIONS_DIR,
    conversationFilename(input.projectId),
  )
  const targetConversationPath = join(
    input.nextPath,
    ONESHIP_DIR,
    CONVERSATIONS_DIR,
    conversationFilename(input.projectId),
  )

  let migratedConversation = false

  if (existsSync(sourceConversationPath) && sourceConversationPath !== targetConversationPath) {
    mkdirSync(dirname(targetConversationPath), { recursive: true })

    if (!existsSync(targetConversationPath)) {
      try {
        renameSync(sourceConversationPath, targetConversationPath)
        migratedConversation = true
      } catch (error) {
        const targetNowExists = existsSync(targetConversationPath)

        if (!targetNowExists) {
          throw error
        }
      }
    }
  }

  return {
    migratedConversation,
    conversationPath: targetConversationPath,
    projectDataPath: join(input.nextPath, ONESHIP_DIR, 'project.json'),
  }
}
