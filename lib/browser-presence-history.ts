import "server-only"

import { prisma } from "@/lib/prisma"
import {
  ACTIVE_BROWSER_WINDOW_MS,
  BrowserPresenceHistorySampler,
  type BrowserPresenceIntervalSample,
} from "@/lib/browser-presence"

interface BrowserPresenceHistoryState {
  sampler: BrowserPresenceHistorySampler
  pending: Map<number, BrowserPresenceIntervalSample>
  flushPromise: Promise<void> | null
}

const historyGlobal = globalThis as typeof globalThis & {
  pumpBrowserPresenceHistory?: BrowserPresenceHistoryState
}

const state = historyGlobal.pumpBrowserPresenceHistory ?? {
  sampler: new BrowserPresenceHistorySampler(),
  pending: new Map<number, BrowserPresenceIntervalSample>(),
  flushPromise: null,
}

historyGlobal.pumpBrowserPresenceHistory = state

async function flushPendingSamples(): Promise<void> {
  for (const sample of state.pending.values()) {
    const intervalStartedAt = new Date(sample.intervalStartedAt)
    await prisma.$executeRaw`
      INSERT INTO browser_presence_snapshots (
        interval_started_at,
        active_browsers,
        active_window_seconds
      ) VALUES (
        ${intervalStartedAt},
        ${sample.peakActiveBrowsers},
        ${ACTIVE_BROWSER_WINDOW_MS / 1_000}
      )
      ON CONFLICT (interval_started_at) DO UPDATE SET
        active_browsers = GREATEST(
          browser_presence_snapshots.active_browsers,
          EXCLUDED.active_browsers
        ),
        active_window_seconds = EXCLUDED.active_window_seconds
    `
    state.pending.delete(sample.intervalStartedAt)
  }
}

export async function recordBrowserPresenceHistory(
  activeBrowsers: number,
  now = Date.now(),
): Promise<void> {
  const completed = state.sampler.observe(activeBrowsers, now)
  if (completed) state.pending.set(completed.intervalStartedAt, completed)
  if (state.pending.size === 0) return
  state.flushPromise ??= flushPendingSamples().finally(() => {
    state.flushPromise = null
  })
  await state.flushPromise
}
