import assert from "node:assert/strict"
import test from "node:test"
import { tokenQuerySchema } from "@/lib/api-request"
import { ingestRetryDelayMs } from "@/lib/ingest-retry"
import { reduceTokenProvenance } from "@/lib/token-provenance"

test("source and venue are reduced independently", () => {
  assert.deepEqual(reduceTokenProvenance("pump"), {
    launchSource: "pump",
    tradeVenue: "pump_bonding",
  })
  assert.deepEqual(reduceTokenProvenance("pump_amm"), {
    launchSource: "unknown",
    tradeVenue: "pumpswap",
  })
  assert.deepEqual(reduceTokenProvenance("meteora_dbc", "moonshot"), {
    launchSource: "moonshot",
    tradeVenue: "meteora_dbc",
  })
  assert.deepEqual(reduceTokenProvenance("raydium_v4_amm"), {
    launchSource: "unknown",
    tradeVenue: "raydium_v4",
  })
})

test("ingest retry delay grows from two seconds and caps at five minutes", () => {
  assert.equal(ingestRetryDelayMs(1, () => 0), 2_000)
  assert.equal(ingestRetryDelayMs(2, () => 0), 4_000)
  assert.equal(ingestRetryDelayMs(20, () => 0), 300_000)
  assert.equal(ingestRetryDelayMs(20, () => 1), 360_000)
})

test("token request validation enforces collection and page limits", () => {
  assert.equal(tokenQuerySchema.safeParse({ pageSize: 100, favoriteMints: [] }).success, true)
  assert.equal(tokenQuerySchema.safeParse({ pageSize: 101 }).success, false)
  assert.equal(
    tokenQuerySchema.safeParse({ favoriteMints: Array.from({ length: 101 }, () => "1".repeat(32)) }).success,
    false,
  )
})

test("requested time ranges are retained exactly", () => {
  for (const timeRangeMinutes of [1, 10, 60]) {
    const result = tokenQuerySchema.parse({ timeRangeMinutes })
    assert.equal(result.timeRangeMinutes, timeRangeMinutes)
  }
})
