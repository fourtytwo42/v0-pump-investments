import assert from "node:assert/strict"
import test from "node:test"

import {
  MAX_TRACKING_WINDOW_MINUTES,
  MIN_RETENTION_HOURS,
  normalizeRetentionHours,
  normalizeRetentionMinutes,
  retentionCutoff,
} from "../lib/data-retention"

test("retention always covers twice the maximum product tracking window", () => {
  assert.equal(MAX_TRACKING_WINDOW_MINUTES, 60)
  assert.equal(MIN_RETENTION_HOURS, 2)
  assert.equal(normalizeRetentionHours("1"), 2)
  assert.equal(normalizeRetentionHours("3"), 3)
})

test("short-lived realtime state keeps a minimum recovery window", () => {
  assert.equal(normalizeRetentionMinutes("1", 15), 5)
  assert.equal(normalizeRetentionMinutes(undefined, 15), 15)
  assert.equal(retentionCutoff(1_000_000, 15, 60_000), 100_000)
})
