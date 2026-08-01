import assert from "node:assert/strict"
import test from "node:test"

import { deriveVerifiedBondingProgress } from "@/lib/bonding-display-progress"

test("display progress follows Pump curve reserves rather than market cap", () => {
  assert.equal(deriveVerifiedBondingProgress(0.748), 0.748)
  assert.equal(deriveVerifiedBondingProgress(71.9), 71.9)
  assert.equal(deriveVerifiedBondingProgress(94.45), 94.45)
})

test("verified bonding progress caps at 99 until graduation", () => {
  assert.equal(deriveVerifiedBondingProgress(99), 99)
  assert.equal(deriveVerifiedBondingProgress(100), 99)
})

test("missing or invalid verified progress produces zero", () => {
  assert.equal(deriveVerifiedBondingProgress(Number.NaN), 0)
  assert.equal(deriveVerifiedBondingProgress(null), 0)
  assert.equal(deriveVerifiedBondingProgress(-1), 0)
})
