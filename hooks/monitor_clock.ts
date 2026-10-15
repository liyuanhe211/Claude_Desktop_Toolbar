import type { MonitorRecord } from '../types'
import { DOTS_HEIGHT_PX, SUBAGENT_COLORS, escapeXml, formatElapsed } from './subagent_dots'

// The waiting clocks: one clock per Monitor of the main conversation that is
// still watching, so a conversation idle on a Monitor does not look finished.
// A clock blinks at 1/2 of a running subagent dot's rate and shows the time
// left before its Monitor expires. No engine calls here.

export const MONITOR_HISTORY_LIMIT = 20
export const MONITOR_CLOCK_LIMIT = 6
// The Monitor's own expiry notification arrives at its deadline; past this
// grace the clock stops even if the notification was missed.
export const MONITOR_DEADLINE_GRACE_MS = 60_000
const CLOCK_RADIUS = 6.2
const CLOCK_SIZE = 18
const COUNTDOWN_FONT_PX = 11
// Roughly one digit's advance at COUNTDOWN_FONT_PX, and the gap after a countdown.
const COUNTDOWN_CHARACTER_WIDTH = 6.6
const COUNTDOWN_GAP = 6
// The running subagent dot pulses over 1.2 s; the clock at 1/2 of that rate.
const CLOCK_PERIOD_S = 2.4
// Below this the countdown counts seconds and needs a redraw every poll.
export const COUNTDOWN_SECONDS_BELOW_MS = 60_000

export type MonitorEnding = { id: string; status: string }

export function isActiveMonitor(record: MonitorRecord): boolean {
  return record.endedAtMs === undefined
}

export function activeMonitors(records: readonly MonitorRecord[]): MonitorRecord[] {
  return records.filter(isActiveMonitor)
}

function keepNewest(records: MonitorRecord[]): MonitorRecord[] {
  return records.length > MONITOR_HISTORY_LIMIT ? records.slice(records.length - MONITOR_HISTORY_LIMIT) : records
}

// What the Monitor tool answered: `{ taskId, timeoutMs, persistent }`.
export function readMonitorStart(
  result: unknown,
  description: string,
  nowMs: number,
): MonitorRecord | null {
  if (typeof result !== 'object' || result === null) {
    return null
  }
  const output = result as { taskId?: unknown; timeoutMs?: unknown; persistent?: unknown }
  if (typeof output.taskId !== 'string' || output.taskId === '') {
    return null
  }
  const isPersistent = output.persistent === true || output.timeoutMs === 0
  const timeoutMs = typeof output.timeoutMs === 'number' ? output.timeoutMs : undefined
  return {
    id: output.taskId,
    description,
    startedAtMs: nowMs,
    deadlineMs: isPersistent || timeoutMs === undefined ? undefined : nowMs + timeoutMs,
  }
}

export function recordMonitorStart(records: readonly MonitorRecord[], monitor: MonitorRecord): MonitorRecord[] {
  return keepNewest([...records.filter(record => record.id !== monitor.id), monitor])
}

export function recordMonitorEnd(
  records: readonly MonitorRecord[],
  id: string,
  outcome: string,
  nowMs: number,
): MonitorRecord[] {
  return records.map(record =>
    record.id === id && isActiveMonitor(record) ? { ...record, endedAtMs: nowMs, outcome } : record,
  )
}

// The ending notifications in a task-notification text: a block that carries
// a `<status>`; a Monitor's event blocks carry none.
export function parseNotificationEndings(text: string): MonitorEnding[] {
  if (!text.includes('<task-notification>')) {
    return []
  }
  const endings: MonitorEnding[] = []
  for (const block of text.split('<task-notification>').slice(1)) {
    const id = /<task-id>([^<]+)<\/task-id>/.exec(block)?.[1]?.trim()
    const status = /<status>([^<]+)<\/status>/.exec(block)?.[1]?.trim()
    if (id !== undefined && status !== undefined && id !== '' && status !== '') {
      endings.push({ id, status })
    }
  }
  return endings
}

export function applyEndings(
  records: readonly MonitorRecord[],
  endings: readonly MonitorEnding[],
  nowMs: number,
): MonitorRecord[] {
  return endings.reduce<MonitorRecord[]>((current, ending) => recordMonitorEnd(current, ending.id, ending.status, nowMs), [
    ...records,
  ])
}

// Ends the clocks past their deadline and its grace: the expiry notification
// was missed, or a restart of the engine killed the Monitor without one.
export function expireMonitors(records: readonly MonitorRecord[], nowMs: number): MonitorRecord[] {
  return records.map(record => {
    if (!isActiveMonitor(record)) {
      return record
    }
    if (record.deadlineMs !== undefined && nowMs > record.deadlineMs + MONITOR_DEADLINE_GRACE_MS) {
      return { ...record, endedAtMs: record.deadlineMs, outcome: 'expired' }
    }
    return record
  })
}

type TranscriptBlock = { type?: unknown; id?: unknown; name?: unknown; input?: unknown; tool_use_id?: unknown; text?: unknown }
type TranscriptLine = {
  type?: unknown
  timestamp?: unknown
  message?: { content?: unknown }
  toolUseResult?: unknown
  // A queue-operation line's queued text.
  content?: unknown
  // A queued_command attachment's prompt.
  attachment?: { prompt?: unknown }
}

function lineBlocks(line: TranscriptLine): TranscriptBlock[] {
  const content = line.message?.content
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }
  return Array.isArray(content) ? content.filter((block): block is TranscriptBlock => typeof block === 'object' && block !== null) : []
}

function lineTimeMs(line: TranscriptLine, fallbackMs: number): number {
  const parsed = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : Number.NaN
  return Number.isFinite(parsed) ? parsed : fallbackMs
}

// The Monitors of a transcript (.jsonl): each Monitor call with its result's
// task id, ended by a notification with a status or by a TaskStop. Only the
// lines that can matter are parsed, so a long transcript stays cheap.
export function parseTranscriptMonitors(transcript: string, nowMs: number): MonitorRecord[] {
  const descriptions = new Map<string, string>()
  let records: MonitorRecord[] = []
  for (const raw of transcript.split('\n')) {
    const isMonitorCall = raw.includes('"name":"Monitor"')
    const isStartResult = raw.includes('"toolUseResult"') && raw.includes('"taskId"')
    const isTaskStop = raw.includes('"name":"TaskStop"')
    const isNotification = raw.includes('<task-notification>')
    if (!isMonitorCall && !isStartResult && !isTaskStop && !isNotification) {
      continue
    }
    let line: TranscriptLine
    try {
      line = JSON.parse(raw) as TranscriptLine
    } catch {
      continue
    }
    const atMs = lineTimeMs(line, nowMs)
    const blocks = lineBlocks(line)
    if (line.type === 'assistant') {
      for (const block of blocks) {
        if (block.type !== 'tool_use' || typeof block.id !== 'string') {
          continue
        }
        const input = (typeof block.input === 'object' && block.input !== null ? block.input : {}) as {
          description?: unknown
          task_id?: unknown
          shell_id?: unknown
        }
        if (block.name === 'Monitor') {
          descriptions.set(block.id, typeof input.description === 'string' ? input.description : 'Monitor')
        } else if (block.name === 'TaskStop') {
          const taskId = typeof input.task_id === 'string' ? input.task_id : input.shell_id
          if (typeof taskId === 'string') {
            records = recordMonitorEnd(records, taskId, 'stopped', atMs)
          }
        }
      }
      continue
    }
    // A notification is stored as it is queued (queue-operation), as a
    // queued_command attachment, or as a user message when it is dequeued.
    if (line.type === 'queue-operation') {
      if (typeof line.content === 'string') {
        records = applyEndings(records, parseNotificationEndings(line.content), atMs)
      }
      continue
    }
    if (typeof line.attachment?.prompt === 'string') {
      records = applyEndings(records, parseNotificationEndings(line.attachment.prompt), atMs)
      continue
    }
    if (line.type !== 'user') {
      continue
    }
    const toolResult = blocks.find(block => block.type === 'tool_result')
    if (toolResult !== undefined) {
      const description = typeof toolResult.tool_use_id === 'string' ? descriptions.get(toolResult.tool_use_id) : undefined
      const started = description === undefined ? null : readMonitorStart(line.toolUseResult, description, atMs)
      if (started !== null) {
        records = recordMonitorStart(records, started)
      }
      continue
    }
    // A notification the session received; quoted ones inside tool results
    // were skipped above.
    const text = blocks.map(block => (typeof block.text === 'string' ? block.text : '')).join('\n')
    records = applyEndings(records, parseNotificationEndings(text), atMs)
  }
  return records
}

// Adds the transcript's Monitors to the recorded ones; an ending either side
// knows wins.
export function mergeMonitorRecords(current: readonly MonitorRecord[], parsed: readonly MonitorRecord[]): MonitorRecord[] {
  const byId = new Map(current.map(record => [record.id, record]))
  for (const record of parsed) {
    const known = byId.get(record.id)
    if (known === undefined || (isActiveMonitor(known) && !isActiveMonitor(record))) {
      byId.set(record.id, known === undefined ? record : { ...known, endedAtMs: record.endedAtMs, outcome: record.outcome })
    }
  }
  return keepNewest([...byId.values()].sort((first, second) => first.startedAtMs - second.startedAtMs))
}

export function monitorSummary(active: readonly MonitorRecord[]): string {
  return `Waiting on ${active.length} monitor${active.length === 1 ? '' : 's'}`
}

// One line per waiting Monitor, newest first: "Monitor: round-29 harvest (waiting 3 min 2 s, stops in 26 min 58 s)".
export function monitorLines(active: readonly MonitorRecord[], nowMs: number): string[] {
  return [...active].reverse().map(record => {
    const waited = formatElapsed(nowMs - record.startedAtMs)
    const remaining =
      record.deadlineMs === undefined ? 'no deadline' : `stops in ${formatElapsed(Math.max(0, record.deadlineMs - nowMs))}`
    return `Monitor: ${record.description} (waiting ${waited}, ${remaining})`
  })
}

function shownClocks(active: readonly MonitorRecord[]): readonly MonitorRecord[] {
  return active.slice(Math.max(0, active.length - MONITOR_CLOCK_LIMIT))
}

// The time left before a Monitor expires: "12m" (whole minutes, rounded up),
// "45s" in its last minute, "∞" without a deadline.
export function monitorCountdown(record: MonitorRecord, nowMs: number): string {
  if (record.deadlineMs === undefined) {
    return '∞'
  }
  const remainingMs = Math.max(0, record.deadlineMs - nowMs)
  if (remainingMs < COUNTDOWN_SECONDS_BELOW_MS) {
    return `${Math.ceil(remainingMs / 1000)}s`
  }
  return `${Math.ceil(remainingMs / 60_000)}m`
}

// Whether a shown countdown counts seconds, so the clocks redraw every poll.
export function isCountingSeconds(active: readonly MonitorRecord[], nowMs: number): boolean {
  return shownClocks(active).some(
    record => record.deadlineMs !== undefined && record.deadlineMs - nowMs < COUNTDOWN_SECONDS_BELOW_MS,
  )
}

function countdownWidth(countdown: string): number {
  return Math.ceil(countdown.length * COUNTDOWN_CHARACTER_WIDTH) + COUNTDOWN_GAP
}

export function monitorClocksWidth(active: readonly MonitorRecord[], nowMs: number): number {
  return shownClocks(active).reduce((width, record) => width + CLOCK_SIZE + countdownWidth(monitorCountdown(record, nowMs)), 0)
}

function countdownMarkup(left: number, countdown: string): string {
  return (
    `<text x="${left}" y="${DOTS_HEIGHT_PX / 2}" dominant-baseline="central" font-size="${COUNTDOWN_FONT_PX}" ` +
    `font-family="system-ui, sans-serif" fill="${SUBAGENT_COLORS.running}">${escapeXml(countdown)}</text>`
  )
}

function clockMarkup(centerX: number): string {
  const centerY = DOTS_HEIGHT_PX / 2
  const color = SUBAGENT_COLORS.running
  return (
    `<g fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round">` +
    `<circle cx="${centerX}" cy="${centerY}" r="${CLOCK_RADIUS}"/>` +
    `<path d="M${centerX} ${centerY - 3.6}V${centerY}L${centerX + 2.6} ${centerY + 1.6}"/>` +
    `<animate attributeName="opacity" values="1;0.3;1" dur="${CLOCK_PERIOD_S}s" repeatCount="indefinite"/>` +
    '</g>'
  )
}

// The newest MONITOR_CLOCK_LIMIT clocks, oldest left, each followed by its
// countdown. The title is the hover tooltip.
export function monitorClocksSvg(active: readonly MonitorRecord[], title: string, nowMs: number): string {
  const width = monitorClocksWidth(active, nowMs)
  let left = 0
  const parts: string[] = []
  for (const record of shownClocks(active)) {
    const countdown = monitorCountdown(record, nowMs)
    parts.push(clockMarkup(left + CLOCK_SIZE / 2), countdownMarkup(left + CLOCK_SIZE, countdown))
    left += CLOCK_SIZE + countdownWidth(countdown)
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${DOTS_HEIGHT_PX}" viewBox="0 0 ${width} ${DOTS_HEIGHT_PX}" role="img">` +
    `<title>${escapeXml(title)}</title>` +
    parts.join('') +
    '</svg>'
  )
}

// What a surface without Svg (the terminal) shows instead: "Monitors 1 waiting".
export function monitorText(active: readonly MonitorRecord[]): string {
  return `Monitors ${active.length} waiting`
}
