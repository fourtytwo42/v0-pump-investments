import { readdir, rm, stat } from "node:fs/promises"
import path from "node:path"
import { prisma } from "@/lib/prisma"

const SUPPORT_ATTACHMENT_ROOT = process.env.SUPPORT_ATTACHMENT_DIR ?? path.join(process.cwd(), "server", "data", "support-attachments")

async function main() {
  const expired = await prisma.supportClient.findMany({
    where: { expiresAt: { lt: new Date() } },
    select: { id: true, tickets: { select: { messages: { select: { attachments: { select: { storageKey: true } } } } } } },
  })
  const expiredKeys = expired.flatMap((client) => client.tickets.flatMap((ticket) => ticket.messages.flatMap((message) => message.attachments.map((item) => item.storageKey))))
  if (expired.length) await prisma.supportClient.deleteMany({ where: { id: { in: expired.map((client) => client.id) } } })

  const known = new Set((await prisma.supportAttachment.findMany({ select: { storageKey: true } })).map((item) => item.storageKey))
  const names = await readdir(SUPPORT_ATTACHMENT_ROOT).catch(() => [] as string[])
  let removed = 0
  for (const name of names) {
    const target = path.join(SUPPORT_ATTACHMENT_ROOT, path.basename(name))
    const info = await stat(target).catch(() => null)
    const staleTemporary = name.endsWith(".tmp") && info && Date.now() - info.mtimeMs > 60 * 60_000
    if (staleTemporary || (!name.endsWith(".tmp") && !known.has(name))) {
      await rm(target, { force: true })
      removed += 1
    }
  }
  for (const key of expiredKeys) await rm(path.join(SUPPORT_ATTACHMENT_ROOT, path.basename(key)), { force: true }).catch(() => undefined)
  console.log(JSON.stringify({ expiredClients: expired.length, removedFiles: removed + expiredKeys.length, checkedFiles: names.length }))
}

main().finally(() => prisma.$disconnect()).catch((error) => { console.error(error); process.exitCode = 1 })
