import assert from "node:assert/strict"
import test from "node:test"

import { normalizeSliderRange, normalizeSliderValue } from "../lib/slider-values"

test("slider values are clamped and invalid values fall back to the minimum", () => {
  assert.equal(normalizeSliderValue(-20, 0, 100), 0)
  assert.equal(normalizeSliderValue(120, 0, 100), 100)
  assert.equal(normalizeSliderValue(Number.NaN, 4, 48), 4)
})

test("slider values snap to steps relative to a non-zero minimum", () => {
  assert.equal(normalizeSliderValue(8, 3, 30, 5), 8)
  assert.equal(normalizeSliderValue(10, 3, 30, 5), 8)
  assert.equal(normalizeSliderValue(11, 3, 30, 5), 13)
})

test("slider normalization retains fractional step precision", () => {
  assert.equal(normalizeSliderValue(0.29, 0, 1, 0.1), 0.3)
})

test("range values are normalized, clamped, and kept in ascending order", () => {
  assert.deepEqual(normalizeSliderRange([110, -10], 0, 100), [0, 100])
  assert.deepEqual(normalizeSliderRange([78, 22], 0, 100), [22, 78])
})
