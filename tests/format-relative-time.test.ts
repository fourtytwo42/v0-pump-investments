import assert from "node:assert/strict"
import test from "node:test"

import { formatCompactTimeAgo } from "@/lib/format-relative-time"

const NOW = Date.UTC(2026, 6, 31, 12, 0, 0)

test("formats recent trade times as compact single-line values", () => {
  assert.equal(formatCompactTimeAgo((NOW - 59_000) / 1_000, NOW), "<1m ago")
  assert.equal(formatCompactTimeAgo((NOW - 12 * 60_000) / 1_000, NOW), "12m ago")
  assert.equal(formatCompactTimeAgo((NOW - 3 * 60 * 60_000) / 1_000, NOW), "3h ago")
  assert.equal(formatCompactTimeAgo((NOW - 6 * 24 * 60 * 60_000) / 1_000, NOW), "6d ago")
})

test("uses exact unit boundaries", () => {
  assert.equal(formatCompactTimeAgo((NOW - 60_000) / 1_000, NOW), "1m ago")
  assert.equal(formatCompactTimeAgo((NOW - 60 * 60_000) / 1_000, NOW), "1h ago")
  assert.equal(formatCompactTimeAgo((NOW - 24 * 60 * 60_000) / 1_000, NOW), "1d ago")
})

test("rejects invalid and future timestamps", () => {
  assert.equal(formatCompactTimeAgo(Number.NaN, NOW), "Unknown")
  assert.equal(formatCompactTimeAgo(0, NOW), "Unknown")
  assert.equal(formatCompactTimeAgo((NOW + 1_000) / 1_000, NOW), "Unknown")
  assert.equal(formatCompactTimeAgo(NOW / 1_000, Number.NaN), "Unknown")
})
