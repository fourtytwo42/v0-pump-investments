import { acquireClientConnection, alertStreamSchema, apiErrorResponse, readJsonBody } from "@/lib/api-request"
import { getTokenDataRevision } from "@/lib/token-query"
import { prisma } from "@/lib/prisma"
import { subscribeAlertStream } from "@/lib/alert-stream"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const encoder = new TextEncoder()

interface AlertRecord {
  mint: string
  name: string
  symbol: string
  market_cap: number
  last_trade_timestamp: number
  revision: string
}

async function readRecords(mints: string[], revision: bigint): Promise<AlertRecord[]> {
  const rows = await prisma.token.findMany({
    where: { mintAddress: { in: mints } },
    select: {
      mintAddress: true,
      name: true,
      symbol: true,
      price: { select: { marketCapUsd: true, lastTradeTimestamp: true } },
    },
  })
  return rows.map((row) => ({
    mint: row.mintAddress,
    name: row.name,
    symbol: row.symbol,
    market_cap: Number(row.price?.marketCapUsd ?? 0),
    last_trade_timestamp: Number(row.price?.lastTradeTimestamp ?? 0),
    revision: revision.toString(),
  }))
}

function event(name: "snapshot" | "patch" | "heartbeat", data: unknown): Uint8Array {
  return encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.TOKEN_ALERT_STREAM_ENABLED === "false") {
    return Response.json({ error: "Alert stream disabled" }, { status: 503 })
  }
  let mints: string[]
  let release: (() => void) | null = null
  try {
    ({ mints } = await readJsonBody(request, alertStreamSchema, 64 * 1024))
    release = acquireClientConnection(request)
  } catch (error) {
    return apiErrorResponse(error)
  }

  let timer: ReturnType<typeof setInterval> | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let unsubscribeShared: (() => void) | null = null
  let lastRevision = BigInt(-1)
  let lastByMint = new Map<string, AlertRecord>()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = () => {
        if (timer) clearInterval(timer)
        if (heartbeat) clearInterval(heartbeat)
        timer = null
        heartbeat = null
        release?.()
        release = null
        unsubscribeShared?.()
        unsubscribeShared = null
        try { controller.close() } catch {}
      }
      request.signal.addEventListener("abort", close, { once: true })
      if (process.env.TOKEN_SHARED_ALERT_STREAM_ENABLED !== "false") {
        try {
          unsubscribeShared = await subscribeAlertStream(mints, (message) => {
            controller.enqueue(event(message.event, message.data))
          })
          heartbeat = setInterval(() => controller.enqueue(event("heartbeat", Date.now())), 15_000)
          return
        } catch (error) {
          console.error("[alerts/stream] shared subscription failed", error)
          close()
          return
        }
      }
      const refresh = async (initial = false) => {
        try {
          const revision = await getTokenDataRevision()
          if (!initial && revision === lastRevision) return
          const records = await readRecords(mints, revision)
          const changed = records.filter((record) => {
            const previous = lastByMint.get(record.mint)
            return !previous ||
              previous.market_cap !== record.market_cap ||
              previous.last_trade_timestamp !== record.last_trade_timestamp
          })
          lastByMint = new Map(records.map((record) => [record.mint, record]))
          lastRevision = revision
          controller.enqueue(event(initial ? "snapshot" : "patch", initial ? { records, revision: revision.toString() } : { records: changed, revision: revision.toString() }))
        } catch (error) {
          console.error("[alerts/stream] refresh failed", error)
          close()
        }
      }
      await refresh(true)
      timer = setInterval(() => void refresh(), 1_000)
      heartbeat = setInterval(() => controller.enqueue(event("heartbeat", Date.now())), 15_000)
    },
    cancel() {
      if (timer) clearInterval(timer)
      if (heartbeat) clearInterval(heartbeat)
      unsubscribeShared?.()
      unsubscribeShared = null
      release?.()
      release = null
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
