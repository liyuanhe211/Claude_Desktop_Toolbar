// Buttons other programs ask the toolbar to show, with no engine calls.
//
// A program shows a button by writing `<id>.json` into the button folder,
// `%TEMP%\claude_desktop_toolbar\buttons`, and removes it by deleting the file.
// A press writes `<id>.pressed` beside it; the program watches for that file,
// does what the press means, and deletes both files. The file holds:
//
//   label          the button text (required)
//   animation      "dots": three dots cycle after the label; absent or "none": still
//   pressed_label  the text once pressed, until the program removes the button
//   session_id     the conversation it belongs to; absent or empty: every one
//   expires_at_ms  when to stop showing it if the program never removes it
//
// The program may rewrite the file at any time to change the label.

import type { ExternalButtonAnimation, ExternalButtonRecord } from '../types'

export const BUTTON_FOLDER_NAME = 'claude_desktop_toolbar'
export const BUTTON_SUBFOLDER_NAME = 'buttons'
export const BUTTON_FILE_SUFFIX = '.json'
export const PRESS_FILE_SUFFIX = '.pressed'
export const EXTERNAL_BUTTON_POLL_MS = 500
// A file without its own expiry stops showing this long after its last write,
// so a program killed before it could delete the file leaves no button behind.
export const DEFAULT_BUTTON_LIFETIME_MS = 10 * 60 * 1000
// At most this many buttons draw; the newest files win.
export const EXTERNAL_BUTTON_LIMIT = 4
export const DOT_FRAME_COUNT = 3
const LABEL_LIMIT = 80
const NO_BREAK_SPACE = ' '

export type ButtonFile = { name: string; mtimeMs: number; text: string }

// One requested button: parsed from its file, and drawn from the record the
// toolbar keeps in state.
export class ExternalButton {
  constructor(
    readonly id: string,
    readonly label: string,
    readonly animation: ExternalButtonAnimation,
    readonly pressedLabel: string,
    readonly sessionId: string,
    readonly expiresAtMs: number,
    readonly writtenAtMs: number,
  ) {}

  // The button a file asks for, or null for a file that is not one.
  static parse(file: ButtonFile): ExternalButton | null {
    if (!file.name.endsWith(BUTTON_FILE_SUFFIX)) {
      return null
    }
    const id = file.name.slice(0, -BUTTON_FILE_SUFFIX.length)
    if (!/^[A-Za-z0-9_.-]+$/.test(id)) {
      return null
    }
    let value: unknown
    try {
      value = JSON.parse(file.text)
    } catch {
      return null
    }
    if (typeof value !== 'object' || value === null) {
      return null
    }
    const fields = value as Record<string, unknown>
    const label = cleanLabel(fields.label)
    if (label === '') {
      return null
    }
    const animation: ExternalButtonAnimation = fields.animation === 'dots' ? 'dots' : 'none'
    const pressedLabel = cleanLabel(fields.pressed_label)
    const sessionId = typeof fields.session_id === 'string' ? fields.session_id : ''
    const expiresAtMs =
      typeof fields.expires_at_ms === 'number' && Number.isFinite(fields.expires_at_ms)
        ? fields.expires_at_ms
        : file.mtimeMs + DEFAULT_BUTTON_LIFETIME_MS

    return new ExternalButton(id, label, animation, pressedLabel === '' ? label : pressedLabel, sessionId, expiresAtMs, file.mtimeMs)
  }

  static fromRecord(record: ExternalButtonRecord): ExternalButton {
    return new ExternalButton(record.id, record.label, record.animation, record.pressedLabel, '', Infinity, 0)
  }

  isShownIn(sessionId: string, nowMs: number): boolean {
    return (this.sessionId === '' || this.sessionId === sessionId) && nowMs <= this.expiresAtMs
  }

  get pressFileName(): string {
    return `${this.id}${PRESS_FILE_SUFFIX}`
  }

  // The text drawn now. Dots run `...`, `.`, `..` and are padded with no-break
  // spaces so the row beside the button does not shift.
  text(frame: number, isPressed: boolean): string {
    const base = isPressed ? this.pressedLabel : this.label
    if (this.animation !== 'dots') {
      return base
    }
    const dotCount = ((frame + DOT_FRAME_COUNT - 1) % DOT_FRAME_COUNT) + 1

    return `${base} ${'.'.repeat(dotCount).padEnd(DOT_FRAME_COUNT, NO_BREAK_SPACE)}`
  }

  toRecord(isPressed: boolean): ExternalButtonRecord {
    return { id: this.id, label: this.label, animation: this.animation, pressedLabel: this.pressedLabel, isPressed }
  }
}

function cleanLabel(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  const flat = value.replace(/\s+/g, ' ').trim()

  return flat.length > LABEL_LIMIT ? `${flat.slice(0, LABEL_LIMIT - 1)}…` : flat
}

// The records the toolbar draws from the files found: this session's live
// buttons, newest first, each pressed once its press file is there.
export function buttonRecords(
  files: readonly ButtonFile[],
  pressFileNames: ReadonlySet<string>,
  sessionId: string,
  nowMs: number,
): ExternalButtonRecord[] {
  return files
    .map(file => ExternalButton.parse(file))
    .filter((button): button is ExternalButton => button !== null && button.isShownIn(sessionId, nowMs))
    .sort((first, second) => second.writtenAtMs - first.writtenAtMs || first.id.localeCompare(second.id))
    .slice(0, EXTERNAL_BUTTON_LIMIT)
    .map(button => button.toRecord(pressFileNames.has(button.pressFileName)))
}

// Whether any button animates, so the frame has to move on.
export function isAnimating(records: readonly ExternalButtonRecord[]): boolean {
  return records.some(record => record.animation === 'dots')
}

// The note a press writes, for the program's own log.
export function pressNote(sessionId: string, nowMs: number): string {
  return JSON.stringify({ pressed_at_ms: nowMs, session_id: sessionId })
}
