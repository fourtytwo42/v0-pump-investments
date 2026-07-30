import assert from "node:assert/strict"
import test from "node:test"

import {
  classifyPumpLifecycle,
  isCompletedLifecycle,
  lifecycleRetryDelayMs,
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

test("requires explicit Pump API evidence and does not treat pump_amm as graduation", () => {
  assert.equal(classifyPumpLifecycle({ complete: false, program: "pump_amm" }), null)
  assert.equal(classifyPumpLifecycle({ program: "non_launchpad" })?.status, "NON_LAUNCHPAD")
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
