// Most recently used first, at most 100 absolute paths.
export type RecentFolderList = string[]

// One rate-limit window as `$.session.usage()` reports it (five_hour, seven_day, seven_day_<tier>...).
export type UsageWindow = { kind: string; percentUsed: number; resetsAt?: string }

// The figures the usage widgets draw, taken from `$.session.usage()` / `session.measure`.
export type UsageSnapshot = {
  context: { tokens?: number; window: number; percent?: number }
  rateLimits: UsageWindow[]
}

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
    }
  }
}
