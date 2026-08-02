import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { authenticateSupportClient, deleteStoredImages, parseTicketNumber, readMultipart, replyPayloadSchema, requireSameOrigin, responseError, serializeTicket, storeSupportImages } from "@/lib/support-ticket"
import { statusAfterMessage } from "@/lib/support-ticket-utils"

export const runtime = "nodejs"
type Context = { params: Promise<{ ticketNumber: string }> }

export async function POST(request: Request, context: Context): Promise<Response> {
  let stored: Awaited<ReturnType<typeof storeSupportImages>> = []
  try {
    requireSameOrigin(request)
    const client = await authenticateSupportClient(request)
    const number = parseTicketNumber((await context.params).ticketNumber)
    if (!client || number === null) return Response.json({ error: "Not found" }, { status: 404 })
    const ticket = await prisma.supportTicket.findFirst({ where: { ticketNumber: number, clientId: client.id }, include: { messages: { select: { author: true, createdAt: true } }, diagnostics: { select: { id: true } } } })
    if (!ticket) return Response.json({ error: "Not found" }, { status: 404 })
    const recentComments = ticket.messages.filter((item) => item.author === "USER" && item.createdAt >= new Date(Date.now() - 60 * 60_000)).length
    if (recentComments >= 30) return Response.json({ error: "Comment limit reached" }, { status: 429 })
    const { payload, files } = await readMultipart(request, replyPayloadSchema)
    const existing = await prisma.supportAttachment.aggregate({ where: { message: { ticketId: ticket.id } }, _count: true, _sum: { byteSize: true } })
    if (Number(existing._count) + files.length > 12) return Response.json({ error: "Ticket image limit reached" }, { status: 413 })
    stored = await storeSupportImages(files)
    if (Number(existing._sum.byteSize ?? 0) + stored.reduce((sum, item) => sum + item.byteSize, 0) > 25 * 1024 ** 2) throw new Response("Ticket image storage limit reached", { status: 413 })
    const updated = await prisma.$transaction(async (tx) => {
      const message = await tx.supportMessage.create({ data: { ticketId: ticket.id, author: "USER", visibility: "PUBLIC", body: payload.body, attachments: { create: stored } } })
      if (payload.frontend) await tx.supportDiagnosticSnapshot.create({ data: { ticketId: ticket.id, messageId: message.id, schemaVersion: 1, frontend: payload.frontend as Prisma.InputJsonValue } })
      const status = statusAfterMessage("USER", "PUBLIC", ticket.status)
      await tx.supportTicket.update({ where: { id: ticket.id }, data: { status, resolvedAt: null, revision: { increment: 1 }, updatedAt: new Date() } })
      return tx.supportTicket.findUniqueOrThrow({ where: { id: ticket.id }, include: { messages: { where: { visibility: "PUBLIC" }, include: { attachments: true }, orderBy: { createdAt: "asc" } } } })
    })
    return Response.json({ ticket: serializeTicket(updated, true) }, { status: 201 })
  } catch (error) {
    if (stored.length) await deleteStoredImages(stored.map((item) => item.storageKey))
    return responseError(error)
  }
}
