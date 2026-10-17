import { expect, test } from 'claude-code/testing'

import {
  MONITOR_CLOCK_LIMIT,
  MONITOR_DEADLINE_GRACE_MS,
  activeMonitors,
  applyEndings,
  expireMonitors,
  mergeMonitorRecords,
  monitorClocksSvg,
  monitorClocksWidth,
  monitorCountdown,
  isCountingSeconds,
  monitorLines,
  monitorSummary,
  monitorText,
  parseNotificationEndings,
  parseTranscriptMonitors,
  readMonitorStart,
  recordMonitorEnd,
  recordMonitorStart,
} from '../hooks/monitor_clock'

test('a Monitor result starts a clock with its deadline; a persistent one has none', async () => {
  expect(readMonitorStart({ taskId: 'bmon1', timeoutMs: 1_800_000, persistent: false }, 'harvest', 1_000)).toEqual({
    id: 'bmon1',
    description: 'harvest',
    startedAtMs: 1_000,
    deadlineMs: 1_801_000,
  })
  expect(readMonitorStart({ taskId: 'bmon2', timeoutMs: 0, persistent: true }, 'logs', 1_000)?.deadlineMs).toBeUndefined()
  expect(readMonitorStart({ backgroundTaskId: 'b1' }, 'shell', 1_000)).toBeNull()
})

test('an ending notification, a TaskStop or a passed deadline ends the clock', async () => {
  const started = recordMonitorStart([], { id: 'bmon1', description: 'harvest', startedAtMs: 0, deadlineMs: 60_000 })
  expect(activeMonitors(started)).toHaveLength(1)

  const event = '<task-notification>\n<task-id>bmon1</task-id>\n<summary>Monitor event: "harvest"</summary>\n<event>78 done</event>\n</task-notification>'
  expect(parseNotificationEndings(event)).toEqual([])
  const ending = '<task-notification>\n<task-id>bmon1</task-id>\n<status>completed</status>\n<summary>Monitor "harvest" stream ended</summary>\n</task-notification>'
  expect(parseNotificationEndings(ending)).toEqual([{ id: 'bmon1', status: 'completed' }])
  expect(applyEndings(started, parseNotificationEndings(ending), 5_000)[0]).toMatchObject({ endedAtMs: 5_000, outcome: 'completed' })

  expect(recordMonitorEnd(started, 'bmon1', 'stopped', 7_000)[0].outcome).toBe('stopped')

  expect(activeMonitors(expireMonitors(started, 60_000 + MONITOR_DEADLINE_GRACE_MS))).toHaveLength(1)
  expect(expireMonitors(started, 60_001 + MONITOR_DEADLINE_GRACE_MS)[0]).toMatchObject({ outcome: 'expired', endedAtMs: 60_000 })
})

function jsonl(...lines: unknown[]): string {
  return lines.map(line => JSON.stringify(line)).join('\n')
}

test('the transcript gives back the Monitors still watching', async () => {
  const transcript = jsonl(
    { type: 'assistant', timestamp: '2026-10-15T18:00:00.000Z', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Monitor', input: { description: 'round-29 harvest', timeout_ms: 1_800_000 } }] } },
    { type: 'user', timestamp: '2026-10-15T18:00:01.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'started' }] }, toolUseResult: { taskId: 'bmonA', timeoutMs: 1_800_000, persistent: false } },
    { type: 'assistant', timestamp: '2026-10-15T18:01:00.000Z', message: { content: [{ type: 'tool_use', id: 'tu2', name: 'Monitor', input: { description: 'short watch', timeout_ms: 60_000 } }] } },
    { type: 'user', timestamp: '2026-10-15T18:01:01.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 'tu2', content: 'started' }] }, toolUseResult: { taskId: 'bmonB', timeoutMs: 60_000, persistent: false } },
    { type: 'queue-operation', operation: 'enqueue', timestamp: '2026-10-15T18:01:30.000Z', content: '<task-notification>\n<task-id>bmonB</task-id>\n<status>completed</status>\n</task-notification>' },
    // A notification quoted in a tool result (a grep) ends nothing.
    { type: 'user', timestamp: '2026-10-15T18:02:00.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 'tu9', content: '<task-notification>\n<task-id>bmonA</task-id>\n<status>completed</status>' }] } },
    // A background shell's result is not a Monitor's.
    { type: 'user', timestamp: '2026-10-15T18:03:00.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 'tu3', content: 'running' }] }, toolUseResult: { taskId: 'bshell', timeoutMs: 5 } },
  )
  const nowMs = Date.parse('2026-10-15T18:10:00.000Z')
  const monitors = parseTranscriptMonitors(transcript, nowMs)
  expect(monitors.map(record => [record.id, record.outcome ?? 'watching'])).toEqual([
    ['bmonA', 'watching'],
    ['bmonB', 'completed'],
  ])
  expect(monitors[0]).toMatchObject({ description: 'round-29 harvest', startedAtMs: Date.parse('2026-10-15T18:00:01.000Z') })

  const stopped = parseTranscriptMonitors(
    transcript +
      '\n' +
      jsonl({ type: 'assistant', timestamp: '2026-10-15T18:05:00.000Z', message: { content: [{ type: 'tool_use', id: 'tu4', name: 'TaskStop', input: { task_id: 'bmonA' } }] } }),
    nowMs,
  )
  expect(activeMonitors(stopped)).toEqual([])
})

test('merging keeps the recorded clocks and takes an ending from the transcript', async () => {
  const current = [{ id: 'a', description: 'a', startedAtMs: 1 }]
  const parsed = [
    { id: 'a', description: 'a', startedAtMs: 1, endedAtMs: 9, outcome: 'completed' },
    { id: 'b', description: 'b', startedAtMs: 2 },
  ]
  expect(mergeMonitorRecords(current, parsed)).toEqual(parsed)
})

test('one blinking clock per waiting Monitor at 1/2 of the dot rate, with its countdown and a tooltip', async () => {
  const monitors = [
    { id: 'a', description: 'round-29 harvest', startedAtMs: 0, deadlineMs: 1_800_000 },
    { id: 'b', description: 'log tail', startedAtMs: 60_000 },
  ]
  expect(monitorSummary(monitors)).toBe('Waiting on 2 monitors')
  expect(monitorLines(monitors, 120_000)).toEqual([
    'Monitor: log tail (no deadline)',
    'Monitor: round-29 harvest (stops in 28m)',
  ])
  // Within one countdown minute the drawing stays the same, so a redraw keeps the frame.
  const drawnAt = (nowMs: number) => monitorClocksSvg(monitors, monitorLines(monitors, nowMs).join('\n'), nowMs)
  expect(drawnAt(120_500)).toBe(drawnAt(179_000))
  expect(drawnAt(180_500)).not.toBe(drawnAt(179_000))
  const svg = monitorClocksSvg(monitors, 'Waiting on 2 monitors', 120_000)
  expect(svg.match(/<circle /g)).toHaveLength(2)
  expect(svg).toContain('dur="2.4s"')
  expect(svg).toContain('>28m</text>')
  expect(svg).toContain('>∞</text>')
  expect(svg).toContain('<title>Waiting on 2 monitors</title>')
  const many = Array.from({ length: MONITOR_CLOCK_LIMIT + 3 }, (_, index) => ({ id: `m${index}`, description: 'x', startedAtMs: index }))
  expect(monitorClocksSvg(many, 't', 0).match(/<circle /g)).toHaveLength(MONITOR_CLOCK_LIMIT)
  expect(monitorClocksWidth(many, 0)).toBe(monitorClocksWidth(many.slice(0, MONITOR_CLOCK_LIMIT), 0))
  expect(monitorText(monitors)).toBe('Monitors 2 waiting')
})

test('the countdown rounds whole minutes up and counts seconds in the last minute', () => {
  const record = { id: 'a', description: 'a', startedAtMs: 0, deadlineMs: 600_000 }
  expect(monitorCountdown(record, 0)).toBe('10m')
  expect(monitorCountdown(record, 1_000)).toBe('10m')
  expect(monitorCountdown(record, 540_000)).toBe('1m')
  expect(monitorCountdown(record, 545_500)).toBe('55s')
  expect(monitorCountdown(record, 700_000)).toBe('0s')
  expect(monitorCountdown({ id: 'b', description: 'b', startedAtMs: 0 }, 0)).toBe('∞')
  expect(isCountingSeconds([record], 0)).toBe(false)
  expect(isCountingSeconds([record], 545_500)).toBe(true)
})
