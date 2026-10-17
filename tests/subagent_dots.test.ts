import { expect, test } from 'claude-code/testing'

import type { SubagentRecord } from '../types'
import {
  SUBAGENT_DOT_LIMIT,
  SUBAGENT_HISTORY_LIMIT,
  mergeListedAgents,
  recordSpawn,
  recordTurnEnd,
  subagentDotsSvg,
  subagentDotsWidth,
  subagentLines,
  subagentSummary,
  subagentText,
} from '../hooks/subagent_dots'

function record(id: string, state: SubagentRecord['state'], hasBeenListed = true): SubagentRecord {
  return { id, description: `task ${id}`, type: 'Explore', state, startedAtMs: 0, hasBeenListed }
}

test('a spawned subagent runs until its turn ends with an outcome', async () => {
  const spawned = recordSpawn([], { id: 'a', description: 'Find the config', type: 'Explore' }, 1_000)
  expect(spawned).toEqual([
    { id: 'a', description: 'Find the config', type: 'Explore', state: 'running', startedAtMs: 1_000, hasBeenListed: false },
  ])
  expect(recordTurnEnd(spawned, 'a', 'answer', 5_000)[0]).toMatchObject({ state: 'completed', endedAtMs: 5_000 })
  expect(recordTurnEnd(spawned, 'a', 'error', 5_000)[0].state).toBe('failed')
  expect(recordTurnEnd(spawned, 'a', 'refusal', 5_000)[0].state).toBe('failed')
  expect(recordTurnEnd(spawned, 'a', 'aborted', 5_000)[0].state).toBe('stopped')
})

test('the engine list sets each listed state and adds the agents it lists first', async () => {
  const merged = mergeListedAgents(
    [record('a', 'running', false)],
    [
      { id: 'a', description: 'task a', type: 'Explore', status: 'killed' },
      { id: 'b', description: 'task b', type: 'Plan', status: 'pending' },
    ],
    2_000,
  )
  expect(merged.map(item => [item.id, item.state, item.hasBeenListed])).toEqual([
    ['a', 'stopped', true],
    ['b', 'running', true],
  ])
  expect(merged[0].endedAtMs).toBe(2_000)
})

test('an ended agent the engine dropped keeps its outcome; an active one listed before and gone is stopped', async () => {
  const records = [record('a', 'failed'), record('b', 'running'), record('c', 'running', false)]
  const merged = mergeListedAgents(records, [], 3_000)
  expect(merged.map(item => item.state)).toEqual(['failed', 'stopped', 'running'])
})

test('the history keeps the newest 50', async () => {
  let records: SubagentRecord[] = []
  for (let index = 0; index < SUBAGENT_HISTORY_LIMIT + 5; index += 1) {
    records = recordSpawn(records, { id: `agent-${index}`, description: '', type: 'Explore' }, index)
  }
  expect(records.length).toBe(SUBAGENT_HISTORY_LIMIT)
  expect(records[0].id).toBe('agent-5')
})

test('running dots pulse, ended dots stand still in their outcome color', async () => {
  const svg = subagentDotsSvg([record('a', 'completed'), record('b', 'failed'), record('c', 'stopped'), record('d', 'running')], 'tip')
  expect(svg).toContain('<title>tip</title>')
  expect(svg.match(/<animate /g)?.length).toBe(2)
  expect(svg).toContain('fill="#5abd7b"')
  expect(svg).toContain('fill="#ef6666"')
  expect(svg).toContain('fill="none" stroke="#9ca3af"')
  expect(svg).toContain('fill="#d97757"')
  expect(subagentDotsWidth([record('a', 'running')])).toBe(12)
})

test('more dots than fit show the newest with a count of the rest', async () => {
  const records = Array.from({ length: SUBAGENT_DOT_LIMIT + 3 }, (_, index) => record(`a${index}`, 'completed'))
  const svg = subagentDotsSvg(records, 'tip')
  expect(svg).toContain('>+3</text>')
  expect(svg.match(/<circle /g)?.length).toBe(SUBAGENT_DOT_LIMIT)
})

test('summary, tooltip lines and terminal text', async () => {
  const records = [
    { ...record('a', 'completed'), startedAtMs: 0, endedAtMs: 125_000 },
    record('b', 'failed'),
    { ...record('c', 'running'), startedAtMs: 10_000 },
  ]
  expect(subagentSummary(records)).toBe('Subagents: 1 running, 1 completed, 1 failed')
  // A running subagent's line has no clock, so the dots' source stays the same between redraws.
  expect(subagentLines(records)[0]).toBe('Running  Explore: task c')
  expect(subagentLines(records)[2]).toBe('Completed  Explore: task a (2 min 5 s)')
  expect(subagentText(records)).toBe('Agents 1 running · 1 done · 1 failed')
})
