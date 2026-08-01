import assert from "node:assert/strict"
import test from "node:test"

import { getFeedStaleReason, isFeedFatallyStale } from "../lib/ingest-feed-health"

const base = {
  nowMs: 200_000,
  connectedAtMs: 100_000,
  lastProtocolMessageAtMs: 199_000,
  lastTradeMessageAtMs: 199_000,
  protocolStaleAfterMs: 45_000,
  tradeStaleAfterMs: 60_000,
}

test("detects a zombie feed even while protocol heartbeats remain current", () => {
  assert.equal(
    getFeedStaleReason({ ...base, lastTradeMessageAtMs: 120_000 }),
    "trade_stream_idle_timeout",
  )
})

test("keeps a connection healthy when real trades are current", () => {
  assert.equal(getFeedStaleReason(base), null)
})

test("prioritizes an entirely idle connection over trade inactivity", () => {
  assert.equal(
    getFeedStaleReason({ ...base, lastProtocolMessageAtMs: 100_000, lastTradeMessageAtMs: 100_000 }),
    "inbound_idle_timeout",
  )
})

test("uses connection time as startup grace until the first trade arrives", () => {
  assert.equal(getFeedStaleReason({ ...base, connectedAtMs: 150_000, lastTradeMessageAtMs: 0 }), null)
  assert.equal(
    getFeedStaleReason({ ...base, connectedAtMs: 140_000, lastTradeMessageAtMs: 0 }),
    "trade_stream_idle_timeout",
  )
})

test("fatal watchdog is based on the last real trade, not protocol activity", () => {
  assert.equal(isFeedFatallyStale(400_000, 100_000, 110_000, 300_000), false)
  assert.equal(isFeedFatallyStale(410_000, 100_000, 110_000, 300_000), true)
  assert.equal(isFeedFatallyStale(400_000, 100_000, 0, 300_000), true)
})
