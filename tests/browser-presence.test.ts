import assert from "node:assert/strict"
import test from "node:test"

import { BrowserPresenceHistorySampler, BrowserPresenceTracker } from "@/lib/browser-presence"

test("browser presence deduplicates repeated heartbeats from one browser", () => {
  const tracker = new BrowserPresenceTracker(75_000, 100)
  assert.equal(tracker.touch("browser-a", 1_000), 1)
  assert.equal(tracker.touch("browser-a", 20_000), 1)
  assert.equal(tracker.touch("browser-b", 20_000), 2)
})

test("browser presence expires sessions outside the active window", () => {
  const tracker = new BrowserPresenceTracker(75_000, 100)
  tracker.touch("browser-a", 1_000)
  tracker.touch("browser-b", 50_000)
  assert.equal(tracker.activeCount(75_999), 2)
  assert.equal(tracker.activeCount(76_000), 1)
  assert.equal(tracker.activeCount(125_000), 0)
})

test("browser presence stays bounded and evicts the oldest session", () => {
  const tracker = new BrowserPresenceTracker(1_000_000, 2)
  tracker.touch("browser-a", 1_000)
  tracker.touch("browser-b", 2_000)
  assert.equal(tracker.touch("browser-c", 3_000), 2)
  assert.equal(tracker.touch("browser-a", 4_000), 2)
})

test("presence history stores one peak sample for each completed interval", () => {
  const sampler = new BrowserPresenceHistorySampler(300_000)
  assert.equal(sampler.observe(2, 10_000), null)
  assert.equal(sampler.observe(7, 120_000), null)
  assert.equal(sampler.observe(4, 299_999), null)
  assert.deepEqual(sampler.observe(3, 300_000), {
    intervalStartedAt: 0,
    peakActiveBrowsers: 7,
  })
  assert.equal(sampler.observe(5, 450_000), null)
  assert.deepEqual(sampler.observe(1, 600_000), {
    intervalStartedAt: 300_000,
    peakActiveBrowsers: 5,
  })
})

test("presence history does not roll the interval backward when the clock moves", () => {
  const sampler = new BrowserPresenceHistorySampler(300_000)
  sampler.observe(3, 350_000)
  assert.equal(sampler.observe(9, 250_000), null)
  assert.deepEqual(sampler.observe(2, 600_000), {
    intervalStartedAt: 300_000,
    peakActiveBrowsers: 9,
  })
})
