import { expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'conversation-toolbar'
const STORED_FOLDERS = ['E:\\Projects\\Alpha', 'E:\\Projects\\Beta']
const APPDATA = 'C:\\Users\\Someone\\AppData\\Roaming'

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

test('the row shows the folder list with Browse as its last option, then Copy Transcript Path', async ($, on) => {
  mock.store(on, { recentFolders: STORED_FOLDERS, isSeededFromDesktopSessions: true })
  mock.env(on, { APPDATA })
  on('session.root', () => ({ value: 'E:\\Projects\\Alpha' }))
  on('session.turns', () => ({ value: 0 }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    const select = await ui.find({ key: 'recent-folders' })
    expect(select?.props.label).toBeUndefined()
    expect(select?.props.value).toBe('E:\\Projects\\Alpha')
    expect(select?.props.options).toEqual([
      { value: 'E:\\Projects\\Alpha', label: 'Alpha' },
      { value: 'E:\\Projects\\Beta', label: 'Beta' },
      { value: '<browse for a folder>', label: 'Browse…' },
    ])
    expect(await ui.find({ key: 'browse-folder' })).toBeUndefined()
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn.indexOf('copy-transcript-path')).toBeGreaterThan(drawn.indexOf('recent-folders'))
    await ui.unmount()
  }
})

test('temporary folders never show in the list', async ($, on) => {
  const stored = [
    'E:\\Projects\\Alpha',
    'C:\\Users\\Someone\\AppData\\Local\\Temp\\tmpzhq09fub',
    'E:\\Projects\\tmpplaqe_py',
    'E:\\_Claude_Desktop_Temp\\tmp9o3t47h4',
    'E:\\Projects\\Alpha\\_Claude_tmp',
    'D:\\Scratch\\run1',
    'E:\\Projects\\Beta',
  ]
  mock.store(on, { recentFolders: stored, isSeededFromDesktopSessions: true })
  mock.env(on, { APPDATA, TEMP: 'D:\\Scratch' })
  on('session.root', () => ({ value: 'E:\\Projects\\Alpha' }))
  on('session.turns', () => ({ value: 0 }))
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  const options = (await ui.find({ key: 'recent-folders' }))?.props.options as { value: string }[]
  expect(options.map(option => option.value)).toEqual(['E:\\Projects\\Alpha', 'E:\\Projects\\Beta', '<browse for a folder>'])
  await ui.unmount()
})

test('a scratch workspace shows as No folder', async ($, on) => {
  mock.store(on, { recentFolders: STORED_FOLDERS, isSeededFromDesktopSessions: true })
  mock.env(on, { APPDATA })
  on('session.root', () => ({ value: `${APPDATA}\\Claude\\scratch-workspaces\\abc\\def` }))
  on('session.turns', () => ({ value: 0 }))
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  const select = await ui.find({ key: 'recent-folders' })
  expect(select?.props.value).toBe('<no folder chosen>')
  expect((select?.props.options as { label: string }[])[0]?.label).toBe('No folder')
  await ui.unmount()
})

test('a current folder the list does not keep still shows first', async ($, on) => {
  mock.store(on, { recentFolders: STORED_FOLDERS, isSeededFromDesktopSessions: true })
  mock.env(on, { APPDATA })
  on('session.root', () => ({ value: 'E:\\Projects\\Alpha\\.claude\\worktrees\\fix' }))
  on('session.turns', () => ({ value: 3 }))
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  const select = await ui.find({ key: 'recent-folders' })
  expect(select?.props.value).toBe('E:\\Projects\\Alpha\\.claude\\worktrees\\fix')
  expect((select?.props.options as unknown[]).length).toBe(4)
  await ui.unmount()
})

test('picking a folder moves the session there and records it first', async ($, on) => {
  mock.store(on, { recentFolders: STORED_FOLDERS, isSeededFromDesktopSessions: true })
  mock.env(on, { APPDATA })
  const session = mock.session(on)
  let root = 'E:\\Projects\\Alpha'
  on('session.root', () => ({ value: root }))
  on('session.turns', () => ({ value: 0 }))
  const moves: unknown[] = []
  on('mcp.call', ($, e) => {
    moves.push({ server: e.server, tool: e.tool, args: e.args })

    return { value: { content: [{ type: 'text', text: 'Moved' }], isError: false } }
  })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await ui.find({ key: 'pending-move' })).toBeUndefined()
  await ui.select({ key: 'recent-folders', value: 'E:\\Projects\\Beta' })
  expect(moves).toEqual([
    { server: 'ccd_directory', tool: 'change_directory', args: { path: 'E:\\Projects\\Beta' } },
  ])
  const options = (await ui.find({ key: 'recent-folders' }))?.props.options as { value: string }[]
  expect(options.map(option => option.value)).toEqual(['E:\\Projects\\Beta', 'E:\\Projects\\Alpha', '<browse for a folder>'])
  expect(session.appended()).toEqual([])
  // The desktop app moves the session when a turn ends: until then the list
  // keeps the current folder and a grey note names the target.
  expect((await ui.find({ key: 'recent-folders' }))?.props.value).toBe('E:\\Projects\\Alpha')
  const pending = JSON.stringify(await ui.find({ key: 'pending-move' }))
  expect(pending).toContain('→')
  expect(pending).toContain('Beta')
  expect(pending).toContain('Moving after your next message.')
  await ui.unmount()
  // Once the session is in the target folder the note is gone.
  root = 'E:\\Projects\\Beta'
  const moved = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await moved.find({ key: 'pending-move' })).toBeUndefined()
  await moved.unmount()
})

test('a move refused during a turn leaves the model a note to move afterwards', async ($, on) => {
  mock.store(on, { recentFolders: STORED_FOLDERS, isSeededFromDesktopSessions: true })
  mock.env(on, { APPDATA })
  const session = mock.session(on)
  on('session.root', () => ({ value: 'E:\\Projects\\Alpha' }))
  on('session.turns', () => ({ value: 2 }))
  on('mcp.call', () => ({
    value: { content: [{ type: 'text', text: 'A turn is running' }], isError: true },
  }))
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'desktop',
    ...BAND,
    props: { ...BAND.props, isWorking: true },
  })
  await ui.select({ key: 'recent-folders', value: 'E:\\Projects\\Beta' })
  const texts = session
    .appended()
    .flatMap(row => row.message.content)
    .map(block => (block as { text?: string }).text)
  expect(texts).toEqual([
    'After this conversation turn is complete, move the working directory to E:\\Projects\\Beta.',
  ])
  expect(JSON.stringify(await ui.find({ key: 'pending-move' }))).toContain('Moving when this turn ends.')
  await ui.unmount()
})

test('a declined move leaves no note', async ($, on) => {
  mock.store(on, { recentFolders: STORED_FOLDERS, isSeededFromDesktopSessions: true })
  mock.env(on, { APPDATA })
  const session = mock.session(on)
  on('session.root', () => ({ value: 'E:\\Projects\\Alpha' }))
  on('session.turns', () => ({ value: 2 }))
  on('mcp.call', () => ({
    value: { content: [{ type: 'text', text: 'The user declined' }], isError: true },
  }))
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  await ui.select({ key: 'recent-folders', value: 'E:\\Projects\\Beta' })
  expect(session.appended()).toEqual([])
  expect(await ui.find({ key: 'pending-move' })).toBeUndefined()
  await ui.unmount()
})

test('/folder with a name moves to the matching recent folder', async ($, on) => {
  mock.store(on, { recentFolders: STORED_FOLDERS, isSeededFromDesktopSessions: true })
  mock.env(on, { APPDATA })
  on('session.turns', () => ({ value: 0 }))
  on('fs.exists', () => ({ value: true }))
  const moves: unknown[] = []
  on('mcp.call', ($, e) => {
    moves.push(e.args)

    return { value: { content: [{ type: 'text', text: 'Moved' }], isError: false } }
  })
  const result = await $.command.run({ command: 'folder', args: 'bet' })
  expect(moves).toEqual([{ path: 'E:\\Projects\\Beta' }])
  expect(result.text).toBe('This conversation starts in E:\\Projects\\Beta')
  expect((await $.command.run({ command: 'folder', args: 'gamma' })).text).toBe(
    'No recent folder matches "gamma"',
  )
})

test('the toolbar yields while an agent transcript is in view', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box key="engine-band" />
  })
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'desktop',
    ...BAND,
    props: { ...BAND.props, view: { agentId: 'agent-1' } },
  })
  expect(await ui.find({ key: 'copy-transcript-path' })).toBeUndefined()
  await ui.unmount()
})

const USAGE = {
  startedAt: 0,
  context: { tokens: 110_000, window: 1_000_000, percent: 11 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 23.5, resetsAt: '2099-01-01T00:00:00Z' },
    { kind: 'seven_day', percentUsed: 57, resetsAt: '2099-01-01T00:00:00Z' },
  ],
}

test('the usage widgets sit at the right end: Fable ring, count then context bar, 5-hour ring, weekly ring', async ($, on) => {
  mock.store(on, {
    recentFolders: STORED_FOLDERS,
    isSeededFromDesktopSessions: true,
    // What another session's last endpoint read left in the shared cache.
    usageEndpoint: { fetchedAtMs: Date.now(), windows: [{ kind: 'model_weekly:Fable', percentUsed: 50, resetsAt: '2099-01-01T00:00:00Z' }] },
  })
  mock.env(on, { APPDATA })
  on('session.root', () => ({ value: 'E:\\Projects\\Alpha' }))
  on('session.turns', () => ({ value: 0 }))
  on('session.model', () => ({ value: 'claude-fable-5-1' }))
  on('session.usage', () => ({ value: USAGE }))
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  const drawn = JSON.stringify(await ui.drawn())
  const order = ['copy-transcript-path', 'model-weekly-ring', 'usage-details', 'context-bar', 'five-hour-ring', 'seven-day-ring']
  for (let index = 1; index < order.length; index += 1) {
    expect(drawn.indexOf(order[index])).toBeGreaterThan(drawn.indexOf(order[index - 1]))
  }
  expect((await ui.find({ key: 'usage-details' }))?.props.label).toBe('110k')
  expect(drawn).toContain('"alt":"Fable: 50% (')
  expect(drawn).toContain('"alt":"Context: 110k / 1M"')
  expect(drawn).toContain('"alt":"5 h limit: 23% (')
  expect(drawn).toContain('"alt":"7 d limit: 57% (')
  // The detail row is drawn only while the count pins it open.
  expect(drawn).not.toContain('usage-detail-row')
  await ui.press({ key: 'usage-details' })
  const pinned = JSON.stringify(await ui.drawn())
  expect(pinned).toContain('usage-detail-row')
  expect(pinned).toContain('font-family=\\"Consolas')
  expect(pinned).toContain('xml:space=\\"preserve\\">Fable    : 50% (')
  expect(pinned).not.toContain('"display":"none"')
  await ui.press({ key: 'usage-details' })
  expect(JSON.stringify(await ui.drawn())).not.toContain('usage-detail-row')
  await ui.unmount()
})

test('a surface without Svg shows the usage as text, and no reading shows as unknown', async ($, on) => {
  mock.store(on, { recentFolders: STORED_FOLDERS, isSeededFromDesktopSessions: true })
  mock.env(on, { APPDATA })
  on('session.root', () => ({ value: 'E:\\Projects\\Alpha' }))
  on('session.turns', () => ({ value: 0 }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('Model ? · ctx ?/200k · 5h ? · 1w ?')
  expect(drawn).not.toContain('context-bar')
  expect(drawn).not.toContain('Context  : ? / 200k')
  await ui.press({ key: 'usage-details' })
  expect(JSON.stringify(await ui.drawn())).toContain('Context  : ? / 200k')
  await ui.unmount()
})

test('the folder list draws at most 64 options, the limit the engine accepts for a Select', async ($, on) => {
  const stored = Array.from({ length: 100 }, (_, index) => `E:\\Projects\\Folder${String(index).padStart(3, '0')}`)
  mock.store(on, { recentFolders: stored, isSeededFromDesktopSessions: true })
  mock.env(on, { APPDATA })
  on('session.root', () => ({ value: 'E:\\Projects\\Elsewhere' }))
  on('session.turns', () => ({ value: 0 }))
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  const options = (await ui.find({ key: 'recent-folders' }))?.props.options as { value: string }[]
  expect(options.length).toBe(64)
  expect(options[0].value).toBe('E:\\Projects\\Elsewhere')
  expect(options[1].value).toBe(stored[0])
  expect(options[63].value).toBe('<browse for a folder>')
  await ui.unmount()
})
