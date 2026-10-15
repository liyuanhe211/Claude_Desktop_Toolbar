import { atom, read, update } from 'claude-code'
import type { EngineInterface, McpToolResult, Register } from 'claude-code'

import type { RecentFolderList, UsageSnapshot, UsageWindow } from '../types'
import {
  findFolder,
  folderIdentity,
  folderOptionLabel,
  isAbsoluteFolder,
  isFolderInside,
  isPickableFolder,
  joinWindowsPath,
  mergeFolderLists,
  normalizeFolder,
  placeFolderFirst,
  projectDirectoryName,
  rankSessionFolders,
  readFolderList,
  readSessionRecordFolder,
  type SessionRecordFolder,
} from './folder_list'
import {
  BAR_HEIGHT_PX,
  BAR_WIDTH_PX,
  RING_SIZE_PX,
  contextBarSvg,
  detailBlockSize,
  detailBlockSvg,
  mergeWindows,
  parseUsageEndpoint,
  quotaRingSvg,
  usageText,
  usageWidgets,
} from './usage_wheels'

type CopySurface = Parameters<EngineInterface['ui']['copy']>[0]['surface']

const STORE_KEY_RECENT_FOLDERS = 'recentFolders'
const STORE_KEY_IS_SEEDED = 'isSeededFromDesktopSessions'
const STORE_KEY_USAGE_ENDPOINT = 'usageEndpoint'
// The plan usage endpoint the engine's /usage reads (five_hour, seven_day and
// the model-scoped weekly windows in limits[]); the bearer header is the engine's.
const USAGE_ENDPOINT_URL = 'https://api.anthropic.com/api/oauth/usage'
const USAGE_ENDPOINT_BETA = 'oauth-2025-04-20'
const USAGE_ENDPOINT_INTERVAL_MS = 60_000
const SESSION_USAGE_INTERVAL_MS = 5_000
// The value in the folder list that opens the folder picker.
const BROWSE_OPTION = '<browse for a folder>'
// The engine refuses a Select with more than 64 options (and with it the whole
// band), so the list draws at most that many; the store still keeps 100.
const SELECT_OPTION_LIMIT = 64
// Newest records first; enough to cover months of sessions without reading
// every record the desktop app has ever kept.
const SESSION_RECORD_READ_LIMIT = 1500
const FOLDER_PICKER_TIMEOUT_MS = 10 * 60 * 1000
const NO_FOLDER_CHOSEN = '<no folder chosen>'
// Columns the folder labels may take: what the band leaves beside the Browse
// and Copy buttons, kept between a readable minimum and a tidy maximum.
const COLUMNS_BESIDE_FOLDER_LABEL = 40
const MINIMUM_FOLDER_LABEL_WIDTH = 24
const MAXIMUM_FOLDER_LABEL_WIDTH = 72

const recentFoldersState = { plugin: 'conversation-toolbar', key: 'recentFolders' } as const
const usageAtom = atom({ plugin: 'conversation-toolbar', key: 'usage' } as const, null as UsageSnapshot | null)
// Whether the usage detail row stays open (toggled by the token-count button).
const usageDetailsPinnedAtom = atom({ plugin: 'conversation-toolbar', key: 'usageDetailsPinned' } as const, false)

type MoveOutcome = { isMoved: true } | { isMoved: false; reason: string; isDeclined: boolean }

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function moveAfterTurnMessage(folder: string): string {
  return `After this conversation turn is complete, move the working directory to ${folder}.`
}

async function resolveConfigDirectory($: EngineInterface): Promise<string> {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  if (configured) {
    return configured
  }
  const userProfile = await $.env.get('USERPROFILE')
  const home = userProfile ?? (await $.env.get('HOME')) ?? ''

  return joinWindowsPath(home, '.claude')
}

async function resolveTranscriptPath($: EngineInterface): Promise<string> {
  const sessionId = await $.session.id()
  const projectsDirectory = joinWindowsPath(await resolveConfigDirectory($), 'projects')
  const fileName = `${sessionId}.jsonl`

  const expected = joinWindowsPath(
    projectsDirectory,
    projectDirectoryName(await $.session.cwd()),
    fileName,
  )
  if (await $.fs.exists(expected)) {
    return expected
  }

  // The working directory may have changed since the session started; search
  // every project folder for this session's transcript.
  const entries = await $.fs.list(projectsDirectory).catch(() => [])
  for (const entry of entries) {
    if (entry.kind !== 'dir') {
      continue
    }
    const candidate = joinWindowsPath(projectsDirectory, entry.name, fileName)
    if (await $.fs.exists(candidate)) {
      return candidate
    }
  }

  return expected
}

async function copyToClipboard(
  $: EngineInterface,
  text: string,
  surface?: CopySurface,
): Promise<boolean> {
  const copied = await $.ui.copy({ text, surface }).catch(() => ({ isCopied: false }))
  if (copied.isCopied) {
    return true
  }

  // A remote surface such as the desktop app may not take the copy; fall back
  // to the Windows clipboard directly.
  const script =
    '[Console]::InputEncoding = [System.Text.Encoding]::UTF8; ' +
    'Set-Clipboard -Value ([Console]::In.ReadToEnd())'
  const result = await $.process
    .run(['powershell', '-NoProfile', '-NonInteractive', '-Command', script], {
      stdin: text,
      timeoutMs: 15000,
    })
    .catch(() => undefined)

  return result?.exitCode === 0
}

async function copyTranscriptPath($: EngineInterface, surface?: CopySurface): Promise<string> {
  const path = await resolveTranscriptPath($)
  const isCopied = await copyToClipboard($, path, surface)
  const message = isCopied
    ? `Copied transcript path: ${path}`
    : `Could not copy; the transcript path is ${path}`
  $.ui.toast(message)

  return message
}

async function resolveAppDataDirectory($: EngineInterface): Promise<string | undefined> {
  return (await $.env.get('APPDATA')) || undefined
}

async function resolveScratchRoot($: EngineInterface): Promise<string | undefined> {
  const appData = await resolveAppDataDirectory($)

  return appData === undefined ? undefined : joinWindowsPath(appData, 'Claude', 'scratch-workspaces')
}

async function resolveTemporaryRoots($: EngineInterface): Promise<string[]> {
  // $.env.get takes a literal name, so the module's variables can be listed.
  const values = [
    await $.env.get('TEMP').catch(() => undefined),
    await $.env.get('TMP').catch(() => undefined),
    await $.env.get('CLAUDE_CODE_TMPDIR').catch(() => undefined),
  ]

  return values.filter((value): value is string => typeof value === 'string' && value !== '')
}

// What a person can pick: the stored list less scratch, worktree and temporary
// folders (older versions recorded some of those).
async function pickableFolderFilter($: EngineInterface): Promise<(folder: string) => boolean> {
  const scratchRoot = await resolveScratchRoot($)
  const temporaryRoots = await resolveTemporaryRoots($)

  return folder => isPickableFolder(folder, scratchRoot, temporaryRoots)
}

async function readStoredFolders($: EngineInterface): Promise<RecentFolderList> {
  const isPickable = await pickableFolderFilter($)

  return readFolderList(await $.store.get(STORE_KEY_RECENT_FOLDERS)).filter(isPickable)
}

// Other sessions write the same store, so every change starts from what it
// holds now rather than from this session's copy.
async function saveRecentFolders(
  $: EngineInterface,
  change: (stored: RecentFolderList) => RecentFolderList,
): Promise<void> {
  const folders = change(await readStoredFolders($))
  await $.store.set(STORE_KEY_RECENT_FOLDERS, folders)
  await $.state.set(recentFoldersState, folders)
}

async function recordFolder($: EngineInterface, folder: string): Promise<void> {
  if (!(await pickableFolderFilter($))(folder)) {
    return
  }
  await saveRecentFolders($, stored => placeFolderFirst(stored, folder))
}

type SessionRecordFile = { path: string; mtimeMs: number }

// <APPDATA>\Claude\claude-code-sessions\<account>\<organization>\local_<id>.json
async function listSessionRecordFiles(
  $: EngineInterface,
  sessionsRoot: string,
): Promise<SessionRecordFile[]> {
  const files: SessionRecordFile[] = []
  for (const account of await $.fs.list(sessionsRoot).catch(() => [])) {
    if (account.kind !== 'dir') {
      continue
    }
    const accountPath = joinWindowsPath(sessionsRoot, account.name)
    for (const organization of await $.fs.list(accountPath).catch(() => [])) {
      if (organization.kind !== 'dir') {
        continue
      }
      const organizationPath = joinWindowsPath(accountPath, organization.name)
      for (const entry of await $.fs.list(organizationPath).catch(() => [])) {
        if (entry.kind === 'file' && /^local_.+\.json$/.test(entry.name)) {
          files.push({ path: joinWindowsPath(organizationPath, entry.name), mtimeMs: entry.mtimeMs })
        }
      }
    }
  }

  return files
}

// The first time the toolbar loads, the folders of the desktop app's own
// session records fill the list behind the ones already recorded.
async function seedFromDesktopSessions($: EngineInterface): Promise<void> {
  if ((await $.store.get(STORE_KEY_IS_SEEDED)) === true) {
    return
  }
  const appData = await resolveAppDataDirectory($)
  if (appData === undefined) {
    return
  }
  const sessionsRoot = joinWindowsPath(appData, 'Claude', 'claude-code-sessions')
  const files = (await listSessionRecordFiles($, sessionsRoot))
    .sort((first, second) => second.mtimeMs - first.mtimeMs)
    .slice(0, SESSION_RECORD_READ_LIMIT)
  const records: SessionRecordFolder[] = []
  for (const file of files) {
    const text = await $.fs.read(file.path).catch(() => undefined)
    const record = typeof text === 'string' ? readSessionRecordFolder(text, file.mtimeMs) : null
    if (record !== null) {
      records.push(record)
    }
  }
  const seeded = rankSessionFolders(records).filter(await pickableFolderFilter($))
  await saveRecentFolders($, stored => mergeFolderLists(stored, seeded))
  await $.store.set(STORE_KEY_IS_SEEDED, true)
}

function describeToolResult(result: McpToolResult): string {
  return result.content
    .map(block => (typeof block.text === 'string' ? block.text : ''))
    .join(' ')
    .trim()
}

// The desktop app's own tool: it asks the person to approve the folder (unless
// permissions are bypassed) and moves the session when the current turn ends.
async function moveSession($: EngineInterface, folder: string): Promise<MoveOutcome> {
  try {
    const result = await $.mcp.call('ccd_directory', 'change_directory', { path: folder })
    if (!result.isError) {
      return { isMoved: true }
    }
    const reason = describeToolResult(result) || 'the desktop app refused the move'

    return { isMoved: false, reason, isDeclined: /declin|denied|reject|cancel/i.test(reason) }
  } catch (error) {
    return { isMoved: false, reason: describeError(error), isDeclined: false }
  }
}

async function hasConversationStarted($: EngineInterface, isWorking: boolean): Promise<boolean> {
  return isWorking || (await $.session.turns()) > 0
}

// Returns what happened, for a toast or a command's output.
async function openFolder($: EngineInterface, folder: string, isWorking: boolean): Promise<string> {
  const target = normalizeFolder(folder)
  await recordFolder($, target).catch(() => undefined)
  const hasStarted = await hasConversationStarted($, isWorking)
  const outcome = await moveSession($, target)
  if (outcome.isMoved) {
    return hasStarted ? `Moving this conversation to ${target}` : `This conversation starts in ${target}`
  }
  if (outcome.isDeclined) {
    return `The move to ${target} was declined`
  }
  if (!hasStarted) {
    return `Could not open ${target}: ${outcome.reason}`
  }

  // A running conversation may refuse the move; leave the model a note to
  // make it once this turn is done.
  const appended = await $.session
    .append({
      message: { type: 'user', content: [{ type: 'text', text: moveAfterTurnMessage(target) }] },
    })
    .catch((error: unknown) => ({ deny: describeError(error) }))
  if ('deny' in appended) {
    return `Could not move to ${target}: ${outcome.reason}`
  }

  return `Could not move now (${outcome.reason}); Claude will move to ${target} after this turn`
}

async function openFolderWithToast($: EngineInterface, folder: string, isWorking: boolean): Promise<void> {
  $.ui.toast(await openFolder($, folder, isWorking))
}

// `/folder <name or path>`: the toolbar is drawn only once a session exists,
// so a new conversation can pick its folder with this as its first message.
async function runFolderCommand($: EngineInterface, query: string): Promise<string> {
  const wanted = query.trim().replace(/^"(.*)"$/, '$1')
  if (wanted === '') {
    return 'Pick a folder in the toolbar above the prompt, or name one: /folder <name or path>'
  }
  const folder = isAbsoluteFolder(wanted) ? wanted : findFolder(await readStoredFolders($), wanted)
  if (folder === undefined) {
    return `No recent folder matches "${wanted}"`
  }
  if (!(await $.fs.exists(folder).catch(() => false))) {
    return `${folder} does not exist`
  }

  return openFolder($, folder, false)
}

async function pickFolder($: EngineInterface, initialFolder: string | undefined): Promise<string | null> {
  const script = joinWindowsPath($.plugin.root, 'scripts', 'Pick_Folder.ps1')
  const argv = [
    'powershell',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-STA',
    '-File',
    script,
    '-Title',
    'Choose a folder for this conversation',
  ]
  if (initialFolder !== undefined) {
    argv.push('-InitialFolder', initialFolder)
  }
  const result = await $.process.run(argv, { timeoutMs: FOLDER_PICKER_TIMEOUT_MS })
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `the folder picker exited with code ${result.exitCode}`)
  }
  const folder = result.stdout.trim()

  return folder === '' ? null : folder
}

async function browseAndOpen($: EngineInterface, isWorking: boolean): Promise<void> {
  try {
    const lastUsedFolder = (await readStoredFolders($))[0]
    const folder = await pickFolder($, lastUsedFolder)
    if (folder !== null) {
      await openFolderWithToast($, folder, isWorking)
    }
  } catch (error) {
    $.ui.toast(`Could not show the folder picker: ${describeError(error)}`)
  }
}

// Module variables start over on a hot reload; this one only saves a redundant
// store write.
let lastRecordedFolder = ''

async function recordCurrentFolder($: EngineInterface): Promise<void> {
  const root = normalizeFolder(await $.session.root())
  if (folderIdentity(root) === lastRecordedFolder) {
    return
  }
  lastRecordedFolder = folderIdentity(root)
  await recordFolder($, root)
}

function usageSnapshot(usage: {
  context: { tokens?: number; window: number; percent?: number }
  rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]
}): UsageSnapshot {
  return {
    context: { tokens: usage.context.tokens, window: usage.context.window, percent: usage.context.percent },
    rateLimits: usage.rateLimits.map(window => ({ kind: window.kind, percentUsed: window.percentUsed, resetsAt: window.resetsAt })),
  }
}

type UsageEndpointCache = { fetchedAtMs: number; windows: UsageWindow[] }

function readUsageEndpointCache(value: unknown): UsageEndpointCache | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const cache = value as { fetchedAtMs?: unknown; windows?: unknown }
  if (typeof cache.fetchedAtMs !== 'number' || !Array.isArray(cache.windows)) {
    return null
  }
  const windows = cache.windows.filter(
    (window): window is UsageWindow =>
      typeof window === 'object' && window !== null && typeof window.kind === 'string' && typeof window.percentUsed === 'number',
  )

  return { fetchedAtMs: cache.fetchedAtMs, windows }
}

// Module variables start over on a hot reload, as the timers do.
let latestSessionUsage: UsageSnapshot | null = null
let usageEndpointRequest: Promise<void> | null = null

// The plan's usage windows, the Fable weekly quota among them, from the same
// endpoint the engine's /usage reads. Every session shares one cached answer,
// so the endpoint is asked at most once a minute however many sessions run.
async function refreshUsageEndpoint($: EngineInterface, maximumAgeMs: number): Promise<void> {
  const cached = readUsageEndpointCache(await $.store.get(STORE_KEY_USAGE_ENDPOINT))
  if (cached !== null && Date.now() - cached.fetchedAtMs < maximumAgeMs) {
    return
  }
  if (usageEndpointRequest !== null) {
    return usageEndpointRequest
  }
  usageEndpointRequest = (async () => {
    try {
      const authorization = await $.session.authorize()
      if (authorization === null) {
        return
      }
      const response = await $.http.fetch(USAGE_ENDPOINT_URL, {
        auth: authorization.handle,
        headers: { 'Content-Type': 'application/json', 'anthropic-beta': USAGE_ENDPOINT_BETA },
      })
      if (!response.ok) {
        $.ui.log(`The usage endpoint answered ${response.status}`, { to: 'debug' })
        return
      }
      const windows = parseUsageEndpoint(JSON.parse(response.text))
      await $.store.set(STORE_KEY_USAGE_ENDPOINT, { fetchedAtMs: Date.now(), windows })
    } catch (error: unknown) {
      $.ui.log(`Reading the usage endpoint failed: ${describeError(error)}`, { to: 'debug' })
    } finally {
      usageEndpointRequest = null
    }
  })()

  return usageEndpointRequest
}

// The snapshot the widgets draw: the session's context and header windows,
// with the endpoint's windows added. Not written to state from a render.
async function composeUsage($: EngineInterface): Promise<UsageSnapshot | null> {
  if (latestSessionUsage === null) {
    latestSessionUsage = usageSnapshot(await $.session.usage())
  }
  const cached = readUsageEndpointCache(await $.store.get(STORE_KEY_USAGE_ENDPOINT))

  return {
    context: latestSessionUsage.context,
    rateLimits: mergeWindows(latestSessionUsage.rateLimits, cached?.windows ?? []),
  }
}

// Writes the snapshot only when a figure changed, so a quiet session does not redraw.
async function publishUsage($: EngineInterface): Promise<void> {
  try {
    const snapshot = await composeUsage($)
    const current = await read($, usageAtom)
    if (JSON.stringify(current) !== JSON.stringify(snapshot)) {
      await update($, usageAtom, () => snapshot)
    }
  } catch (error: unknown) {
    $.ui.log(`Updating the usage widgets failed: ${describeError(error)}`, { to: 'debug' })
  }
}

async function refreshSessionUsage($: EngineInterface): Promise<void> {
  try {
    latestSessionUsage = usageSnapshot(await $.session.usage())
  } catch (error: unknown) {
    $.ui.log(`Reading the session usage failed: ${describeError(error)}`, { to: 'debug' })
    return
  }
  await publishUsage($)
}

// The usage widgets, left to right: the model's weekly ring (Fable), the
// context bar and its token count (a button that pins the detail row open),
// the 5-hour ring and the weekly ring, each ring drawn alike. Hovering a
// widget shows its SVG title as a tooltip; an Svg takes no press, so the count
// is the click target. The terminal gets one dim line and the detail row on demand.
function usageElements(
  $: EngineInterface,
  e: Parameters<Parameters<EngineInterface['ui']['resolve']>[0] extends infer Argument ? (argument: Argument) => void : never>[0],
  widgets: ReturnType<typeof usageWidgets>,
  isPinned: boolean,
) {
  const togglePin = () => void update($, usageDetailsPinnedAtom, value => !value)
  if (e.surface === 'terminal') {
    const { Box, Button, Text } = $.ui.resolve(e)

    return {
      row: (
        <Box key="usage-widgets" flexDirection="row" columnGap={1}>
          <Text dimColor>{usageText(widgets)}</Text>
          <Button key="usage-details" label={isPinned ? 'Hide' : 'Details'} plain dimColor onPress={togglePin} />
        </Box>
      ),
      details: isPinned ? (
        <Box key="usage-detail-row" flexDirection="column">
          {widgets.details.map(line => (
            <Text dimColor>{line}</Text>
          ))}
        </Box>
      ) : null,
    }
  }
  const { Box, Button, Svg } = $.ui.resolve(e)
  // Tooltips take the single-spaced sentences; only the pinned block is aligned.
  const { fiveHour: fiveHourLine, weekly: weeklyLine, model: modelLine, context: contextLine } = widgets.tooltips
  const detailSize = detailBlockSize(widgets.details)

  return {
    row: (
      <Box key="usage-widgets" flexDirection="row" columnGap={1} alignItems="center">
        <Box key="model-weekly-ring">
          <Svg
            source={quotaRingSvg(widgets.modelWeekly.window?.percentUsed ?? null, modelLine)}
            alt={modelLine}
            width={RING_SIZE_PX}
            height={RING_SIZE_PX}
            isInteractive
          />
        </Box>
        <Button key="usage-details" label={widgets.context.label} plain dimColor={!isPinned} onPress={togglePin} />
        <Box key="context-bar">
          <Svg
            source={contextBarSvg(widgets.context.percentOfScale, widgets.context.color, contextLine)}
            alt={contextLine}
            width={BAR_WIDTH_PX}
            height={BAR_HEIGHT_PX}
            isInteractive
          />
        </Box>
        <Box key="five-hour-ring">
          <Svg
            source={quotaRingSvg(widgets.fiveHour?.percentUsed ?? null, fiveHourLine)}
            alt={fiveHourLine}
            width={RING_SIZE_PX}
            height={RING_SIZE_PX}
            isInteractive
          />
        </Box>
        <Box key="seven-day-ring">
          <Svg
            source={quotaRingSvg(widgets.weekly?.percentUsed ?? null, weeklyLine)}
            alt={weeklyLine}
            width={RING_SIZE_PX}
            height={RING_SIZE_PX}
            isInteractive
          />
        </Box>
      </Box>
    ),
    // Drawn only while pinned: the desktop app does not hide a Box drawn
    // display "none", so a hover reveal would show the row all the time.
    // The block is Consolas text in an SVG, right-aligned under the widgets.
    details: isPinned ? (
      <Box key="usage-detail-row" flexDirection="row" justifyContent="flex-end">
        <Svg source={detailBlockSvg(widgets.details)} alt={widgets.details.join('; ')} width={detailSize.width} height={detailSize.height} />
      </Box>
    ) : null,
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'copy-transcript-path',
      description: 'Copy the path of this conversation transcript (.jsonl)',
    })
    await $.command.register({
      name: 'folder',
      description: 'Open or move this conversation to a recent folder (matched by name) or a path',
      argumentHint: '<name or path>',
    })
    await $.state.set(recentFoldersState, await readStoredFolders($))
    lastRecordedFolder = folderIdentity(e.cwd)
    await recordFolder($, e.cwd).catch(() => undefined)
    void seedFromDesktopSessions($).catch((error: unknown) =>
      $.ui.log(`Reading the desktop session records failed: ${describeError(error)}`, { to: 'debug' }),
    )
    // Live usage: the session's own figures (a free local read) every few
    // seconds, so the context bar follows each response within a turn; the
    // plan windows from the shared endpoint cache once a minute.
    void refreshUsageEndpoint($, USAGE_ENDPOINT_INTERVAL_MS - 5_000).then(() => refreshSessionUsage($))
    $.clock.every(SESSION_USAGE_INTERVAL_MS, () => void refreshSessionUsage($))
    $.clock.every(USAGE_ENDPOINT_INTERVAL_MS, () =>
      void refreshUsageEndpoint($, USAGE_ENDPOINT_INTERVAL_MS - 5_000).then(() => publishUsage($)),
    )

    return next(e)
  })

  // A session moved by the desktop app, the model or this toolbar records its
  // new folder at the next turn boundary.
  on('turn.start', async ($, e, next) => {
    await recordCurrentFolder($).catch(() => undefined)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await recordCurrentFolder($).catch(() => undefined)
    // A turn spends quota: ask the endpoint again unless another session just did.
    void refreshUsageEndpoint($, 15_000).then(() => refreshSessionUsage($))

    return result
  })

  // The engine measures the context fill and the rate-limit windows after each
  // turn and whenever a plan window moves a point; a moved window also asks
  // the endpoint again so the Fable ring follows.
  on('session.measure', async ($, e, next) => {
    latestSessionUsage = usageSnapshot({ context: e.context, rateLimits: e.rateLimits })
    await publishUsage($)
    if (e.changed.includes('rateLimits')) {
      void refreshUsageEndpoint($, 15_000).then(() => publishUsage($))
    }

    return next(e)
  })

  on('command.run', { command: 'copy-transcript-path' }, async $ => {
    return { text: await copyTranscriptPath($) }
  })

  on('command.run', { command: 'folder' }, async ($, e) => {
    return { text: await runFolderCommand($, e.args) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.view.agentId !== undefined) {
      return next(e)
    }

    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    const copyButton = (
      <Button
        key="copy-transcript-path"
        label="Copy Transcript Path"
        variant="secondary"
        onPress={press => void copyTranscriptPath($, press.surface)}
      />
    )
    // The usage widgets at the right end. Before the first publication the
    // figures are composed here (a render reads state, it never writes it).
    const usage = (await read($, usageAtom)) ?? (await composeUsage($).catch(() => null))
    const modelId = await $.session.model().catch(() => '')
    const usageParts = usageElements($, e, usageWidgets(usage, Date.now(), modelId), await read($, usageDetailsPinnedAtom))
    if (!('Select' in elements)) {
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" columnGap={1}>
            {copyButton}
            {usageParts.row}
          </Box>
          {usageParts.details}
        </Box>
      )
    }
    const { Select } = elements

    const recentFolders = await $.state.get(recentFoldersState)
    // Before session.start has filled the state (or in a test), read the store.
    const isPickable = await pickableFolderFilter($)
    const stored = (recentFolders.version === 0 ? await readStoredFolders($) : (recentFolders.value ?? [])).filter(isPickable)
    // The current folder always shows, even one the list does not keep (a
    // worktree); a scratch workspace shows as "No folder".
    const root = normalizeFolder(await $.session.root())
    const scratchRoot = await resolveScratchRoot($)
    const isScratch = scratchRoot !== undefined && isFolderInside(root, scratchRoot)
    const isListed = stored.some(folder => folderIdentity(folder) === folderIdentity(root))
    const folders = isScratch || isListed ? stored : [root, ...stored]
    const currentFolder = isScratch
      ? undefined
      : folders.find(folder => folderIdentity(folder) === folderIdentity(root))
    const labelWidth = Math.min(
      MAXIMUM_FOLDER_LABEL_WIDTH,
      Math.max(MINIMUM_FOLDER_LABEL_WIDTH, e.props.bodyColumns - COLUMNS_BESIDE_FOLDER_LABEL),
    )
    // The folders, then "Browse…" last, which opens the folder picker.
    const options = [
      ...[
        ...(currentFolder === undefined ? [{ value: NO_FOLDER_CHOSEN, label: 'No folder' }] : []),
        ...folders.map(folder => ({ value: folder, label: folderOptionLabel(folder, labelWidth) })),
      ].slice(0, SELECT_OPTION_LIMIT - 1),
      { value: BROWSE_OPTION, label: 'Browse…' },
    ]
    const isWorking = e.props.isWorking

    return (
      <Box flexDirection="column" width="100%">
      <Box flexDirection="row" justifyContent="space-between" columnGap={1} width="100%">
        <Box flexDirection="row" columnGap={1}>
          <Select
            key="recent-folders"
            options={options}
            value={currentFolder ?? NO_FOLDER_CHOSEN}
            onSelect={value => {
              if (value === BROWSE_OPTION) {
                // Redraw afterwards so the list shows the current folder again.
                void browseAndOpen($, isWorking).finally(() => $.ui.invalidate('ui.render'))
              } else if (value !== NO_FOLDER_CHOSEN) {
                void openFolderWithToast($, value, isWorking)
              }
            }}
          />
        </Box>
        <Box flexDirection="row" columnGap={2} alignItems="center">
          {copyButton}
          {usageParts.row}
        </Box>
      </Box>
      {usageParts.details}
      </Box>
    )
  })
}
