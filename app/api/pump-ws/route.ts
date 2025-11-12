import { convertPumpTradeToLocal, decodePumpPayload, type Trade } from "@/lib/pump-trades"

type StatusState = "connecting" | "ready" | "error"

type ProxyMessage =
  | { type: "status"; state: StatusState }
  | { type: "trade"; trade: Trade }

type WebSocketPairConstructor = { new (): [WebSocket, WebSocket] }

declare const WebSocketPair: WebSocketPairConstructor

type UpstreamSocket = WebSocket | null

export const runtime = "edge"
export const dynamic = "force-dynamic"

const NATS_URL = "wss://unified-prod.nats.realtime.pump.fun/"
const CONNECT_FRAME =
  `CONNECT ${JSON.stringify({
    no_responders: true,
    protocol: 1,
    verbose: false,
    pedantic: false,
    user: "subscriber",
    pass: "OX745xvUbNQMuFqV",
    lang: "nats.ws",
    version: "1.30.3",
    headers: true,
  })}\r\n`
const SUBJECTS = ["unifiedTradeEvent.processed", "unifiedTradeEvent.processed.*"]

export async function GET(request: Request) {
  const upgradeHeader = request.headers.get("upgrade")
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket", { status: 426 })
  }

  const pair = new WebSocketPair()
  const client = pair[0]
  const proxy = pair[1]

  handleProxy(proxy)

  return new Response(null, { status: 101, webSocket: client })
}

function handleProxy(clientSocket: WebSocket) {
  clientSocket.accept()

  let upstreamSocket: UpstreamSocket = null
  let buffer = ""
  const decoder = new TextDecoder()
  let closed = false

  const sendJson = (payload: ProxyMessage) => {
    if (closed || clientSocket.readyState !== WebSocket.OPEN) {
      return
    }

    try {
      clientSocket.send(JSON.stringify(payload))
    } catch (error) {
      console.error("[proxy] Failed to send message to client:", error)
    }
  }

  const sendStatus = (state: StatusState) => {
    sendJson({ type: "status", state })
  }

  const cleanup = () => {
    if (closed) return
    closed = true

    try {
      upstreamSocket?.close(1000, "proxy closing")
    } catch {
      // ignore
    }

    try {
      clientSocket.close()
    } catch {
      // ignore
    }
  }

  const processBuffer = () => {
    if (!upstreamSocket || upstreamSocket.readyState !== WebSocket.OPEN) {
      return
    }

    while (buffer.length > 0) {
      if (buffer.startsWith("PING")) {
        upstreamSocket.send("PONG\r\n")
        const newline = buffer.indexOf("\r\n")
        buffer = newline === -1 ? "" : buffer.slice(newline + 2)
        continue
      }

      if (buffer.startsWith("PONG") || buffer.startsWith("+OK") || buffer.startsWith("INFO")) {
        const newline = buffer.indexOf("\r\n")
        if (newline === -1) {
          return
        }
        buffer = buffer.slice(newline + 2)
        continue
      }

      if (!buffer.startsWith("MSG")) {
        const newline = buffer.indexOf("\r\n")
        if (newline === -1) {
          return
        }
        buffer = buffer.slice(newline + 2)
        continue
      }

      const headerEnd = buffer.indexOf("\r\n")
      if (headerEnd === -1) {
        return
      }

      const header = buffer.slice(0, headerEnd)
      const parts = header.trim().split(" ")
      if (parts.length < 4) {
        buffer = buffer.slice(headerEnd + 2)
        continue
      }

      const size = Number.parseInt(parts[parts.length - 1], 10)
      if (!Number.isFinite(size) || size < 0) {
        buffer = buffer.slice(headerEnd + 2)
        continue
      }

      const totalLength = headerEnd + 2 + size + 2
      if (buffer.length < totalLength) {
        return
      }

      const payload = buffer.slice(headerEnd + 2, headerEnd + 2 + size)
      buffer = buffer.slice(totalLength)

      const decodedTrade = decodePumpPayload(payload)
      if (!decodedTrade) {
        continue
      }

      try {
        const normalisedTrade = convertPumpTradeToLocal(decodedTrade)
        sendJson({ type: "trade", trade: normalisedTrade })
      } catch (error) {
        console.error("[proxy] Failed to normalise trade payload:", error)
      }
    }
  }

  const handleUpstreamChunk = (data: unknown) => {
    if (typeof data === "string") {
      buffer += data
      processBuffer()
      return
    }

    if (data instanceof ArrayBuffer) {
      buffer += decoder.decode(data)
      processBuffer()
      return
    }

    if (typeof Blob !== "undefined" && data instanceof Blob) {
      data.text().then((text) => {
        buffer += text
        processBuffer()
      })
      return
    }
  }

  const connectUpstream = () => {
    sendStatus("connecting")
    upstreamSocket = new WebSocket(NATS_URL, ["nats"])

    const reserveSid = (() => {
      let current = 1
      return () => `proxy${current++}`
    })()

    upstreamSocket.addEventListener("open", () => {
      buffer = ""
      try {
        upstreamSocket?.send(CONNECT_FRAME)
        upstreamSocket?.send("PING\r\n")
        for (const subject of SUBJECTS) {
          upstreamSocket?.send(`SUB ${subject} ${reserveSid()}\r\n`)
        }
        sendStatus("ready")
      } catch (error) {
        console.error("[proxy] Failed to send handshake to upstream:", error)
        sendStatus("error")
      }
    })

    upstreamSocket.addEventListener("message", (event) => {
      handleUpstreamChunk(event.data)
    })

    upstreamSocket.addEventListener("error", (error) => {
      console.error("[proxy] Upstream error:", error)
      sendStatus("error")
      cleanup()
    })

    upstreamSocket.addEventListener("close", (event) => {
      console.warn("[proxy] Upstream closed:", event.code, event.reason)
      sendStatus("error")
      cleanup()
    })
  }

  clientSocket.addEventListener("close", () => {
    cleanup()
  })

  clientSocket.addEventListener("error", () => {
    cleanup()
  })

  clientSocket.addEventListener("message", (event) => {
    if (typeof event.data === "string" && event.data.trim().toLowerCase() === "ping") {
      sendStatus("ready")
    }
  })

  connectUpstream()
}
