import assert from "node:assert/strict"
import test from "node:test"

import { isValidSolanaAddress } from "../lib/solana-address"

test("accepts real Pump vanity mints ending in pump", () => {
  assert.equal(isValidSolanaAddress("E8Qa9f29XfWPsRLHJzf961Zb8YaszFtqJFdDjbgmpump"), true)
  assert.equal(isValidSolanaAddress("DHefxTaqwRpJFUhe91GLHUJZEHBKe4EPw984iFHJpump"), true)
})

test("rejects malformed Solana addresses", () => {
  assert.equal(isValidSolanaAddress("too-short"), false)
  assert.equal(isValidSolanaAddress("00000000000000000000000000000000000000000000"), false)
  assert.equal(isValidSolanaAddress("E8Qa9f29XfWPsRLHJzf961Zb8YaszFtqJFdDjbgm0ump"), false)
})
