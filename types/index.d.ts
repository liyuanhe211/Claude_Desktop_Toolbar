// Most recently used first, at most 100 absolute paths.
export type RecentFolderList = string[]

// One rate-limit window as `$.session.usage()` reports it (five_hour, seven_day, seven_day_<tier>...).
export type UsageWindow = { kind: string; percentUsed: number; resetsAt?: string }

// The figures the usage widgets draw, taken from `$.session.usage()` / `session.measure`.
export type UsageSnapshot = {
  context: { tokens?: number; window: number; percent?: number }
  rateLimits: UsageWindow[]
}

// A subagent as the dots draw it: running, waiting (held) or idle (a teammate
// between turns) while active; completed, failed or stopped once ended.
export type SubagentState = 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'stopped'

export type SubagentRecord = {
  id: string
  description: string
  type: string
  state: SubagentState
  startedAtMs: number
  endedAtMs?: number
  // Whether `$.agent.list()` has listed it; one listed and then gone ended unseen.
  hasBeenListed: boolean
}

// A Monitor the main conversation started: active until its end notification,
// a TaskStop, or its deadline (absent for a persistent one) passes.
export type MonitorRecord = {
  id: string
  description: string
  startedAtMs: number
  deadlineMs?: number
  endedAtMs?: number
  // How it ended: the notification's status (completed, failed, killed...),
  // `stopped` for a TaskStop, `expired` past its deadline.
  outcome?: string
}

// The outcome of the last Copy Transcript Path press, shown on the button.
export type CopyFeedback = 'copied' | 'failed'

// How a button another program asked for moves: `dots` cycles three dots after its label.
export type ExternalButtonAnimation = 'dots' | 'none'

// A button another program asked for through the button folder.
export type ExternalButtonRecord = {
  id: string
  label: string
  animation: ExternalButtonAnimation
  pressedLabel: string
  // Pressed and waiting for the program to remove it.
  isPressed: boolean
}

// The buttons drawn now, newest first, and the animation frame they draw.
export type ExternalButtonState = { buttons: ExternalButtonRecord[]; frame: number }

declare module 'claude-code' {
  interface PluginState {
    'conversation-toolbar': {
      recentFolders: RecentFolderList
      usage: UsageSnapshot | null
      usageDetailsPinned: boolean
      // The folder a move was asked for that the session has not reached yet
      // (the desktop app moves it when a turn ends); null when none is pending.
      pendingMove: string | null
      // How many dots the pending-move note draws now, 1 to 6, cycling.
      movingDots: number
      // This session's subagents in launch order, at most 50, kept after the
      // engine drops them from `$.agent.list()`.
      subagents: SubagentRecord[]
      // This session's Monitors, at most 20, the newest last.
      monitors: MonitorRecord[]
      // What the Copy Transcript Path button says for a moment after a press;
      // null shows its own label.
      copyFeedback: CopyFeedback | null
      // Buttons other programs ask for, with their frame.
      externalButtons: ExternalButtonState
    }
  }
}
