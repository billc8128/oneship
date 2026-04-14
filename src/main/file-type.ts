import { basename, extname } from 'node:path'

const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.html',
  '.yml', '.yaml', '.toml', '.env', '.gitignore', '.sh', '.py', '.rs',
  '.go', '.sql', '.prisma', '.graphql', '.c', '.cc', '.cpp', '.cxx',
  '.h', '.hh', '.hpp', '.java', '.xml',
])

const TEXT_FILENAMES = new Set([
  '.env',
  '.gitignore',
  '.dockerignore',
  '.editorconfig',
  '.npmrc',
  'dockerfile',
  'makefile',
])

const IMAGE_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
}

export type FileKind = 'text' | 'image' | 'unsupported'

export function getNormalizedExtension(filePath: string): string {
  const name = basename(filePath).toLowerCase()

  if (TEXT_FILENAMES.has(name)) {
    return name
  }

  if (name.startsWith('.env.')) {
    return '.env'
  }

  if (name.startsWith('.') && !name.slice(1).includes('.')) {
    return name
  }

  return extname(name).toLowerCase()
}

export function getFileKind(filePath: string): FileKind {
  const extension = getNormalizedExtension(filePath)

  if (TEXT_EXTENSIONS.has(extension)) {
    return 'text'
  }

  if (extension in IMAGE_EXTENSIONS) {
    return 'image'
  }

  return 'unsupported'
}

export function getImageMimeType(filePath: string): string | undefined {
  const extension = getNormalizedExtension(filePath)
  return IMAGE_EXTENSIONS[extension]
}
