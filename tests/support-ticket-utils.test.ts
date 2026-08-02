import assert from "node:assert/strict"
import test from "node:test"
import { formatTicketNumber, parseTicketNumber, statusAfterMessage, summarizeTicket } from "../lib/support-ticket-utils"

test("support ticket references are stable and non-permissive", () => {
  assert.equal(formatTicketNumber(42), "PI-000042")
  assert.equal(parseTicketNumber("PI-000042"), BigInt(42))
  assert.equal(parseTicketNumber("42"), null)
  assert.equal(parseTicketNumber("PI-1x"), null)
})

test("ticket summaries use and bound the first line", () => {
  assert.equal(summarizeTicket(" Feed stopped working \nmore detail"), "Feed stopped working")
  assert.equal(summarizeTicket("x".repeat(150)).length, 100)
})

test("public replies move ownership while internal notes do not", () => {
  assert.equal(statusAfterMessage("USER", "PUBLIC", "RESOLVED"), "WAITING_FOR_SUPPORT")
  assert.equal(statusAfterMessage("SUPPORT", "PUBLIC", "WAITING_FOR_SUPPORT"), "WAITING_FOR_USER")
  assert.equal(statusAfterMessage("SUPPORT", "INTERNAL", "WAITING_FOR_SUPPORT"), "WAITING_FOR_SUPPORT")
  assert.equal(statusAfterMessage("SUPPORT", "PUBLIC", "WAITING_FOR_SUPPORT", "RESOLVED"), "RESOLVED")
})
