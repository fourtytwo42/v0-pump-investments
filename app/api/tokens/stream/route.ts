import { canSubscribeTokenStream, subscribeTokenStream, type TokenStreamEvent } from "@/lib/token-stream"
import type { TokenQueryRequest } from "@/types/token-data"
import {
  acquireClientConnection,
  apiErrorResponse,
  readJsonBody,
  tokenQuerySchema,
} from "@/lib/api-request"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const encoder = new TextEncoder()

function encodeEvent(event: TokenStreamEvent): Uint8Array {
  return encoder.encode(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`)
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.TOKEN_SSE_ENABLED === "false") {
    return Response.json({ error: "Token stream disabled" }, { status: 503 })
  }

  let query: Partial<TokenQueryRequest>
  let releaseConnection: (() => void) | null = null
  try {
    query = await readJsonBody(request, tokenQuerySchema, 64 * 1024) as Partial<TokenQueryRequest>
    if (!canSubscribeTokenStream(query)) {
      return Response.json({ error: "Too many unique token stream queries" }, { status: 429 })
    }
    releaseConnection = acquireClientConnection(request)
  } catch (error) {
    return apiErrorResponse(error)
  }

  let unsubscribe: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = () => {
        if (heartbeat) clearInterval(heartbeat)
        heartbeat = null
        unsubscribe?.()
        unsubscribe = null
        releaseConnection?.()
        releaseConnection = null
        try {
          controller.close()
        } catch {
          // The client may already have closed the stream.
        }
      }

      request.signal.addEventListener("abort", close, { once: true })
      try {
        unsubscribe = await subscribeTokenStream(query, (event) => {
          try {
            controller.enqueue(encodeEvent(event))
          } catch {
            close()
          }
        })
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`event: heartbeat\ndata: ${Date.now()}\n\n`))
          } catch {
            close()
          }
        }, 15_000)
      } catch (error) {
        console.error("[api/tokens/stream] Failed to subscribe:", error)
        controller.enqueue(encoder.encode(`event: error\ndata: {"message":"Token stream unavailable"}\n\n`))
        close()
      }
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat)
      unsubscribe?.()
      releaseConnection?.()
      releaseConnection = null
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
