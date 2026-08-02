import { prisma } from "@/lib/prisma"
import { authenticateSupportClient, parseTicketNumber, requireSameOrigin, responseError } from "@/lib/support-ticket"

type Context = { params: Promise<{ ticketNumber: string }> }
export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    requireSameOrigin(request)
    const client = await authenticateSupportClient(request)
    const number = parseTicketNumber((await context.params).ticketNumber)
    if (!client || number === null) return Response.json({ error: "Not found" }, { status: 404 })
    const result = await prisma.supportTicket.updateMany({ where: { ticketNumber: number, clientId: client.id }, data: { userLastReadAt: new Date() } })
    return result.count ? new Response(null, { status: 204 }) : Response.json({ error: "Not found" }, { status: 404 })
  } catch (error) { return responseError(error) }
}
