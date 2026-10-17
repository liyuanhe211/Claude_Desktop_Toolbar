import { expect, test } from 'claude-code/testing'

import {
  DEFAULT_BUTTON_LIFETIME_MS,
  EXTERNAL_BUTTON_LIMIT,
  ExternalButton,
  buttonRecords,
  isAnimating,
} from '../hooks/external_buttons'

const NO_BREAK_SPACE = ' '

function buttonFile(name: string, fields: Record<string, unknown>, mtimeMs = 1_000) {
  return { name, mtimeMs, text: JSON.stringify(fields) }
}

test('a button file gives its label, animation, pressed label and session', async () => {
  const button = ExternalButton.parse(
    buttonFile('report_export_42.json', {
      label: 'Exporting report',
      animation: 'dots',
      pressed_label: 'Cancelling export',
      session_id: 'session-1',
      expires_at_ms: 5_000,
    }),
  )
  expect(button?.id).toBe('report_export_42')
  expect(button?.pressFileName).toBe('report_export_42.pressed')
  expect(button?.isShownIn('session-1', 5_000)).toBe(true)
  expect(button?.isShownIn('session-2', 1_000)).toBe(false)
  expect(button?.isShownIn('session-1', 5_001)).toBe(false)
})

test('files that are not buttons are skipped', async () => {
  expect(ExternalButton.parse({ name: 'a.json', mtimeMs: 0, text: 'not json' })).toBeNull()
  expect(ExternalButton.parse(buttonFile('a.json', { label: '   ' }))).toBeNull()
  expect(ExternalButton.parse(buttonFile('a.pressed', { label: 'Stop' }))).toBeNull()
  expect(ExternalButton.parse(buttonFile('bad name.json', { label: 'Stop' }))).toBeNull()
})

test('a file without an expiry stops showing ten minutes after its last write; no session means every session', async () => {
  const button = ExternalButton.parse(buttonFile('stop.json', { label: 'Stop' }, 2_000))
  expect(button?.isShownIn('any-session', 2_000 + DEFAULT_BUTTON_LIFETIME_MS)).toBe(true)
  expect(button?.isShownIn('any-session', 2_001 + DEFAULT_BUTTON_LIFETIME_MS)).toBe(false)
})

test('the dots run three, one, two, padded to one width; a pressed button shows its pressed label', async () => {
  const button = ExternalButton.parse(
    buttonFile('edit.json', { label: 'Exporting report', animation: 'dots', pressed_label: 'Cancelling' }),
  )
  expect(button?.text(0, false)).toBe('Exporting report ...')
  expect(button?.text(1, false)).toBe(`Exporting report .${NO_BREAK_SPACE}${NO_BREAK_SPACE}`)
  expect(button?.text(2, false)).toBe(`Exporting report ..${NO_BREAK_SPACE}`)
  expect(button?.text(3, false)).toBe('Exporting report ...')
  expect(button?.text(1, true)).toBe(`Cancelling .${NO_BREAK_SPACE}${NO_BREAK_SPACE}`)
  const still = ExternalButton.parse(buttonFile('still.json', { label: 'Stop' }))
  expect(still?.text(5, false)).toBe('Stop')
  expect(still?.text(5, true)).toBe('Stop')
})

test('the records keep this session’s live buttons, newest first, pressed where a press file is', async () => {
  const files = [
    buttonFile('old.json', { label: 'Old', session_id: 'session-1' }, 1_000),
    buttonFile('new.json', { label: 'New', animation: 'dots', session_id: 'session-1' }, 3_000),
    buttonFile('other.json', { label: 'Other', session_id: 'session-2' }, 4_000),
    buttonFile('expired.json', { label: 'Expired', expires_at_ms: 1_500 }, 1_000),
  ]
  const records = buttonRecords(files, new Set(['old.pressed']), 'session-1', 2_000)
  expect(records).toEqual([
    { id: 'new', label: 'New', animation: 'dots', pressedLabel: 'New', isPressed: false },
    { id: 'old', label: 'Old', animation: 'none', pressedLabel: 'Old', isPressed: true },
  ])
  expect(isAnimating(records)).toBe(true)
  expect(isAnimating(records.slice(1))).toBe(false)

  const many = Array.from({ length: EXTERNAL_BUTTON_LIMIT + 2 }, (_, index) => buttonFile(`b${index}.json`, { label: `B${index}` }, index))
  expect(buttonRecords(many, new Set(), 'session-1', 0)).toHaveLength(EXTERNAL_BUTTON_LIMIT)
})
