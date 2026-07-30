import assert from "node:assert/strict"
import test from "node:test"

import { BoundedCache } from "@/lib/bounded-cache"

test("bounded cache evicts the least recently used entry", () => {
  const cache = new BoundedCache<string, number>(2, 60_000)
  cache.set("a", 1)
  cache.set("b", 2)
  assert.equal(cache.get("a"), 1)
  cache.set("c", 3)
  assert.equal(cache.get("b"), undefined)
  assert.equal(cache.get("a"), 1)
  assert.equal(cache.get("c"), 3)
})

test("bounded cache expires stale entries", () => {
  const originalNow = Date.now
  let now = 1_000
  Date.now = () => now
  try {
    const cache = new BoundedCache<string, number>(2, 100)
    cache.set("a", 1)
    now = 1_101
    assert.equal(cache.get("a"), undefined)
    assert.equal(cache.size, 0)
  } finally {
    Date.now = originalNow
  }
})
