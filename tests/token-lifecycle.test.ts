import assert from "node:assert/strict"
import test from "node:test"

import {
  classifyPumpSwapTradeEvidence,
  classifyPumpLifecycle,
  classifyLegacyRaydiumMigrationEvidence,
  deriveBondingProgress,
  isCompletedLifecycle,
  lifecycleRetryDelayMs,
  lifecycleRetrySchedule,
  reduceLifecycle,
} from "@/lib/token-lifecycle"

test("classifies a low-market-cap token with a PumpSwap pool as PumpSwap", () => {
  const result = classifyPumpLifecycle({
    mint: "4FqqLmDcRTeFBJkGUemYwhsUuSPCdUPS6TWqDaLCpump",
    complete: true,
    program: "pump",
    pump_swap_pool: "HZtgAKizc99FqEZTQaqVn2s5ehY3bpHeqzxfV9e1jcag",
  })
  assert.equal(result?.status, "PUMPSWAP")
})

test("classifies a high-market-cap token as bonding when Pump says incomplete", () => {
  const result = classifyPumpLifecycle({
    mint: "ECJV7YCEWhXxpTTaeKAzazEyRYaHGmdCk755sRDYpump",
    complete: false,
    program: "pump",
    pump_swap_pool: null,
  })
  assert.equal(result?.status, "BONDING")
})

test("distinguishes completed curve from completed PumpSwap migration", () => {
  assert.equal(classifyPumpLifecycle({ complete: true, program: "pump" })?.status, "CURVE_COMPLETE")
  assert.equal(
    classifyPumpLifecycle({ complete: true, program: "pump", pump_swap_pool: "pool" })?.status,
    "PUMPSWAP",
  )
})

test("requires a concrete pool before PumpSwap trade evidence graduates a token", () => {
  assert.equal(classifyPumpLifecycle({ complete: false, program: "pump_amm" }), null)
  assert.equal(
    classifyPumpSwapTradeEvidence({
      program: "pump_amm",
      poolAddress: null,
      isBondingCurve: false,
    }),
    null,
  )
  assert.equal(
    classifyPumpSwapTradeEvidence({
      program: "pump_amm",
      poolAddress: "confirmed-pool",
      isBondingCurve: false,
    })?.status,
    "PUMPSWAP",
  )
  assert.equal(
    classifyPumpSwapTradeEvidence({
      program: "pump",
      poolAddress: "bonding-curve",
      isBondingCurve: true,
    }),
    null,
  )
  assert.equal(classifyPumpLifecycle({ program: "non_launchpad" })?.status, "NON_LAUNCHPAD")
})

test("recognizes a concrete legacy Raydium migration trade", () => {
  assert.equal(
    classifyLegacyRaydiumMigrationEvidence({
      program: "raydium_v4_amm",
      poolAddress: "67uQTTRtwEyXhRojpFY6gNdUZn8eZG5J3DFSCZvwsZXw",
      isBondingCurve: false,
    })?.status,
    "CURVE_COMPLETE",
  )
  assert.equal(
    classifyLegacyRaydiumMigrationEvidence({ program: "raydium_v4_amm", isBondingCurve: false }),
    null,
  )
})

test("recognizes Pump frontend legacy Raydium pool evidence even when complete is stale", () => {
  assert.equal(
    classifyPumpLifecycle({
      program: "pump",
      complete: false,
      real_token_reserves: 0,
      raydium_pool: "AdArbxuPGFh8sBwamiGcptCUx8b83tNu5eRhHmMybFN9",
    })?.status,
    "CURVE_COMPLETE",
  )
  assert.equal(
    classifyPumpLifecycle({ program: "pump", complete: false, pool_address: "legacy-pool" })?.status,
    "CURVE_COMPLETE",
  )
})

test("derives bonding progress from Pump curve reserves instead of market cap", () => {
  assert.equal(
    deriveBondingProgress({
      complete: false,
      real_token_reserves: 793_100_000_000_000,
      total_supply: 1_000_000_000_000_000,
    }),
    0,
  )
  const partial = deriveBondingProgress({
    complete: false,
    real_token_reserves: 494_766_604_422_046,
    total_supply: 1_000_000_000_000_000,
  })
  assert.ok(partial !== null && partial > 37 && partial < 38)
  assert.equal(deriveBondingProgress({ complete: true }), 100)
})

test("completed lifecycle transitions cannot downgrade", () => {
  const bonding = classifyPumpLifecycle({ complete: false, program: "pump" })!
  const curveComplete = classifyPumpLifecycle({ complete: true, program: "pump" })!
  const pumpSwap = classifyPumpLifecycle({ complete: true, program: "pump", pump_swap_pool: "pool" })!

  assert.deepEqual(reduceLifecycle("CURVE_COMPLETE", bonding), {
    next: "CURVE_COMPLETE",
    conflict: true,
  })
  assert.deepEqual(reduceLifecycle("PUMPSWAP", bonding), { next: "PUMPSWAP", conflict: true })
  assert.deepEqual(reduceLifecycle("CURVE_COMPLETE", pumpSwap), { next: "PUMPSWAP", conflict: false })
  assert.deepEqual(reduceLifecycle("BONDING", curveComplete), {
    next: "CURVE_COMPLETE",
    conflict: false,
  })
  assert.equal(isCompletedLifecycle("CURVE_COMPLETE"), true)
  assert.equal(isCompletedLifecycle("PUMPSWAP"), true)
  assert.equal(isCompletedLifecycle("BONDING"), false)
})

test("retry delay grows exponentially and caps at five minutes plus jitter", () => {
  const first = lifecycleRetryDelayMs(0)
  const later = lifecycleRetryDelayMs(6)
  const capped = lifecycleRetryDelayMs(20)
  assert.ok(first >= 2_000 && first < 2_400)
  assert.ok(later >= 128_000 && later < 153_600)
  assert.ok(capped >= 300_000 && capped < 360_000)
})

test("unresolved lifecycle checks cool down after bounded attempts", () => {
  const active = lifecycleRetrySchedule(4, 10, 6 * 60 * 60 * 1000, 30_000)
  assert.deepEqual(active, { delayMs: 30_000, priority: 96, coolingDown: false })

  const cooling = lifecycleRetrySchedule(10, 10, 6 * 60 * 60 * 1000, 30_000)
  assert.deepEqual(cooling, {
    delayMs: 6 * 60 * 60 * 1000,
    priority: 0,
    coolingDown: true,
  })
})
