import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { authenticateSupportClient, collectBackendDiagnostics, createTicketPayloadSchema, deleteStoredImages, readMultipart, requireSameOrigin, responseError, serializeTicket, storeSupportImages, summarizeTicket, verifyTurnstile } from "@/lib/support-ticket"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const listInclude = { messages: { where: { visibility: "PUBLIC" as const }, select: { author: true, createdAt: true } } }

export async function GET(request: Request): Promise<Response> {
  try {
    const client = await authenticateSupportClient(request)
    if (!client) return Response.json({ tickets: [] })
    const tickets = await prisma.supportTicket.findMany({ where: { clientId: client.id }, orderBy: { updatedAt: "desc" }, include: listInclude, take: 100 })
    return Response.json({ tickets: tickets.map((ticket) => serializeTicket(ticket)) })
  } catch (error) { return responseError(error) }
}

export async function POST(request: Request): Promise<Response> {
  let stored: Awaited<ReturnType<typeof storeSupportImages>> = []
  try {
    requireSameOrigin(request)
    const client = await authenticateSupportClient(request)
    if (!client) return Response.json({ error: "Support session required" }, { status: 401 })
    const { payload, files } = await readMultipart(request, createTicketPayloadSchema)
    if (!(await verifyTurnstile(request, payload.turnstileToken))) return Response.json({ error: "Verification failed" }, { status: 403 })
    const now = new Date()
    const [openCount, hourly, daily] = await Promise.all([
      prisma.supportTicket.count({ where: { clientId: client.id, status: { not: "RESOLVED" } } }),
      prisma.supportTicket.count({ where: { clientId: client.id, createdAt: { gte: new Date(now.getTime() - 60 * 60_000) } } }),
      prisma.supportTicket.count({ where: { clientId: client.id, createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) } } }),
    ])
    if (openCount >= 5 || hourly >= 3 || daily >= 10) return Response.json({ error: "Ticket limit reached; please try again later" }, { status: 429 })
    stored = await storeSupportImages(files)
    const backend = await collectBackendDiagnostics(request)
    const ticket = await prisma.$transaction(async (tx) => tx.supportTicket.create({
      data: {
        clientId: client.id,
        category: payload.category,
        summary: summarizeTicket(payload.body),
        messages: { create: { author: "USER", visibility: "PUBLIC", body: payload.body, attachments: { create: stored.map((image) => image) } } },
        diagnostics: { create: { schemaVersion: 1, frontend: payload.frontend as Prisma.InputJsonValue, backend: backend as Prisma.InputJsonValue } },
      },
      include: { messages: { include: { attachments: true }, orderBy: { createdAt: "asc" } } },
    }))
    return Response.json({ ticket: serializeTicket(ticket, true) }, { status: 201 })
  } catch (error) {
    if (stored.length) await deleteStoredImages(stored.map((item) => item.storageKey))
    return responseError(error)
  }
}
