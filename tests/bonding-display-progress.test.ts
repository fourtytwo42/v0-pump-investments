import assert from "node:assert/strict"
import test from "node:test"

import {
  BONDING_TARGET_SOL,
  deriveMarketCapBondingProgress,
} from "@/lib/bonding-display-progress"

test("higher market cap always produces higher display progress at the same SOL price", () => {
  const lower = deriveMarketCapBondingProgress(14_700, 74)
  const higher = deriveMarketCapBondingProgress(17_200, 74)

  assert.ok(higher > lower)
  assert.ok(lower > 47 && lower < 49)
  assert.ok(higher > 55 && higher < 57)
})

test("display progress caps at 99 until lifecycle verification graduates the token", () => {
  const targetUsd = BONDING_TARGET_SOL * 74
  assert.equal(deriveMarketCapBondingProgress(targetUsd, 74), 99)
  assert.equal(deriveMarketCapBondingProgress(targetUsd * 2, 74), 99)
})

test("invalid market cap or SOL prices produce zero display progress", () => {
  assert.equal(deriveMarketCapBondingProgress(Number.NaN, 74), 0)
  assert.equal(deriveMarketCapBondingProgress(10_000, 0), 0)
  assert.equal(deriveMarketCapBondingProgress(-1, 74), 0)
})
