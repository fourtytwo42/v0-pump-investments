export const ACTIVE_BROWSER_WINDOW_MS = 75_000
export const MAX_TRACKED_BROWSERS = 100_000

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
