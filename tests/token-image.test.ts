import assert from "node:assert/strict"
import test from "node:test"

import {
  isAllowedMetadataUrl,
  isHttpUrl,
  isIpfsBackedUrl,
  tokenImagePath,
} from "../lib/token-image"

test("token image paths remain same-origin and encode the mint", () => {
  assert.equal(tokenImagePath("mint/value"), "/api/token-image/mint%2Fvalue")
})

test("IPFS URLs are recognized across native and gateway forms", () => {
  assert.equal(isIpfsBackedUrl("ipfs://bafy123"), true)
  assert.equal(isIpfsBackedUrl("https://ipfs.io/ipfs/bafy123"), true)
  assert.equal(isIpfsBackedUrl("https://example.com/image.png"), false)
})

test("metadata fetching only accepts IPFS or known public metadata hosts", () => {
  assert.equal(isAllowedMetadataUrl("https://pump.mypinata.cloud/ipfs/bafy123"), true)
  assert.equal(isAllowedMetadataUrl("https://metadata.j7tracker.io/metadata/token.json"), true)
  assert.equal(isAllowedMetadataUrl("http://127.0.0.1/private"), false)
  assert.equal(isAllowedMetadataUrl("http://192.168.50.1/private"), false)
  assert.equal(isAllowedMetadataUrl("javascript:alert(1)"), false)
})

test("only HTTP image targets are accepted", () => {
  assert.equal(isHttpUrl("https://example.com/image.png"), true)
  assert.equal(isHttpUrl("http://example.com/image.png"), true)
  assert.equal(isHttpUrl("data:image/png;base64,AAAA"), false)
})
