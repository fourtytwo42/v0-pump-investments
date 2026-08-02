import { prisma } from "@/lib/prisma"
import { authenticateSupportClient, deleteStoredImages, parseTicketNumber, requireSameOrigin, responseError, serializeTicket } from "@/lib/support-ticket"

export const runtime = "nodejs"
type Context = { params: Promise<{ ticketNumber: string }> }

async function ownedTicket(request: Request, ticketNumber: string, detail = false) {
  const client = await authenticateSupportClient(request)
  const number = parseTicketNumber(ticketNumber)
  if (!client || number === null) return null
  return prisma.supportTicket.findFirst({
    where: { ticketNumber: number, clientId: client.id },
    include: detail ? { messages: { where: { visibility: "PUBLIC" }, include: { attachments: true }, orderBy: { createdAt: "asc" } } } : undefined,
  })
}

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const { ticketNumber } = await context.params
    const ticket = await ownedTicket(request, ticketNumber, true)
    return ticket ? Response.json({ ticket: serializeTicket(ticket, true) }) : Response.json({ error: "Not found" }, { status: 404 })
  } catch (error) { return responseError(error) }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  try {
    requireSameOrigin(request)
    const { ticketNumber } = await context.params
    const ticket = await ownedTicket(request, ticketNumber)
    if (!ticket) return Response.json({ error: "Not found" }, { status: 404 })
    const attachments = await prisma.supportAttachment.findMany({ where: { message: { ticketId: ticket.id } }, select: { storageKey: true } })
    await prisma.supportTicket.delete({ where: { id: ticket.id } })
    await deleteStoredImages(attachments.map((item) => item.storageKey))
    return new Response(null, { status: 204 })
  } catch (error) { return responseError(error) }
}
