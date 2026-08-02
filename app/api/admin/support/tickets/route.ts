import { prisma } from "@/lib/prisma"
import { formatTicketNumber, requireAdmin, responseError } from "@/lib/support-ticket"

export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdmin(request)
    const url = new URL(request.url)
    const status = url.searchParams.get("status")
    const priority = url.searchParams.get("priority")
    const needsResponse = url.searchParams.get("needs_response") === "true"
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 25)))
    const cursor = url.searchParams.get("cursor")
    const tickets = await prisma.supportTicket.findMany({
      where: {
        ...(status ? { status: status as any } : {}),
        ...(priority ? { priority: priority as any } : {}),
        ...(needsResponse ? { status: "WAITING_FOR_SUPPORT" as const } : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { messages: { orderBy: { createdAt: "desc" }, take: 1, select: { author: true, visibility: true, createdAt: true } } },
    })
    const hasMore = tickets.length > limit
    const page = tickets.slice(0, limit)
    return Response.json({
      tickets: page.map((ticket) => ({ id: ticket.id, ticketNumber: formatTicketNumber(ticket.ticketNumber), category: ticket.category, status: ticket.status, priority: ticket.priority, summary: ticket.summary, revision: ticket.revision, createdAt: ticket.createdAt.toISOString(), updatedAt: ticket.updatedAt.toISOString(), lastMessage: ticket.messages[0] ?? null })),
      nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    })
  } catch (error) { return responseError(error) }
}
