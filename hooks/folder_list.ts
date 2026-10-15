export const RECENT_FOLDER_LIMIT = 100

export function joinWindowsPath(...parts: string[]): string {
  return parts.map(part => part.replace(/[\\/]+$/, '')).join('\\')
}

// Claude Code names each project folder after the working directory with every
// character outside [A-Za-z0-9] replaced by '-'.
export function projectDirectoryName(workingDirectory: string): string {
  return workingDirectory.replace(/[^a-zA-Z0-9]/g, '-')
}

const ELLIPSIS = '\u2026'
// East Asian wide characters take two columns.
const WIDE_CHARACTER =
  /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/

function isWindowsPath(folder: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(folder) || /^[\\/]{2}[^\\/]/.test(folder)
}

export function isAbsoluteFolder(folder: string): boolean {
  return isWindowsPath(folder) || folder.startsWith('/')
}

export function displayWidth(text: string): number {
  let width = 0
  for (const character of text) {
    width += WIDE_CHARACTER.test(character) ? 2 : 1
  }

  return width
}

// Keeps the end of the text behind an ellipsis.
function keepEndWithinWidth(text: string, maxWidth: number): string {
  if (displayWidth(text) <= maxWidth) {
    return text
  }
  const characters = [...text]
  let kept = ''
  let width = displayWidth(ELLIPSIS)
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index] ?? ''
    const characterWidth = displayWidth(character)
    if (width + characterWidth > maxWidth) {
      break
    }
    kept = character + kept
    width += characterWidth
  }

  return ELLIPSIS + kept
}

// Shortens a path to the width by dropping its middle folders: the drive (or
// share) and as many trailing folders as fit stay, `E:\…\Projects\Chemistry`.
export function compressPath(path: string, maxWidth: number): string {
  if (displayWidth(path) <= maxWidth) {
    return path
  }
  const separator = path.includes('\\') ? '\\' : '/'
  const segments = path.split(separator)
  const headCount = path.startsWith(separator + separator) ? 4 : 1
  const head = segments.slice(0, headCount).join(separator)
  const rest = segments.slice(headCount).filter(segment => segment !== '')
  let tail = ''
  for (let index = rest.length - 1; index >= 0; index -= 1) {
    const candidateTail = tail === '' ? (rest[index] ?? '') : `${rest[index] ?? ''}${separator}${tail}`
    if (displayWidth(`${head}${separator}${ELLIPSIS}${separator}${candidateTail}`) > maxWidth) {
      break
    }
    tail = candidateTail
  }
  if (tail !== '') {
    return `${head}${separator}${ELLIPSIS}${separator}${tail}`
  }

  return keepEndWithinWidth(path, maxWidth)
}

// Windows paths are written with backslashes, an upper-case drive letter and
// no trailing separator (a drive root keeps its own).
export function normalizeFolder(folder: string): string {
  const trimmed = folder.trim()
  if (!isWindowsPath(trimmed)) {
    return trimmed.length > 1 ? trimmed.replace(/\/+$/, '') : trimmed
  }
  const backslashed = trimmed
    .replace(/\//g, '\\')
    .replace(/^([a-z]):/, (_match, drive: string) => `${drive.toUpperCase()}:`)

  return /^[A-Z]:\\$/.test(backslashed) ? backslashed : backslashed.replace(/\\+$/, '')
}

// Two spellings of one Windows folder differ only in case.
export function folderIdentity(folder: string): string {
  const normalized = normalizeFolder(folder)

  return isWindowsPath(normalized) ? normalized.toLowerCase() : normalized
}

export function folderName(folder: string): string {
  const normalized = normalizeFolder(folder)
  const parts = normalized.split(/[\\/]/).filter(part => part !== '')

  return parts.at(-1) ?? normalized
}

// The folder holding this one; empty for a drive or file-system root.
export function folderParent(folder: string): string {
  const normalized = normalizeFolder(folder)
  const separatorIndex = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'))
  if (separatorIndex < 0 || separatorIndex === normalized.length - 1) {
    return ''
  }
  const parent = normalized.slice(0, separatorIndex)
  if (parent === '') {
    return '/'
  }

  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent
}

// The folder's own name alone, `Python_Lib`; a name past the width keeps its
// end behind an ellipsis. The full path stays in the option's value.
export function folderOptionLabel(folder: string, maxWidth: number): string {
  return keepEndWithinWidth(folderName(folder), maxWidth)
}

// The recent folder a typed name means: the same name, then a name starting
// with it, then a name containing it, then a path containing it.
export function findFolder(folders: readonly string[], query: string): string | undefined {
  const wanted = query.trim().toLowerCase()
  if (wanted === '') {
    return undefined
  }
  const named = (matches: (name: string) => boolean) =>
    folders.find(folder => matches(folderName(folder).toLowerCase()))

  return (
    named(name => name === wanted) ??
    named(name => name.startsWith(wanted)) ??
    named(name => name.includes(wanted)) ??
    folders.find(folder => folder.toLowerCase().includes(wanted))
  )
}

export function mergeFolderLists(
  first: readonly string[],
  second: readonly string[],
  limit = RECENT_FOLDER_LIMIT,
): string[] {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const folder of [...first, ...second]) {
    if (folder.trim() === '') {
      continue
    }
    const normalized = normalizeFolder(folder)
    const identity = folderIdentity(normalized)
    if (seen.has(identity)) {
      continue
    }
    seen.add(identity)
    merged.push(normalized)
    if (merged.length >= limit) {
      break
    }
  }

  return merged
}

export function placeFolderFirst(
  folders: readonly string[],
  folder: string,
  limit = RECENT_FOLDER_LIMIT,
): string[] {
  return mergeFolderLists([folder], folders, limit)
}

export function isFolderInside(folder: string, parent: string): boolean {
  const child = folderIdentity(folder)
  const root = folderIdentity(parent)
  const prefix = /[\\/]$/.test(root) ? root : `${root}\\`

  return child === root || child.startsWith(prefix)
}

// Temporary folders: Python's tempfile names (tmpk3j_x9ab), anything under a
// Temp folder or the session temp folder, and scratch folders named _Claude_tmp.
const TEMPORARY_FOLDER_PATTERNS = [
  /[\\/]tmp[a-z0-9_]{5,}([\\/]|$)/i,
  /[\\/]AppData[\\/]Local[\\/]Temp([\\/]|$)/i,
  /[\\/]_Claude_Desktop_Temp([\\/]|$)/i,
  /[\\/]_Claude_tmp([\\/]|$)/i,
]

// Scratch workspaces ("No folder" sessions), session worktrees and temporary
// folders are not folders a person picks. `temporaryRoots` are the TEMP, TMP
// and CLAUDE_CODE_TMPDIR folders of this machine.
export function isPickableFolder(folder: string, scratchRoot: string | undefined, temporaryRoots: readonly string[] = []): boolean {
  if (folder.trim() === '') {
    return false
  }
  if (scratchRoot !== undefined && isFolderInside(folder, scratchRoot)) {
    return false
  }
  if (temporaryRoots.some(root => root.trim() !== '' && isFolderInside(folder, root))) {
    return false
  }
  if (TEMPORARY_FOLDER_PATTERNS.some(pattern => pattern.test(folder))) {
    return false
  }

  return !/[\\/]\.claude[\\/]worktrees([\\/]|$)/i.test(folder)
}

// The store holds JSON written by any version of this plugin; keep what is a path.
export function readFolderList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return mergeFolderLists(
    value.filter((item): item is string => typeof item === 'string'),
    [],
  )
}

export type SessionRecordFolder = { folder: string; lastActivityAt: number }

// One record the desktop app keeps per local session, as JSON text.
export function readSessionRecordFolder(
  text: string,
  fallbackTime: number,
): SessionRecordFolder | null {
  let record: unknown
  try {
    record = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof record !== 'object' || record === null) {
    return null
  }
  const fields = record as Record<string, unknown>
  if (fields.isScratchWorkspace === true) {
    return null
  }
  const folder = [fields.originCwd, fields.cwd].find(
    (value): value is string => typeof value === 'string' && value.trim() !== '',
  )
  if (folder === undefined) {
    return null
  }
  const lastActivityAt =
    [fields.lastActivityAt, fields.createdAt].find(
      (value): value is number => typeof value === 'number',
    ) ?? fallbackTime

  return { folder, lastActivityAt }
}

// Each folder once, ordered by the newest session that used it.
export function rankSessionFolders(records: readonly SessionRecordFolder[]): string[] {
  const newest = new Map<string, SessionRecordFolder>()
  for (const record of records) {
    const identity = folderIdentity(record.folder)
    const known = newest.get(identity)
    if (known === undefined || record.lastActivityAt > known.lastActivityAt) {
      newest.set(identity, record)
    }
  }

  return [...newest.values()]
    .sort((first, second) => second.lastActivityAt - first.lastActivityAt)
    .map(record => normalizeFolder(record.folder))
}
