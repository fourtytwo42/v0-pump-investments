import { prisma } from "@/lib/prisma"
import { adminUpdateSchema, deleteStoredImages, formatTicketNumber, parseTicketNumber, requireAdmin, responseError } from "@/lib/support-ticket"

type Context = { params: Promise<{ ticketNumber: string }> }

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    await requireAdmin(request)
    const number = parseTicketNumber((await context.params).ticketNumber)
    if (number === null) return Response.json({ error: "Not found" }, { status: 404 })
    const ticket = await prisma.supportTicket.findUnique({ where: { ticketNumber: number }, include: { client: { select: { publicId: true } }, messages: { include: { attachments: true }, orderBy: { createdAt: "asc" } }, diagnostics: { orderBy: { createdAt: "asc" } } } })
    if (!ticket) return Response.json({ error: "Not found" }, { status: 404 })
    return Response.json({ ticket: { ...ticket, ticketNumber: formatTicketNumber(ticket.ticketNumber), diagnostics: ticket.diagnostics, messages: ticket.messages.map((message) => ({ ...message, attachments: message.attachments.map((attachment) => ({ ...attachment, url: `/api/support/attachments/${attachment.id}` })) })) } })
  } catch (error) { return responseError(error) }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  try {
    await requireAdmin(request)
    const number = parseTicketNumber((await context.params).ticketNumber)
    const payload = adminUpdateSchema.parse(await request.json())
    if (number === null) return Response.json({ error: "Not found" }, { status: 404 })
    const result = await prisma.supportTicket.updateMany({ where: { ticketNumber: number, revision: payload.expectedRevision }, data: { ...(payload.status ? { status: payload.status, resolvedAt: payload.status === "RESOLVED" ? new Date() : null } : {}), ...(payload.priority ? { priority: payload.priority } : {}), revision: { increment: 1 }, updatedAt: new Date() } })
    if (!result.count) return Response.json({ error: "Ticket changed; refetch before updating" }, { status: 409 })
    const ticket = await prisma.supportTicket.findUniqueOrThrow({ where: { ticketNumber: number } })
    return Response.json({ ticket: { ...ticket, ticketNumber: formatTicketNumber(ticket.ticketNumber) } })
  } catch (error) { return responseError(error) }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  try {
    await requireAdmin(request)
    const number = parseTicketNumber((await context.params).ticketNumber)
    if (number === null) return Response.json({ error: "Not found" }, { status: 404 })
    const ticket = await prisma.supportTicket.findUnique({ where: { ticketNumber: number }, include: { messages: { include: { attachments: true } } } })
    if (!ticket) return Response.json({ error: "Not found" }, { status: 404 })
    await prisma.supportTicket.delete({ where: { id: ticket.id } })
    await deleteStoredImages(ticket.messages.flatMap((message) => message.attachments.map((item) => item.storageKey)))
    return new Response(null, { status: 204 })
  } catch (error) { return responseError(error) }
}
