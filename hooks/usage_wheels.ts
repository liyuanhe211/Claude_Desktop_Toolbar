// Pure helpers for the usage widgets at the right end of the toolbar, left to
// right: the model's weekly ring (Fable), the token count and the context bar,
// then the 5-hour ring and the weekly ring, every ring the same: the Codex
// outer arc with the whole percentage inside. Drawing rules and colors are
// copied from the author's Codex usage widget (its rings.mjs and Widget.cs).
// No engine calls here.

import type { UsageSnapshot, UsageWindow } from '../types'

export type UsageWidgets = {
  // The weekly window scoped to one model (Fable), as the usage endpoint lists it.
  modelWeekly: { window: UsageWindow | undefined; name: string }
  // `label` is the count alone ("110k"), `figure` the count over the window ("110k / 1M").
  context: { tokens: number | null; percentOfScale: number | null; color: string; label: string; figure: string }
  fiveHour: UsageWindow | undefined
  weekly: UsageWindow | undefined
  // The detail block's lines, every column padded for Consolas:
  // "Context  : 350k / 1M",
  // "5 h limit: 91% (Reset in 4 h 10 min. Runs out in       5 min.)",
  // "7 d limit: 76% (Reset in 5 d 14 h.   Runs out in 10 h 45 min.)", "Fable    : ...".
  lines: { context: string; fiveHour: string; weekly: string; model: string }
  // The same figures with single spaces, for the tooltips:
  // "5 h limit: 91% (Reset in 4 h 2 min. Runs out in 25 min.)", "Context: 350k / 1M".
  tooltips: { context: string; fiveHour: string; weekly: string; model: string }
  // The detail block, in that order, then any other model's weekly window.
  details: string[]
}

export const RING_SIZE_PX = 24
export const BAR_WIDTH_PX = 48
export const BAR_HEIGHT_PX = 24
// The context bar is full at 500k tokens, whatever the model's own window.
export const CONTEXT_BAR_SCALE_TOKENS = 500_000
// A model-scoped weekly window, as the usage endpoint's limits[] lists it.
export const MODEL_WEEKLY_KIND_PREFIX = 'model_weekly:'

// The Codex usage widget's palette and thresholds.
export const CODEX_COLORS = { blue: '#4797ed', green: '#5abd7b', yellow: '#eeb347', red: '#ef6666' } as const
const UNKNOWN_COLOR = '#9ca3af'
// Below this share the unused part shows a grey track, as the Codex widget does.
const LOW_USAGE_VISIBILITY_PERCENT = 25
const TRACK_COLOR = 'rgba(128,128,128,0.38)'

// rings.mjs contextColor, for a window of 280k tokens or more.
export function contextColor(tokens: number | null): string {
  if (tokens === null) {
    return UNKNOWN_COLOR
  }
  return tokens > 400_000 ? CODEX_COLORS.red : tokens >= 300_000 ? CODEX_COLORS.yellow : CODEX_COLORS.blue
}

// rings.mjs quotaColor.
export function quotaColor(percent: number | null): string {
  if (percent === null) {
    return UNKNOWN_COLOR
  }
  return percent > 85 ? CODEX_COLORS.red : percent >= 70 ? CODEX_COLORS.yellow : CODEX_COLORS.green
}

// Whole percent, rounded down as the Codex widget shows it (99.9 → 99).
export function wholePercent(percent: number | null): string {
  return percent === null ? '?' : `${Math.max(0, Math.floor(percent))}%`
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}k`
  }
  return String(tokens)
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

const DURATION_UNITS = ['d', 'h', 'min'] as const
type DurationUnit = (typeof DURATION_UNITS)[number]
type DurationPart = { unit: DurationUnit; value: number }

// The two largest units of a span of time: days and hours, hours and minutes,
// or minutes alone.
export function durationParts(durationMs: number): DurationPart[] {
  const minutes = Math.max(0, Math.ceil(durationMs / MINUTE_MS))
  const days = Math.floor(minutes / 1_440)
  const hours = Math.floor((minutes % 1_440) / 60)
  const rest = minutes % 60
  if (days > 0) {
    return [{ unit: 'd', value: days }, { unit: 'h', value: hours }]
  }
  if (hours > 0) {
    return [{ unit: 'h', value: hours }, { unit: 'min', value: rest }]
  }
  return [{ unit: 'min', value: rest }]
}

// "5 d 3 h", "3 h 30 min", "35 min", single spaces.
export function formatDuration(durationMs: number): string {
  return durationParts(durationMs)
    .map(part => `${part.value} ${part.unit}`)
    .join(' ')
}

// Spans left-aligned in a monospaced column, number by number in reading order:
// each first number padded to the widest first number, each second to the
// widest second, so "5 d  3 h" stands under "3 h 30 min" and "5 d 14 h" under
// "4 h 10 min". Units may differ from row to row. Null stays null.
export function alignDurationsByPosition(durations: readonly (number | null)[]): (string | null)[] {
  const partLists = durations.map(duration => (duration === null ? null : durationParts(duration)))
  const widthAt = (position: number) =>
    Math.max(0, ...partLists.map(parts => (parts?.[position] === undefined ? 0 : String(parts[position].value).length)))
  const widths = [widthAt(0), widthAt(1)]
  return partLists.map(parts =>
    parts === null
      ? null
      : parts.map((part, position) => `${String(part.value).padStart(widths[position] ?? 0, ' ')} ${part.unit}`).join(' '),
  )
}

// Spans meant to stand one under another in a monospaced column. Every unit
// the column uses gets a slot as wide as its widest number, so "h" stands under
// "h" and "min" under "min"; a span without that unit leaves the slot blank:
// "      5 min", "10 h 45 min", " 4 h 39 min". Null stays null.
export function alignDurations(durations: readonly (number | null)[]): (string | null)[] {
  const partLists = durations.map(duration => (duration === null ? null : durationParts(duration)))
  const widths = new Map<DurationUnit, number>()
  partLists.flatMap(parts => parts ?? []).forEach(part => {
    widths.set(part.unit, Math.max(widths.get(part.unit) ?? 0, String(part.value).length))
  })
  const slots = DURATION_UNITS.filter(unit => widths.has(unit))
  return partLists.map(parts => {
    if (parts === null) {
      return null
    }
    return slots
      .map(unit => {
        const width = widths.get(unit) ?? 0
        const part = parts.find(candidate => candidate.unit === unit)
        return part === undefined ? ' '.repeat(width + 1 + unit.length) : `${String(part.value).padStart(width, ' ')} ${unit}`
      })
      .join(' ')
      .trimEnd()
  })
}

// Time left until the window resets, in milliseconds; null when unknown or past.
export function resetsInMs(resetsAt: string | undefined, nowMs: number): number | null {
  if (!resetsAt) {
    return null
  }
  const remaining = Date.parse(resetsAt) - nowMs
  return Number.isFinite(remaining) && remaining > 0 ? remaining : null
}

// How long each kind of window runs from one reset to the next.
export function windowLengthMs(kind: string): number {
  return kind === 'five_hour' ? 5 * HOUR_MS : 7 * DAY_MS
}

export type RunOut = { state: 'ranOut' } | { state: 'pastReset' } | { state: 'in'; durationMs: number }

// When the window runs out at the average rate since it began: the percentage
// used so far over the time elapsed in the window. Null without a reset time.
export function projectRunOut(window: UsageWindow, nowMs: number): RunOut | null {
  const remaining = resetsInMs(window.resetsAt, nowMs)
  if (remaining === null) {
    return null
  }
  if (window.percentUsed >= 100) {
    return { state: 'ranOut' }
  }
  const elapsed = windowLengthMs(window.kind) - remaining
  if (window.percentUsed <= 0 || elapsed <= 0) {
    return { state: 'pastReset' }
  }
  const untilFull = ((100 - window.percentUsed) * elapsed) / window.percentUsed
  return untilFull >= remaining ? { state: 'pastReset' } : { state: 'in', durationMs: untilFull }
}

// `duration` is the run-out span already written, plain or aligned.
function runOutText(runOut: RunOut, duration: string): string {
  if (runOut.state === 'ranOut') {
    return 'Ran out.'
  }
  if (runOut.state === 'pastReset') {
    return 'Lasts past reset.'
  }
  return `Runs out in ${duration}.`
}

// The model's context window, "1M"; "?" without a reading.
function formatWindow(window: number | undefined): string {
  return window !== undefined && Number.isFinite(window) && window > 0 ? formatTokens(window) : '?'
}

// Every label padded to this width, so the colons line up in a monospaced block.
const DETAIL_LABEL_WIDTH = 9

function detailLabel(label: string): string {
  return label.padEnd(DETAIL_LABEL_WIDTH, ' ')
}

// The model-scoped weekly window to show: the one for the session's model family
// when listed, else the first one listed (the Fable quota on this account).
export function pickModelWeeklyWindow(windows: readonly UsageWindow[], modelId = ''): UsageWindow | undefined {
  const scoped = windows.filter(window => window.kind.startsWith(MODEL_WEEKLY_KIND_PREFIX))
  const family = modelId.toLowerCase()
  return scoped.find(window => family.includes(window.kind.slice(MODEL_WEEKLY_KIND_PREFIX.length).toLowerCase())) ?? scoped[0]
}

// One window's figures before they are written out.
type WindowFigures = { label: string; percent: string; resetMs: number | null; runOut: RunOut | null }

function windowFigures(label: string, window: UsageWindow | undefined, nowMs: number): WindowFigures {
  if (window === undefined) {
    return { label, percent: '?', resetMs: null, runOut: null }
  }
  return {
    label,
    percent: wholePercent(window.percentUsed),
    resetMs: resetsInMs(window.resetsAt, nowMs),
    runOut: projectRunOut(window, nowMs),
  }
}

function runOutMs(runOut: RunOut | null): number | null {
  return runOut?.state === 'in' ? runOut.durationMs : null
}

// "5 h limit: 12% (Reset in 3 h 30 min. Runs out in 2 h 10 min.)", single spaces, for a tooltip.
function plainWindowLine(figures: WindowFigures): string {
  const reset = figures.resetMs === null ? null : `Reset in ${formatDuration(figures.resetMs)}.`
  const runOut = figures.runOut === null ? null : runOutText(figures.runOut, formatDuration(runOutMs(figures.runOut) ?? 0))
  const tail = [reset, runOut].filter((piece): piece is string => piece !== null).join(' ')
  return `${figures.label}: ${figures.percent}${tail ? ` (${tail})` : ''}`
}

// The window lines of the detail block for Consolas: the percentages
// right-aligned, the reset spans left-aligned number by number, "Runs out in"
// starting in one column and the run-out spans aligned unit by unit.
function alignedWindowLines(rows: readonly WindowFigures[]): string[] {
  const resets = alignDurationsByPosition(rows.map(row => row.resetMs)).map(span => (span === null ? null : `Reset in ${span}.`))
  const runOutSpans = alignDurations(rows.map(row => runOutMs(row.runOut)))
  const runOuts = rows.map((row, index) => (row.runOut === null ? null : runOutText(row.runOut, runOutSpans[index] ?? '')))
  const percentWidth = Math.max(0, ...rows.map(row => row.percent.length))
  const resetWidth = Math.max(0, ...resets.map(reset => reset?.length ?? 0))
  return rows.map((row, index) => {
    const head = `${detailLabel(row.label)}: ${row.percent.padStart(percentWidth, ' ')}`
    const reset = resets[index]
    const runOut = runOuts[index]
    if (reset === null || runOut === null) {
      return reset === null ? head : `${head} (${reset})`
    }
    return `${head} (${reset.padEnd(resetWidth, ' ')} ${runOut})`
  })
}

export function usageWidgets(usage: UsageSnapshot | null, nowMs: number, modelId = ''): UsageWidgets {
  const context = usage?.context
  const tokens = context?.tokens ?? null
  const percentOfScale = tokens === null ? null : (tokens / CONTEXT_BAR_SCALE_TOKENS) * 100
  const windows = usage?.rateLimits ?? []
  const modelWeekly = pickModelWeeklyWindow(windows, modelId)
  const name = modelWeekly === undefined ? 'Model' : modelWeekly.kind.slice(MODEL_WEEKLY_KIND_PREFIX.length)
  const fiveHour = windows.find(window => window.kind === 'five_hour')
  const weekly = windows.find(window => window.kind === 'seven_day')
  const otherModels = windows.filter(window => window.kind.startsWith(MODEL_WEEKLY_KIND_PREFIX) && window !== modelWeekly)

  const contextLabel = tokens === null ? '?' : formatTokens(tokens)
  // "110k / 1M": the count over the model's own context window.
  const contextFigure = `${contextLabel} / ${formatWindow(context?.window)}`
  // The windows in detail-block order: 5-hour, weekly, this model's, then other models'.
  const shown: [string, UsageWindow | undefined][] = [
    ['5 h limit', fiveHour],
    ['7 d limit', weekly],
    [name, modelWeekly],
    ...otherModels.map((window): [string, UsageWindow] => [window.kind.slice(MODEL_WEEKLY_KIND_PREFIX.length), window]),
  ]
  const alignedLines = alignedWindowLines(shown.map(([label, window]) => windowFigures(label, window, nowMs)))
  const plainLine = (label: string, window: UsageWindow | undefined) => plainWindowLine(windowFigures(label, window, nowMs))
  const lines = {
    context: `${detailLabel('Context')}: ${contextFigure}`,
    fiveHour: alignedLines[0],
    weekly: alignedLines[1],
    model: alignedLines[2],
  }

  return {
    modelWeekly: { window: modelWeekly, name },
    context: { tokens, percentOfScale, color: contextColor(tokens), label: contextLabel, figure: contextFigure },
    fiveHour,
    weekly,
    lines,
    tooltips: {
      context: `Context: ${contextFigure}`,
      fiveHour: plainLine('5 h limit', fiveHour),
      weekly: plainLine('7 d limit', weekly),
      model: plainLine(name, modelWeekly),
    },
    details: [lines.context, ...alignedLines],
  }
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function round(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

function fractionOf(percent: number | null): number {
  return percent === null ? 0 : Math.min(100, Math.max(0, percent)) / 100
}

function svgOpen(width: number, height: number, viewWidth: number, viewHeight: number, title: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${viewWidth} ${viewHeight}" role="img">` +
    `<title>${escapeXml(title)}</title>`
  )
}

// Widget.cs outer ring, in a 32-unit box: radius 11, width 2, round caps,
// clockwise from the top; a grey track while under 25 % used.
function outerArc(percent: number | null, color: string): string {
  const fraction = fractionOf(percent)
  const track =
    percent !== null && percent < LOW_USAGE_VISIBILITY_PERCENT
      ? `<circle cx="16" cy="16" r="11" fill="none" stroke="${TRACK_COLOR}" stroke-width="2"/>`
      : ''
  if (fraction >= 1) {
    return track + `<circle cx="16" cy="16" r="11" fill="none" stroke="${color}" stroke-width="2"/>`
  }
  if (fraction <= 0) {
    return track
  }
  const angle = fraction * 2 * Math.PI
  const endX = 16 + 11 * Math.sin(angle)
  const endY = 16 - 11 * Math.cos(angle)
  return (
    track +
    `<path d="M 16 5 A 11 11 0 ${fraction > 0.5 ? 1 : 0} 1 ${round(endX)} ${round(endY)}"` +
    ` fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`
  )
}

// Digits stand about 0.7 em tall on the baseline, so a baseline this far below
// the centre centres them; dominant-baseline="central" centres the font's whole
// ascent-to-descent box instead, which sits the digits low in Segoe UI.
const DIGIT_HALF_HEIGHT_EM = 0.35

// A quota ring (the Fable, 5-hour and weekly windows alike): the Codex outer
// ring with the whole percentage inside.
export function quotaRingSvg(percent: number | null, title: string, sizePx = RING_SIZE_PX): string {
  const color = quotaColor(percent)
  const text = percent === null ? '?' : String(Math.max(0, Math.floor(percent)))
  const fontSize = text.length > 2 ? 10 : 12
  return (
    svgOpen(sizePx, sizePx, 32, 32, title) +
    outerArc(percent, color) +
    `<text x="16" y="${round(16 + DIGIT_HALF_HEIGHT_EM * fontSize)}" text-anchor="middle" font-family="system-ui, sans-serif"` +
    ` font-size="${fontSize}" font-weight="600" fill="${color}">${text}</text>` +
    '</svg>'
  )
}

// A horizontal bar, full at CONTEXT_BAR_SCALE_TOKENS, in the context color.
export function contextBarSvg(percentOfScale: number | null, color: string, title: string): string {
  const width = BAR_WIDTH_PX
  const height = BAR_HEIGHT_PX
  const barHeight = 6
  const top = (height - barHeight) / 2
  const fraction = fractionOf(percentOfScale)
  return (
    svgOpen(width, height, width, height, title) +
    `<rect x="0" y="${top}" width="${width}" height="${barHeight}" rx="3" fill="${TRACK_COLOR}"/>` +
    (fraction > 0 ? `<rect x="0" y="${top}" width="${round(width * fraction)}" height="${barHeight}" rx="3" fill="${color}"/>` : '') +
    '</svg>'
  )
}

function percentField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function resetField(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') {
    return value
  }
  return typeof value === 'number' && Number.isFinite(value) ? new Date(value * 1000).toISOString() : undefined
}

// The windows in an answer of GET https://api.anthropic.com/api/oauth/usage:
// five_hour and seven_day ({ utilization: percent, resets_at }), and each
// limits[] entry of kind weekly_scoped with scope.model.display_name (the Fable
// quota) as `model_weekly:<display name>` ({ percent, resets_at }).
export function parseUsageEndpoint(body: unknown): UsageWindow[] {
  if (typeof body !== 'object' || body === null) {
    return []
  }
  const record = body as Record<string, unknown>
  const windows: UsageWindow[] = []
  for (const kind of ['five_hour', 'seven_day']) {
    const entry = record[kind]
    if (typeof entry === 'object' && entry !== null) {
      const percent = percentField((entry as Record<string, unknown>).utilization)
      if (percent !== undefined) {
        windows.push({ kind, percentUsed: percent, resetsAt: resetField((entry as Record<string, unknown>).resets_at) })
      }
    }
  }
  const limits = Array.isArray(record.limits) ? record.limits : []
  for (const limit of limits) {
    if (typeof limit !== 'object' || limit === null) {
      continue
    }
    const entry = limit as Record<string, unknown>
    const scope = entry.scope as { model?: { display_name?: unknown } } | null | undefined
    const name = scope?.model?.display_name
    const percent = percentField(entry.percent)
    if (entry.kind === 'weekly_scoped' && typeof name === 'string' && name !== '' && percent !== undefined) {
      windows.push({ kind: `${MODEL_WEEKLY_KIND_PREFIX}${name}`, percentUsed: percent, resetsAt: resetField(entry.resets_at) })
    }
  }
  return windows
}

// Where both name the same window the fresher reading wins: the engine's own
// (response headers) only while its responses are newer than the endpoint's
// answer, since an idle or finished session keeps its last turn's figures for
// good. The other source adds the windows the first lacks.
export function mergeWindows(
  fromSession: readonly UsageWindow[],
  fromEndpoint: readonly UsageWindow[],
  sessionReadAtMs: number,
  endpointFetchedAtMs: number,
): UsageWindow[] {
  const [first, second] = endpointFetchedAtMs > sessionReadAtMs ? [fromEndpoint, fromSession] : [fromSession, fromEndpoint]
  const kinds = new Set(first.map(window => window.kind))
  return [...first, ...second.filter(window => !kinds.has(window.kind))]
}

const DETAIL_FONT_SIZE_PX = 12
const DETAIL_LINE_HEIGHT_PX = 16
// Consolas advances 0.55 em per character.
const DETAIL_CHARACTER_WIDTH_PX = DETAIL_FONT_SIZE_PX * 0.55
const DETAIL_TEXT_COLOR = '#8a8a8a'

export function detailBlockSize(lines: readonly string[]): { width: number; height: number } {
  const longest = lines.reduce((maximum, line) => Math.max(maximum, line.length), 0)
  return {
    width: Math.ceil(longest * DETAIL_CHARACTER_WIDTH_PX) + 4,
    height: lines.length * DETAIL_LINE_HEIGHT_PX + 4,
  }
}

// The detail block in Consolas: one line per figure, spaces kept so the
// colons line up (Text takes no font, so the block is drawn as SVG text).
export function detailBlockSvg(lines: readonly string[]): string {
  const { width, height } = detailBlockSize(lines)
  const rows = lines
    .map(
      (line, index) =>
        `<text x="2" y="${2 + index * DETAIL_LINE_HEIGHT_PX + DETAIL_LINE_HEIGHT_PX / 2}" dominant-baseline="central" xml:space="preserve">${escapeXml(line)}</text>`,
    )
    .join('')
  return (
    svgOpen(width, height, width, height, lines.join('\n')) +
    `<g font-family="Consolas, 'Cascadia Mono', monospace" font-size="${DETAIL_FONT_SIZE_PX}" fill="${DETAIL_TEXT_COLOR}" style="white-space:pre">` +
    rows +
    '</g></svg>'
  )
}

// What a surface without Svg (the terminal) shows instead.
export function usageText(widgets: UsageWidgets): string {
  const percentOf = (window: UsageWindow | undefined) => wholePercent(window?.percentUsed ?? null)
  return [
    `${widgets.modelWeekly.name} ${percentOf(widgets.modelWeekly.window)}`,
    `ctx ${widgets.context.figure.replace(' / ', '/')}`,
    `5h ${percentOf(widgets.fiveHour)}`,
    `1w ${percentOf(widgets.weekly)}`,
  ].join(' · ')
}
