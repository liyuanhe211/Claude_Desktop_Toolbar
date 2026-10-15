import type { SubagentRecord, SubagentState } from '../types'

// The subagent dots: one dot per subagent of the session, in launch order.
// Running dots pulse (SMIL, drawn by an interactive Svg); ended ones stand
// still in their outcome's color. No engine calls here.

// The engine's AgentStatus, spelled out so this module needs no engine types.
export type ListedAgentStatus = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'
export type ListedAgent = { id: string; description: string; type: string; status: ListedAgentStatus }
export type TurnEndReason = 'answer' | 'aborted' | 'refusal' | 'error'

export const SUBAGENT_HISTORY_LIMIT = 50
export const SUBAGENT_DOT_LIMIT = 12
export const DOTS_HEIGHT_PX = 24
const DOT_RADIUS = 4
const DOT_PITCH = 12
const OVERFLOW_TEXT_WIDTH = 22

export const SUBAGENT_COLORS = {
  running: '#d97757',
  completed: '#5abd7b',
  failed: '#ef6666',
  stopped: '#9ca3af',
} as const

const STATE_LABELS: Record<SubagentState, string> = {
  running: 'Running',
  waiting: 'Waiting',
  idle: 'Idle',
  completed: 'Completed',
  failed: 'Failed',
  stopped: 'Stopped',
}

export function isActiveState(state: SubagentState): boolean {
  return state === 'running' || state === 'waiting' || state === 'idle'
}

export function stateOfStatus(status: ListedAgentStatus): SubagentState {
  switch (status) {
    case 'pending':
    case 'running':
      return 'running'
    case 'waiting':
      return 'waiting'
    case 'idle':
      return 'idle'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'killed':
      return 'stopped'
  }
}

export function stateOfTurnEnd(reason: TurnEndReason): SubagentState {
  if (reason === 'answer') {
    return 'completed'
  }
  return reason === 'aborted' ? 'stopped' : 'failed'
}

function withState(record: SubagentRecord, state: SubagentState, nowMs: number): SubagentRecord {
  if (record.state === state) {
    return record
  }
  return { ...record, state, endedAtMs: isActiveState(state) ? undefined : (record.endedAtMs ?? nowMs) }
}

function keepNewest(records: SubagentRecord[]): SubagentRecord[] {
  return records.length > SUBAGENT_HISTORY_LIMIT ? records.slice(records.length - SUBAGENT_HISTORY_LIMIT) : records
}

// A subagent the Agent tool just started, before the engine lists it.
export function recordSpawn(
  records: readonly SubagentRecord[],
  agent: { id: string; description: string; type: string },
  nowMs: number,
): SubagentRecord[] {
  if (records.some(record => record.id === agent.id)) {
    return [...records]
  }
  return keepNewest([
    ...records,
    { id: agent.id, description: agent.description, type: agent.type, state: 'running', startedAtMs: nowMs, hasBeenListed: false },
  ])
}

// A subagent's run ended (its turn.complete); a later listing may resume it.
export function recordTurnEnd(
  records: readonly SubagentRecord[],
  id: string,
  reason: TurnEndReason,
  nowMs: number,
): SubagentRecord[] {
  return records.map(record => (record.id === id ? withState(record, stateOfTurnEnd(reason), nowMs) : record))
}

// The engine's list wins for every agent it lists. It drops an agent's task a
// while after the agent ends, so one missing from the list keeps its last
// state; an active one that was listed before and is gone ended unseen, and
// is shown as stopped.
export function mergeListedAgents(
  records: readonly SubagentRecord[],
  listed: readonly ListedAgent[],
  nowMs: number,
): SubagentRecord[] {
  const listedById = new Map(listed.map(agent => [agent.id, agent]))
  const merged = records.map(record => {
    const agent = listedById.get(record.id)
    if (agent === undefined) {
      return record.hasBeenListed && isActiveState(record.state) ? withState(record, 'stopped', nowMs) : record
    }
    const updated = withState(record, stateOfStatus(agent.status), nowMs)
    return updated.hasBeenListed ? updated : { ...updated, hasBeenListed: true }
  })
  const known = new Set(records.map(record => record.id))
  for (const agent of listed) {
    if (!known.has(agent.id)) {
      const state = stateOfStatus(agent.status)
      merged.push({
        id: agent.id,
        description: agent.description,
        type: agent.type,
        state,
        startedAtMs: nowMs,
        endedAtMs: isActiveState(state) ? undefined : nowMs,
        hasBeenListed: true,
      })
    }
  }
  return keepNewest(merged)
}

export function countStates(records: readonly SubagentRecord[]): Record<SubagentState, number> {
  const counts: Record<SubagentState, number> = { running: 0, waiting: 0, idle: 0, completed: 0, failed: 0, stopped: 0 }
  for (const record of records) {
    counts[record.state] += 1
  }
  return counts
}

// "Subagents: 2 running, 3 completed, 1 failed", the states in a fixed order.
export function subagentSummary(records: readonly SubagentRecord[]): string {
  const counts = countStates(records)
  const parts = (Object.keys(STATE_LABELS) as SubagentState[])
    .filter(state => counts[state] > 0)
    .map(state => `${counts[state]} ${STATE_LABELS[state].toLowerCase()}`)
  return `Subagents: ${parts.join(', ')}`
}

function formatElapsed(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000))
  if (seconds < 60) {
    return `${seconds} s`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes} min ${seconds % 60} s`
  }
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

// One line per subagent, newest first: "Running  Explore: Find the config (2 min 5 s)".
export function subagentLines(records: readonly SubagentRecord[], nowMs: number): string[] {
  return [...records].reverse().map(record => {
    const elapsed = formatElapsed((record.endedAtMs ?? nowMs) - record.startedAtMs)
    return `${STATE_LABELS[record.state]}  ${record.type}: ${record.description} (${elapsed})`
  })
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function subagentDotsWidth(records: readonly SubagentRecord[]): number {
  const shown = Math.min(records.length, SUBAGENT_DOT_LIMIT)
  return (records.length > SUBAGENT_DOT_LIMIT ? OVERFLOW_TEXT_WIDTH : 0) + shown * DOT_PITCH
}

// Running dots breathe one after another; waiting and idle ones are hollow,
// a waiting one breathing slowly; ended ones are still.
function dotMarkup(record: SubagentRecord, centerX: number, index: number): string {
  const centerY = DOTS_HEIGHT_PX / 2
  const delay = `${(index * 0.15).toFixed(2)}s`
  switch (record.state) {
    case 'running':
      return (
        `<circle cx="${centerX}" cy="${centerY}" r="${DOT_RADIUS}" fill="${SUBAGENT_COLORS.running}">` +
        `<animate attributeName="r" values="${DOT_RADIUS};${DOT_RADIUS * 0.6};${DOT_RADIUS}" dur="1.2s" begin="${delay}" repeatCount="indefinite"/>` +
        `<animate attributeName="opacity" values="1;0.3;1" dur="1.2s" begin="${delay}" repeatCount="indefinite"/>` +
        '</circle>'
      )
    case 'waiting':
      return (
        `<circle cx="${centerX}" cy="${centerY}" r="${DOT_RADIUS - 0.6}" fill="none" stroke="${SUBAGENT_COLORS.running}" stroke-width="1.2">` +
        `<animate attributeName="opacity" values="1;0.35;1" dur="2.4s" begin="${delay}" repeatCount="indefinite"/>` +
        '</circle>'
      )
    case 'idle':
      return `<circle cx="${centerX}" cy="${centerY}" r="${DOT_RADIUS - 0.6}" fill="none" stroke="${SUBAGENT_COLORS.running}" stroke-width="1.2"/>`
    case 'stopped':
      return `<circle cx="${centerX}" cy="${centerY}" r="${DOT_RADIUS - 0.6}" fill="none" stroke="${SUBAGENT_COLORS.stopped}" stroke-width="1.2"/>`
    case 'completed':
    case 'failed':
      return `<circle cx="${centerX}" cy="${centerY}" r="${DOT_RADIUS}" fill="${SUBAGENT_COLORS[record.state]}"/>`
  }
}

// The newest SUBAGENT_DOT_LIMIT dots, oldest left; "+n" before them counts
// the older ones not drawn. The title is the hover tooltip.
export function subagentDotsSvg(records: readonly SubagentRecord[], title: string): string {
  const width = subagentDotsWidth(records)
  const hidden = Math.max(0, records.length - SUBAGENT_DOT_LIMIT)
  const shown = records.slice(hidden)
  const offset = hidden > 0 ? OVERFLOW_TEXT_WIDTH : 0
  const overflow =
    hidden > 0
      ? `<text x="${OVERFLOW_TEXT_WIDTH - 3}" y="${DOTS_HEIGHT_PX / 2 + 4}" text-anchor="end" font-family="system-ui, sans-serif"` +
        ` font-size="11" fill="${SUBAGENT_COLORS.stopped}">+${hidden}</text>`
      : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${DOTS_HEIGHT_PX}" viewBox="0 0 ${width} ${DOTS_HEIGHT_PX}" role="img">` +
    `<title>${escapeXml(title)}</title>` +
    overflow +
    shown.map((record, index) => dotMarkup(record, offset + index * DOT_PITCH + DOT_PITCH / 2, index)).join('') +
    '</svg>'
  )
}

// What a surface without Svg (the terminal) shows instead: "Agents 2 running · 3 done · 1 failed".
export function subagentText(records: readonly SubagentRecord[]): string {
  const counts = countStates(records)
  const active = counts.running + counts.waiting + counts.idle
  const parts = [
    active > 0 ? `${active} running` : '',
    counts.completed > 0 ? `${counts.completed} done` : '',
    counts.failed > 0 ? `${counts.failed} failed` : '',
    counts.stopped > 0 ? `${counts.stopped} stopped` : '',
  ].filter(part => part !== '')
  return `Agents ${parts.join(' · ')}`
}
