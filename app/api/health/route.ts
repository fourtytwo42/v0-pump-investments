import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export async function GET(): Promise<Response> {
  const startedAt = Date.now()
  try {
    const [, sol, latestTrade] = await Promise.all([
      prisma.$queryRaw`SELECT 1`,
      prisma.solPriceState.findUnique({ where: { key: "sol-usd" } }),
      prisma.trade.findFirst({ orderBy: { timestamp: "desc" }, select: { timestamp: true } }),
    ])
    const solHealthy = Boolean(sol && Date.now() - sol.updatedAt.getTime() < 10 * 60_000)
    const latestTradeTimestamp = latestTrade ? Number(latestTrade.timestamp) : 0
    const feedHealthy = latestTradeTimestamp > 0 && Date.now() - latestTradeTimestamp < 2 * 60_000
    return Response.json({
      version: process.env.APP_VERSION ?? "4.0.7",
      status: solHealthy && feedHealthy ? "ok" : "degraded",
      dependencies: {
        database: { status: "ok", latency_ms: Date.now() - startedAt },
        trade_feed: {
          status: feedHealthy ? "ok" : "stale",
          latest_trade_at: latestTradeTimestamp > 0 ? new Date(latestTradeTimestamp).toISOString() : null,
        },
        sol_price: {
          status: solHealthy ? "ok" : "stale",
          updated_at: sol?.updatedAt.toISOString() ?? null,
        },
      },
    })
  } catch {
    return Response.json(
      {
        version: process.env.APP_VERSION ?? "4.0.7",
        status: "unavailable",
        dependencies: { database: { status: "unavailable" } },
      },
      { status: 503 },
    )
  }
}
