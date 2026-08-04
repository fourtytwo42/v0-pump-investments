export const ACTIVE_BROWSER_WINDOW_MS = 75_000
export const MAX_TRACKED_BROWSERS = 100_000
export const PRESENCE_HISTORY_INTERVAL_MS = 5 * 60_000

export interface BrowserPresenceIntervalSample {
  intervalStartedAt: number
  peakActiveBrowsers: number
}

export class BrowserPresenceHistorySampler {
  private intervalStartedAt: number | null = null
  private peakActiveBrowsers = 0

  constructor(private readonly intervalMs = PRESENCE_HISTORY_INTERVAL_MS) {}

  observe(activeBrowsers: number, now = Date.now()): BrowserPresenceIntervalSample | null {
    const intervalStartedAt = Math.floor(now / this.intervalMs) * this.intervalMs
    if (this.intervalStartedAt === null) {
      this.intervalStartedAt = intervalStartedAt
      this.peakActiveBrowsers = activeBrowsers
      return null
    }
    if (intervalStartedAt <= this.intervalStartedAt) {
      this.peakActiveBrowsers = Math.max(this.peakActiveBrowsers, activeBrowsers)
      return null
    }
    const completed = {
      intervalStartedAt: this.intervalStartedAt,
      peakActiveBrowsers: this.peakActiveBrowsers,
    }
    this.intervalStartedAt = intervalStartedAt
    this.peakActiveBrowsers = activeBrowsers
    return completed
  }
}

export class BrowserPresenceTracker {
  private readonly lastSeen = new Map<string, number>()

  constructor(
    private readonly activeWindowMs = ACTIVE_BROWSER_WINDOW_MS,
    private readonly maxEntries = MAX_TRACKED_BROWSERS,
  ) {}

  touch(browserId: string, now = Date.now()): number {
    this.prune(now)
    if (!this.lastSeen.has(browserId) && this.lastSeen.size >= this.maxEntries) {
      this.evictOldest()
    }
    this.lastSeen.delete(browserId)
    this.lastSeen.set(browserId, now)
    return this.lastSeen.size
  }

  activeCount(now = Date.now()): number {
    this.prune(now)
    return this.lastSeen.size
  }

  private prune(now: number): void {
    const cutoff = now - this.activeWindowMs
    for (const [browserId, seenAt] of this.lastSeen) {
      if (seenAt > cutoff) break
      this.lastSeen.delete(browserId)
    }
  }

  private evictOldest(): void {
    const oldestId = this.lastSeen.keys().next().value
    if (typeof oldestId === "string") this.lastSeen.delete(oldestId)
  }
}

const presenceGlobal = globalThis as typeof globalThis & {
  pumpBrowserPresence?: BrowserPresenceTracker
}

export const browserPresence =
  presenceGlobal.pumpBrowserPresence ?? new BrowserPresenceTracker()

presenceGlobal.pumpBrowserPresence = browserPresence
