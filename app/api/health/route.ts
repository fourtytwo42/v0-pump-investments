import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export async function GET(): Promise<Response> {
  const startedAt = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`
    const sol = await prisma.solPriceState.findUnique({ where: { key: "sol-usd" } })
    const solHealthy = Boolean(sol && Date.now() - sol.updatedAt.getTime() < 10 * 60_000)
    return Response.json({
      version: process.env.APP_VERSION ?? "4.0.6",
      status: solHealthy ? "ok" : "degraded",
      dependencies: {
        database: { status: "ok", latency_ms: Date.now() - startedAt },
        sol_price: {
          status: solHealthy ? "ok" : "stale",
          updated_at: sol?.updatedAt.toISOString() ?? null,
        },
      },
    })
  } catch {
    return Response.json(
      {
        version: process.env.APP_VERSION ?? "4.0.6",
        status: "unavailable",
        dependencies: { database: { status: "unavailable" } },
      },
      { status: 503 },
    )
  }
}
