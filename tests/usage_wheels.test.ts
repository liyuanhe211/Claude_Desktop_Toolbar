import { expect, test } from 'claude-code/testing'

import {
  CODEX_COLORS,
  contextBarSvg,
  contextColor,
  alignDurations,
  alignDurationsByPosition,
  formatDuration,
  formatTokens,
  mergeWindows,
  parseUsageEndpoint,
  pickModelWeeklyWindow,
  projectRunOut,
  resetsInMs,
  quotaColor,
  quotaRingSvg,
  usageText,
  usageWidgets,
  wholePercent,
} from '../hooks/usage_wheels'

const NOW = Date.parse('2026-10-14T20:00:00Z')
const USAGE = {
  context: { tokens: 110_000, window: 1_000_000, percent: 11 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-14T22:05:00Z' },
    { kind: 'seven_day', percentUsed: 57, resetsAt: '2026-10-17T00:00:00Z' },
    { kind: 'model_weekly:Fable', percentUsed: 88.9, resetsAt: '2026-10-17T00:00:00Z' },
  ],
}

// The shape GET /api/oauth/usage answered on 2026-10-15, trimmed.
const ENDPOINT_ANSWER = {
  five_hour: { utilization: 4, resets_at: '2026-10-15T09:09:59.655259+00:00', limit_dollars: null },
  seven_day: { utilization: 68, resets_at: '2026-10-20T13:59:59.655277+00:00' },
  seven_day_opus: null,
  limits: [
    { kind: 'session', percent: 4, resets_at: '2026-10-15T09:09:59.655259+00:00', scope: {} },
    { kind: 'weekly_all', percent: 68, resets_at: '2026-10-20T13:59:59.655277+00:00', scope: {} },
    { kind: 'weekly_scoped', percent: 50, resets_at: '2026-10-20T13:59:59.655421+00:00', scope: { model: { id: null, display_name: 'Fable' }, surface: null } },
  ],
}

test('percentages round down, tokens shorten, reset times read naturally', () => {
  expect(wholePercent(99.9)).toBe('99%')
  expect(wholePercent(null)).toBe('?')
  expect(formatTokens(110_000)).toBe('110k')
  expect(formatTokens(1_000_000)).toBe('1M')
  const minute = 60_000
  expect(formatDuration((5 * 24 * 60 + 3 * 60) * minute)).toBe('5 d 3 h')
  expect(formatDuration((3 * 60 + 5) * minute)).toBe('3 h 5 min')
  expect(formatDuration(35 * minute)).toBe('35 min')
  // A column of spans: every unit in its own slot, h under h, min under min.
  expect(alignDurations([5 * minute, (10 * 60 + 45) * minute, (4 * 60 + 39) * minute])).toEqual([
    '      5 min',
    '10 h 45 min',
    ' 4 h 39 min',
  ])
  expect(alignDurations([(4 * 60 + 10) * minute, (5 * 24 * 60 + 14 * 60) * minute, null])).toEqual([
    '     4 h 10 min',
    '5 d 14 h',
    null,
  ])
  expect(alignDurations([(5 * 24 * 60 + 3 * 60) * minute, (5 * 24 * 60 + 14 * 60) * minute])).toEqual(['5 d  3 h', '5 d 14 h'])
  // The reset column: left-aligned, number by number.
  expect(alignDurationsByPosition([(3 * 60 + 30) * minute, (5 * 24 * 60 + 3 * 60) * minute, null])).toEqual([
    '3 h 30 min',
    '5 d  3 h',
    null,
  ])
  expect(alignDurationsByPosition([(4 * 60 + 10) * minute, (5 * 24 * 60 + 14 * 60) * minute])).toEqual(['4 h 10 min', '5 d 14 h'])
})

test('the detail block reads as asked: resets left-aligned, run-out times unit under unit', () => {
  const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()
  const resetOfWeek = at((5 * 24 + 14) * 60)
  const widgets = usageWidgets(
    {
      context: { tokens: 350_000, window: 1_000_000 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 91, resetsAt: at(4 * 60 + 10) },
        { kind: 'seven_day', percentUsed: 76, resetsAt: resetOfWeek },
        { kind: 'model_weekly:Fable', percentUsed: 88, resetsAt: resetOfWeek },
      ],
    },
    NOW,
  )
  expect(widgets.details).toEqual([
    'Context  : 350k / 1M',
    '5 h limit: 91% (Reset in 4 h 10 min. Runs out in       5 min.)',
    '7 d limit: 76% (Reset in 5 d 14 h.   Runs out in 10 h 45 min.)',
    'Fable    : 88% (Reset in 5 d 14 h.   Runs out in  4 h 39 min.)',
  ])
})

test('the time to the reset is known only for a future reset', () => {
  expect(resetsInMs('2026-10-14T22:05:00Z', NOW)).toBe(125 * 60_000)
  expect(resetsInMs('2026-10-14T19:00:00Z', NOW)).toBeNull()
  expect(resetsInMs(undefined, NOW)).toBeNull()
})

test('the run-out time follows the average rate since the window began', () => {
  const inTwoHours = new Date(NOW + 2 * 3_600_000).toISOString()
  // 70 % in the first 3 hours: the last 30 % lasts 77.1 minutes, before the reset.
  expect(projectRunOut({ kind: 'five_hour', percentUsed: 70, resetsAt: inTwoHours }, NOW)).toEqual({
    state: 'in',
    durationMs: (30 * 3 * 3_600_000) / 70,
  })
  // 12 % in 3 hours lasts beyond the reset.
  expect(projectRunOut({ kind: 'five_hour', percentUsed: 12, resetsAt: inTwoHours }, NOW)).toEqual({ state: 'pastReset' })
  expect(projectRunOut({ kind: 'five_hour', percentUsed: 0, resetsAt: inTwoHours }, NOW)).toEqual({ state: 'pastReset' })
  expect(projectRunOut({ kind: 'five_hour', percentUsed: 100, resetsAt: inTwoHours }, NOW)).toEqual({ state: 'ranOut' })
  expect(projectRunOut({ kind: 'five_hour', percentUsed: 50 }, NOW)).toBeNull()
})

test('the detail block pads every column; the tooltips keep single spaces', () => {
  const inTwoHours = new Date(NOW + 2 * 3_600_000).toISOString()
  const widgets = usageWidgets(
    {
      context: { tokens: 350_000, window: 1_000_000 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 70, resetsAt: inTwoHours },
        { kind: 'seven_day', percentUsed: 5, resetsAt: '2026-10-19T23:00:00Z' },
        { kind: 'model_weekly:Fable', percentUsed: 100, resetsAt: '2026-10-19T23:00:00Z' },
      ],
    },
    NOW,
  )
  expect(widgets.details).toEqual([
    'Context  : 350k / 1M',
    '5 h limit:  70% (Reset in 2 h 0 min. Runs out in 1 h 18 min.)',
    '7 d limit:   5% (Reset in 5 d 3 h.   Lasts past reset.)',
    'Fable    : 100% (Reset in 5 d 3 h.   Ran out.)',
  ])
  expect(widgets.tooltips).toEqual({
    context: 'Context: 350k / 1M',
    fiveHour: '5 h limit: 70% (Reset in 2 h 0 min. Runs out in 1 h 18 min.)',
    weekly: '7 d limit: 5% (Reset in 5 d 3 h. Lasts past reset.)',
    model: 'Fable: 100% (Reset in 5 d 3 h. Ran out.)',
  })
})

test('colors follow the Codex widget: context by tokens, quotas by percent', () => {
  expect(contextColor(299_999)).toBe(CODEX_COLORS.blue)
  expect(contextColor(300_000)).toBe(CODEX_COLORS.yellow)
  expect(contextColor(400_001)).toBe(CODEX_COLORS.red)
  expect(quotaColor(69)).toBe(CODEX_COLORS.green)
  expect(quotaColor(70)).toBe(CODEX_COLORS.yellow)
  expect(quotaColor(85)).toBe(CODEX_COLORS.yellow)
  expect(quotaColor(85.1)).toBe(CODEX_COLORS.red)
})

test('the usage endpoint answer yields the 5-hour, weekly and Fable windows', () => {
  expect(parseUsageEndpoint(ENDPOINT_ANSWER)).toEqual([
    { kind: 'five_hour', percentUsed: 4, resetsAt: '2026-10-15T09:09:59.655259+00:00' },
    { kind: 'seven_day', percentUsed: 68, resetsAt: '2026-10-20T13:59:59.655277+00:00' },
    { kind: 'model_weekly:Fable', percentUsed: 50, resetsAt: '2026-10-20T13:59:59.655421+00:00' },
  ])
  expect(parseUsageEndpoint(null)).toEqual([])
  expect(parseUsageEndpoint({ limits: 'nope' })).toEqual([])
  const merged = mergeWindows([{ kind: 'five_hour', percentUsed: 9 }], parseUsageEndpoint(ENDPOINT_ANSWER))
  expect(merged.map(window => `${window.kind}=${window.percentUsed}`)).toEqual(['five_hour=9', 'seven_day=68', 'model_weekly:Fable=50'])
})

test('the model ring takes the session model family, else the first model window', () => {
  const windows = [
    { kind: 'model_weekly:Opus', percentUsed: 10 },
    { kind: 'model_weekly:Fable', percentUsed: 50 },
  ]
  expect(pickModelWeeklyWindow(windows, 'claude-fable-5-1')?.percentUsed).toBe(50)
  expect(pickModelWeeklyWindow(windows, 'claude-opus-5-5')?.percentUsed).toBe(10)
  expect(pickModelWeeklyWindow(windows, '')?.percentUsed).toBe(10)
  expect(pickModelWeeklyWindow([{ kind: 'seven_day', percentUsed: 1 }])).toBeUndefined()
})

test('the widgets: Fable ring, 500k context bar, 5-hour ring and weekly ring', () => {
  const widgets = usageWidgets(USAGE, NOW, 'claude-fable-5-1')
  expect(widgets.modelWeekly.name).toBe('Fable')
  expect(widgets.context.label).toBe('110k')
  expect(widgets.context.figure).toBe('110k / 1M')
  expect(widgets.context.percentOfScale).toBe(22)
  expect(widgets.context.color).toBe(CODEX_COLORS.blue)
  expect(widgets.fiveHour?.percentUsed).toBe(23.5)
  expect(widgets.weekly?.percentUsed).toBe(57)
  // Fable: 88.9 % in 4 d 20 h, so the last 11.1 % lasts 14 h 30 min.
  expect(widgets.details).toEqual([
    'Context  : 110k / 1M',
    '5 h limit: 23% (Reset in 2 h 5 min. Lasts past reset.)',
    '7 d limit: 57% (Reset in 2 d 4 h.   Lasts past reset.)',
    'Fable    : 88% (Reset in 2 d 4 h.   Runs out in 14 h 30 min.)',
  ])
  expect(widgets.tooltips.model).toBe('Fable: 88% (Reset in 2 d 4 h. Runs out in 14 h 30 min.)')
  expect(widgets.tooltips.fiveHour).toBe('5 h limit: 23% (Reset in 2 h 5 min. Lasts past reset.)')
  expect(usageText(widgets)).toBe('Fable 88% · ctx 110k/1M · 5h 23% · 1w 57%')
  const smaller = usageWidgets({ ...USAGE, context: { tokens: 108_000, window: 990_000 } }, NOW)
  expect(smaller.details[0]).toBe('Context  : 108k / 990k')
})

test('without any reading every widget says so instead of showing zero', () => {
  const widgets = usageWidgets(null, NOW)
  expect(widgets.context.label).toBe('?')
  expect(widgets.details).toEqual(['Context  : ? / ?', '5 h limit: ?', '7 d limit: ?', 'Model    : ?'])
  expect(usageText(widgets)).toBe('Model ? · ctx ?/? · 5h ? · 1w ?')
})

test('the ring svg copies the Codex outer ring: round-capped arc, low-usage track, percentage inside', () => {
  const low = quotaRingSvg(4, '5 h limit: 4%')
  expect(low.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 32 32"')).toBe(true)
  expect(low).toContain('<title>5 h limit: 4%</title>')
  // 4 % is under 25 %: the grey track shows behind the arc.
  expect(low).toContain('<circle cx="16" cy="16" r="11" fill="none" stroke="rgba(128,128,128,0.38)" stroke-width="2"/>')
  expect(low).toContain(`stroke="${CODEX_COLORS.green}" stroke-width="2" stroke-linecap="round"`)
  expect(low).toContain('>4</text>')
  const high = quotaRingSvg(68, '7 d limit: 68%')
  expect(high).not.toContain('rgba(128,128,128,0.38)')
  expect(high).toContain(`stroke="${CODEX_COLORS.green}"`)
  expect(high).toContain('>68</text>')
  const full = quotaRingSvg(100, 'x')
  expect(full).toContain(`<circle cx="16" cy="16" r="11" fill="none" stroke="${CODEX_COLORS.red}" stroke-width="2"/>`)
  expect(full).toContain('y="19.5"')
  expect(full).toContain('>100</text>')
  const empty = quotaRingSvg(null, 'x')
  expect(empty).not.toContain('<path')
  expect(empty).toContain('>?</text>')
  const model = quotaRingSvg(50, 'Fable: 50%')
  expect(model).toContain('<title>Fable: 50%</title>')
  expect(model).toContain('<path d="M 16 5 A 11 11 0 0 1 16 27"')
  // The digits' own middle on the ring's centre: baseline 0.35 em below it.
  expect(model).toContain('<text x="16" y="20.2" text-anchor="middle"')
  expect(model).toContain('>50</text>')
  const bar = contextBarSvg(22, CODEX_COLORS.blue, 'Context')
  expect(bar).toContain('width="48" height="24"')
  expect(bar).toContain(`<rect x="0" y="9" width="10.56" height="6" rx="3" fill="${CODEX_COLORS.blue}"/>`)
})
