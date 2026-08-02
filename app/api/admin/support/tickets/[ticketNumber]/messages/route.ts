import { prisma } from "@/lib/prisma"
import { adminMessageSchema, formatTicketNumber, parseTicketNumber, requireAdmin, responseError } from "@/lib/support-ticket"
import { statusAfterMessage } from "@/lib/support-ticket-utils"

type Context = { params: Promise<{ ticketNumber: string }> }

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    await requireAdmin(request)
    const number = parseTicketNumber((await context.params).ticketNumber)
    const payload = adminMessageSchema.parse(await request.json())
    if (number === null) return Response.json({ error: "Not found" }, { status: 404 })
    const ticket = await prisma.supportTicket.findUnique({ where: { ticketNumber: number } })
    if (!ticket) return Response.json({ error: "Not found" }, { status: 404 })
    if (ticket.revision !== payload.expectedRevision) return Response.json({ error: "Ticket changed; refetch before replying" }, { status: 409 })
    const status = statusAfterMessage("SUPPORT", payload.visibility, ticket.status, payload.status)
    const updated = await prisma.$transaction(async (tx) => {
      await tx.supportMessage.create({ data: { ticketId: ticket.id, author: "SUPPORT", visibility: payload.visibility, body: payload.body } })
      return tx.supportTicket.update({ where: { id: ticket.id }, data: { status, resolvedAt: status === "RESOLVED" ? new Date() : null, revision: { increment: 1 }, updatedAt: new Date() } })
    })
    return Response.json({ ticket: { ...updated, ticketNumber: formatTicketNumber(updated.ticketNumber) } }, { status: 201 })
  } catch (error) { return responseError(error) }
}
