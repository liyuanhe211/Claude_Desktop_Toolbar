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
    }
  }
}
