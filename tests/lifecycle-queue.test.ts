import assert from "node:assert/strict"
import test from "node:test"

import {
  LIFECYCLE_QUEUE_PRIORITY,
  lifecycleTradeRequest,
  periodicLifecyclePriority,
  selectLifecycleSingleFallbacks,
} from "@/lib/lifecycle-queue"

test("active unknown trades outrank recurring lifecycle checks", () => {
  assert.deepEqual(lifecycleTradeRequest("UNKNOWN", false), {
    reason: "active_unknown_trade",
    priority: LIFECYCLE_QUEUE_PRIORITY.activeUnknownTrade,
  })
  assert.deepEqual(lifecycleTradeRequest("BONDING", true), {
    reason: "trade_graduation_hint",
    priority: LIFECYCLE_QUEUE_PRIORITY.graduationHint,
  })
  assert.equal(lifecycleTradeRequest("BONDING", false), null)
  assert.equal(lifecycleTradeRequest("PUMPSWAP", true), null)
})

test("hot and full reconciliation lanes have bounded priority ordering", () => {
  assert.equal(
    periodicLifecyclePriority("UNKNOWN", "hot"),
    LIFECYCLE_QUEUE_PRIORITY.hotUnknown,
  )
  assert.equal(
    periodicLifecyclePriority("BONDING", "hot"),
    LIFECYCLE_QUEUE_PRIORITY.hotBonding,
  )
  assert.equal(
    periodicLifecyclePriority("CURVE_COMPLETE", "full"),
    LIFECYCLE_QUEUE_PRIORITY.curveCompleteFollowup,
  )
  assert.equal(periodicLifecyclePriority("NON_LAUNCHPAD", "full"), null)
  assert.ok(
    LIFECYCLE_QUEUE_PRIORITY.activeUnknownTrade > LIFECYCLE_QUEUE_PRIORITY.hotUnknown,
  )
})

test("single fallback favors hot unknown checks and keeps one legacy probe", () => {
  const checks = [
    { id: "full", priority: LIFECYCLE_QUEUE_PRIORITY.fullUnknown, attempts: 3 },
    { id: "hot-a", priority: LIFECYCLE_QUEUE_PRIORITY.hotUnknown, attempts: 0 },
    { id: "hot-b", priority: LIFECYCLE_QUEUE_PRIORITY.activeUnknownTrade, attempts: 0 },
    { id: "present", priority: LIFECYCLE_QUEUE_PRIORITY.graduationHint, attempts: 0 },
  ]
  const selected = selectLifecycleSingleFallbacks(
    checks,
    (check) => check.id !== "present",
    3,
  )
  assert.deepEqual(selected.map((check) => check.id), ["hot-b", "hot-a", "full"])
  assert.deepEqual(selectLifecycleSingleFallbacks(checks, () => true, 0), [])
})
