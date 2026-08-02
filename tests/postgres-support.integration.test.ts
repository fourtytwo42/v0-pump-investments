import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import test from "node:test"
import { prisma } from "../lib/prisma"

const enabled = process.env.RUN_POSTGRES_INTEGRATION_TESTS === "true"

test("PostgreSQL support ownership, conversation, revision, and cascade behavior", { skip: !enabled }, async () => {
  const suffix = randomUUID()
  const client = await prisma.supportClient.create({ data: { publicId: suffix, sessionTokenHash: suffix.replaceAll("-", "").padEnd(64, "0").slice(0, 64), expiresAt: new Date(Date.now() + 60_000) } })
  try {
    const ticket = await prisma.supportTicket.create({ data: { clientId: client.id, category: "FEED", summary: "Integration report", messages: { create: { author: "USER", body: "The feed stopped." } }, diagnostics: { create: { frontend: { appVersion: "test" }, backend: { database: "ok" } } } }, include: { messages: true, diagnostics: true } })
    assert.equal(ticket.status, "WAITING_FOR_SUPPORT")
    assert.equal(ticket.messages.length, 1)
    assert.equal(ticket.diagnostics.length, 1)
    const first = await prisma.supportTicket.updateMany({ where: { id: ticket.id, revision: 1 }, data: { status: "WAITING_FOR_USER", revision: { increment: 1 } } })
    const stale = await prisma.supportTicket.updateMany({ where: { id: ticket.id, revision: 1 }, data: { priority: "HIGH", revision: { increment: 1 } } })
    assert.equal(first.count, 1)
    assert.equal(stale.count, 0)
    await prisma.supportClient.delete({ where: { id: client.id } })
    assert.equal(await prisma.supportTicket.count({ where: { id: ticket.id } }), 0)
  } finally {
    await prisma.supportClient.deleteMany({ where: { id: client.id } })
  }
})

test.after(async () => prisma.$disconnect())
