import { alertStreamSchema, apiErrorResponse, readJsonBody } from "@/lib/api-request"
import { getTokenDataRevision } from "@/lib/token-query"
import { prisma } from "@/lib/prisma"

export async function POST(request: Request): Promise<Response> {
  try {
    const { mints } = await readJsonBody(request, alertStreamSchema, 64 * 1024)
    const revision = await getTokenDataRevision()
    const rows = await prisma.token.findMany({
      where: { mintAddress: { in: mints } },
      select: {
        mintAddress: true,
        name: true,
        symbol: true,
        price: { select: { marketCapUsd: true, lastTradeTimestamp: true } },
      },
    })
    return Response.json({
      revision: revision.toString(),
      records: rows.map((row) => ({
        mint: row.mintAddress,
        name: row.name,
        symbol: row.symbol,
        market_cap: Number(row.price?.marketCapUsd ?? 0),
        last_trade_timestamp: Number(row.price?.lastTradeTimestamp ?? 0),
        revision: revision.toString(),
      })),
    })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
