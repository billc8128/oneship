import { useState, useEffect, useMemo, CSSProperties } from 'react'
import { Folder, File, ChevronRight, Search, X, ArrowLeft } from 'lucide-react'

interface FileEntry {
  name: string
  type: 'file' | 'directory'
  size: number
  modifiedAt: number
}

interface FilePreview {
  name: string
  path: string
  content: string
  encoding: 'text' | 'image' | 'unsupported' | 'error'
  mimeType?: string
  truncated?: boolean
  errorCode?: 'permission-denied' | 'read-failed'
}

interface FilesPanelProps {
  projectPath: string
  onClose: () => void
  style?: CSSProperties
}

const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.html',
  '.yml', '.yaml', '.toml', '.env', '.gitignore', '.sh', '.py', '.rs',
  '.go', '.sql', '.prisma', '.graphql'
])

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'
])

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot === -1) {
    // Handle extensionless files like .gitignore
    if (filename.startsWith('.')) return filename
    return ''
  }
  return filename.slice(dot).toLowerCase()
}

export function FilesPanel({ projectPath, onClose, style }: FilesPanelProps) {
  const [currentPath, setCurrentPath] = useState(projectPath)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // Reset to project root when projectPath changes
  useEffect(() => {
    setCurrentPath(projectPath)
    setPreview(null)
  }, [projectPath])

  // Read directory contents when path changes
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError('')
    window.electronAPI.fs.readDir(currentPath)
      .then((result) => {
        if (!cancelled) {
          setEntries(result)
          setLoading(false)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setEntries([])
          setLoadError(error instanceof Error ? error.message : 'Unable to read this folder')
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [currentPath])

  // Filter entries by search
  const filtered = useMemo(() => {
    if (!search.trim()) return entries
    const q = search.toLowerCase()
    return entries.filter((e) => e.name.toLowerCase().includes(q))
  }, [entries, search])

  // Breadcrumb segments
  const breadcrumbs = useMemo(() => {
    const segments: Array<{ label: string; path: string }> = []
    const parts = currentPath.split('/')
    // Build cumulative paths
    for (let i = 1; i < parts.length; i++) {
      segments.push({
        label: parts[i],
        path: '/' + parts.slice(1, i + 1).join('/'),
      })
    }
    return segments
  }, [currentPath])

  const navigateTo = (dirName: string) => {
    setSearch('')
    setCurrentPath(currentPath.replace(/\/$/, '') + '/' + dirName)
  }

  const navigateToBreadcrumb = (path: string) => {
    setSearch('')
    setCurrentPath(path)
  }

  const handleFileClick = async (entry: FileEntry) => {
    if (entry.type === 'directory') {
      navigateTo(entry.name)
      return
    }

    const ext = getExtension(entry.name)
    const isText = TEXT_EXTENSIONS.has(ext)
    const isImage = IMAGE_EXTENSIONS.has(ext)

    if (!isText && !isImage) {
      const filePath = currentPath.replace(/\/$/, '') + '/' + entry.name
      window.electronAPI.fs.openInSystem(filePath)
      return
    }

    const filePath = currentPath.replace(/\/$/, '') + '/' + entry.name
    setPreviewLoading(true)

    try {
      const result = await window.electronAPI.fs.readFile(filePath)
      setPreview({
        name: entry.name,
        path: filePath,
        content: result.content,
        encoding: result.encoding,
        mimeType: result.mimeType,
        truncated: result.truncated,
        errorCode: result.errorCode,
      })
    } catch {
      setPreview({
        name: entry.name,
        path: filePath,
        content: 'Failed to read file',
        encoding: 'error',
      })
    } finally {
      setPreviewLoading(false)
    }
  }

  const closePreview = () => {
    setPreview(null)
  }

  const formatSize = (bytes: number) => {
    if (bytes === 0) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="border-l border-border bg-surface flex flex-col shrink-0 overflow-hidden" style={style}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="font-mono text-[10px] font-medium text-light tracking-wider uppercase">
          Files
        </span>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-5 h-5 rounded text-muted hover:text-secondary transition-colors"
        >
          <X size={12} />
        </button>
      </div>

      {preview ? (
        /* Preview state */
        <>
          {/* Back button with filename */}
          <div className="px-3 py-2 border-b border-border">
            <button
              onClick={closePreview}
              className="flex items-center gap-1.5 text-xs font-mono text-muted hover:text-secondary transition-colors"
            >
              <ArrowLeft size={12} />
              <span className="truncate">{preview.name}</span>
            </button>
          </div>

          {/* Preview content */}
          <div className="flex-1 overflow-y-auto">
            {previewLoading ? (
              <div className="px-3 py-4 text-xs text-muted text-center">Loading...</div>
            ) : preview.encoding === 'image' ? (
              <div className="p-3 flex justify-center">
                <img
                  src={`data:${preview.mimeType};base64,${preview.content}`}
                  alt={preview.name}
                  className="max-w-full rounded-lg"
                />
              </div>
            ) : preview.encoding === 'error' ? (
              <div className="px-3 py-4 text-xs text-muted text-center">
                {preview.errorCode === 'permission-denied'
                  ? 'Access denied for this path'
                  : 'Failed to read file'}
              </div>
            ) : (
              <div className="bg-canvas">
                {preview.truncated && (
                  <div className="px-3 py-1.5 text-[10px] text-muted border-b border-border">
                    File truncated (over 100KB). Showing first portion.
                  </div>
                )}
                <pre className="px-3 py-2 font-mono text-[12px] text-espresso whitespace-pre-wrap break-words">
                  {preview.content}
                </pre>
              </div>
            )}
          </div>
        </>
      ) : (
        /* File list state */
        <>
          {/* Breadcrumb with back button */}
          <div className="px-3 py-1.5 border-b border-border overflow-x-auto">
            <div className="flex items-center gap-1 text-[11px] font-mono whitespace-nowrap">
              {currentPath.replace(/\/$/, '') !== projectPath.replace(/\/$/, '') && (
                <button
                  onClick={() => {
                    const parent = currentPath.replace(/\/[^/]+$/, '')
                    if (parent.length >= projectPath.length) {
                      setCurrentPath(parent)
                      setSearch('')
                    }
                  }}
                  className="text-muted hover:text-secondary transition-colors mr-1 shrink-0"
                >
                  <ArrowLeft size={12} />
                </button>
              )}
              {breadcrumbs.map((seg, i) => {
                const isLast = i === breadcrumbs.length - 1
                return (
                  <span key={seg.path} className="flex items-center gap-0.5">
                    {i > 0 && <ChevronRight size={10} className="text-light" />}
                    {isLast ? (
                      <span className="text-secondary">{seg.label}</span>
                    ) : (
                      <button
                        onClick={() => {
                          if (seg.path.length >= projectPath.length) {
                            navigateToBreadcrumb(seg.path)
                          }
                        }}
                        className="text-muted hover:text-secondary transition-colors"
                      >
                        {seg.label}
                      </button>
                    )}
                  </span>
                )
              })}
            </div>
          </div>

          {/* Search */}
          <div className="px-3 py-2 border-b border-border">
            <div className="flex items-center gap-2 bg-canvas border border-border rounded-lg px-2.5 py-1">
              <Search size={12} className="text-muted shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter files..."
                className="flex-1 bg-transparent text-xs text-espresso placeholder:text-muted outline-none font-mono"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="text-muted hover:text-secondary"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          </div>

          {/* File list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="px-3 py-4 text-xs text-muted text-center">Loading...</div>
            ) : loadError ? (
              <div className="px-3 py-4 text-xs text-muted text-center">{loadError}</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted text-center">
                {search ? 'No matching files' : 'Empty directory'}
              </div>
            ) : (
              <div className="py-1">
                {filtered.map((entry) => (
                  <button
                    key={entry.name}
                    onClick={() => handleFileClick(entry)}
                    className="w-full flex items-center gap-2.5 px-3 py-1 text-left transition-colors hover:bg-sand/50 cursor-pointer"
                  >
                    {entry.type === 'directory' ? (
                      <Folder size={14} className="text-muted shrink-0" />
                    ) : (
                      <File size={14} className="text-muted shrink-0" />
                    )}
                    <span className="flex-1 text-xs font-mono text-secondary truncate">
                      {entry.name}
                    </span>
                    {entry.type === 'file' && (
                      <span className="text-[10px] text-light font-mono shrink-0">
                        {formatSize(entry.size)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
