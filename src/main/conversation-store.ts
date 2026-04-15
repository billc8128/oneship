import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { runtimePaths } from './runtime-paths'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface Conversation {
  id: string
  projectId: string | null
  messages: Message[]
  createdAt: number
  updatedAt: number
}

const GE_DIR = '.oneship'
const CONVERSATIONS_DIR = 'conversations'

function chiefConversationsDir(): string {
  const dir = join(runtimePaths().globalState, CONVERSATIONS_DIR)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function projectConversationsDir(projectPath: string): string {
  const dir = join(projectPath, GE_DIR, CONVERSATIONS_DIR)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function conversationFile(projectPath: string | null, conversationId: string): string {
  const dir = projectPath ? projectConversationsDir(projectPath) : chiefConversationsDir()
  return join(dir, `${conversationId}.json`)
}

export function loadConversation(
  projectPath: string | null,
  conversationId: string
): Conversation | null {
  try {
    const file = conversationFile(projectPath, conversationId)
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

export function saveConversation(
  projectPath: string | null,
  conversation: Conversation
): void {
  try {
    const file = conversationFile(projectPath, conversation.id)
    writeFileSync(file, JSON.stringify(conversation, null, 2))
  } catch (e) {
    console.error('Failed to save conversation:', e)
  }
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function getOrCreateConversation(
  projectPath: string | null,
  projectId: string | null
): Conversation {
  // Use a deterministic conversation ID based on the project
  const conversationId = projectId ? `project-${projectId}` : 'chief-agent'

  const existing = loadConversation(projectPath, conversationId)
  if (existing) return existing

  const now = Date.now()
  const conversation: Conversation = {
    id: conversationId,
    projectId,
    messages: [],
    createdAt: now,
    updatedAt: now
  }

  saveConversation(projectPath, conversation)
  return conversation
}

export function addMessage(
  conversation: Conversation,
  role: 'user' | 'assistant',
  content: string
): Message {
  const message: Message = {
    id: generateId(),
    role,
    content,
    timestamp: Date.now()
  }
  conversation.messages.push(message)
  conversation.updatedAt = Date.now()
  return message
}
