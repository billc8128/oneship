import { resolve, sep } from 'node:path'

function normalize(pathValue: string): string {
  return resolve(pathValue)
}

export function isPathInsideRoots(targetPath: string, roots: string[]): boolean {
  const normalizedTarget = normalize(targetPath)

  return roots.some((root) => {
    const normalizedRoot = normalize(root)
    return (
      normalizedTarget === normalizedRoot ||
      normalizedTarget.startsWith(normalizedRoot + sep)
    )
  })
}

export function assertPathAllowed(targetPath: string, roots: string[]): void {
  if (!isPathInsideRoots(targetPath, roots)) {
    throw new Error(`Path is outside allowed roots: ${targetPath}`)
  }
}
