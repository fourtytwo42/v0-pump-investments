import assert from "node:assert/strict"
import test from "node:test"
import {
  assertPiBotContextWithinLimit,
  estimateContextTokens,
  extractChatCompletionText,
  getPiBotContextLimit,
  PiBotError,
} from "../lib/pi-bot-appliance"

test("PI Bot context limit never exceeds 100,000 tokens", () => {
  assert.equal(getPiBotContextLimit("250000"), 100_000)
  assert.equal(getPiBotContextLimit("50000"), 50_000)
  assert.equal(getPiBotContextLimit("invalid"), 100_000)
})

test("PI Bot rejects context above the configured ceiling", () => {
  assert.equal(estimateContextTokens("abcd"), 4)
  assert.throws(
    () => assertPiBotContextWithinLimit("123456", undefined, 5),
    (error: unknown) => error instanceof PiBotError && error.status === 413,
  )
})

test("extracts text from chat completion payloads", () => {
  assert.equal(
    extractChatCompletionText({
      choices: [{ message: { role: "assistant", content: "PI BOT READY" } }],
    }),
    "PI BOT READY",
  )
})
