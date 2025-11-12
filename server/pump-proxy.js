const WebSocket = require("ws")

const NATS_URL = "wss://unified-prod.nats.realtime.pump.fun/"
const NATS_HEADERS = {
  Origin: "https://pump.fun",
  "User-Agent": "pump-investments-proxy/1.0",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
}
const CONNECT_PAYLOAD = {
  no_responders: true,
  protocol: 1,
  verbose: false,
  pedantic: false,
  user: "subscriber",
  pass: "OX745xvUbNQMuFqV",
  lang: "nats.ws",
  version: "1.30.3",
  headers: true,
}
const SUBJECTS = ["unifiedTradeEvent.processed", "unifiedTradeEvent.processed.*"]

const PROXY_PORT = Number(process.env.PUMP_PROXY_PORT || 4000)
const RECONNECT_DELAY_MS = 2_000

const clients = new Set()
let upstream = null
let upstreamReady = false
let reconnectTimer = null
let buffer = ""

function broadcast(message) {
  const payload = JSON.stringify(message)
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload)
    }
  }
}

function sendStatus(state) {
  broadcast({ type: "status", state })
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    ensureUpstream()
  }, RECONNECT_DELAY_MS)
}

function processBuffer() {
  if (!upstream || upstream.readyState !== WebSocket.OPEN) {
    return
  }

  while (buffer.length > 0) {
    if (buffer.startsWith("PING")) {
      upstream.send("PONG\r\n")
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

    broadcast({ type: "raw", payload })
  }
}

function ensureUpstream() {
  if (upstream && (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)) {
    return
  }

  console.log("[proxy] Connecting to Pump.fun websocket...")
  upstreamReady = false
  sendStatus("connecting")

  upstream = new WebSocket(NATS_URL, { headers: { ...NATS_HEADERS, "Sec-WebSocket-Protocol": "nats" } })

  const reserveSid = (() => {
    let current = 1
    return () => `proxy${current++}`
  })()

  upstream.on("open", () => {
    buffer = ""
    upstreamReady = true
    try {
      upstream.send(`CONNECT ${JSON.stringify(CONNECT_PAYLOAD)}\r\n`)
      upstream.send("PING\r\n")
      for (const subject of SUBJECTS) {
        upstream.send(`SUB ${subject} ${reserveSid()}\r\n`)
      }
      sendStatus("ready")
      console.log("[proxy] Upstream connected and subscribed")
    } catch (error) {
      console.error("[proxy] Failed to send handshake to upstream:", error)
      upstreamReady = false
      sendStatus("error")
    }
  })

  upstream.on("message", (data) => {
    if (typeof data === "string") {
      buffer += data
      processBuffer()
      return
    }

    if (Buffer.isBuffer(data)) {
      buffer += data.toString("utf8")
      processBuffer()
    }
  })

  upstream.on("error", (error) => {
    console.error("[proxy] Upstream error:", error)
    upstreamReady = false
    sendStatus("error")
  })

  upstream.on("close", (code, reason) => {
    console.warn("[proxy] Upstream closed:", code, reason.toString())
    upstreamReady = false
    upstream = null
    sendStatus("error")
    scheduleReconnect()
  })
}

function handleClientConnection(client) {
  clients.add(client)
  console.log("[proxy] Client connected. Total:", clients.size)

  client.send(JSON.stringify({ type: "status", state: upstreamReady ? "ready" : "connecting" }))

  client.on("close", () => {
    clients.delete(client)
    console.log("[proxy] Client disconnected. Total:", clients.size)
  })

  client.on("error", (error) => {
    clients.delete(client)
    console.error("[proxy] Client error:", error)
  })

  ensureUpstream()
}

const server = new WebSocket.Server({ port: PROXY_PORT })
server.on("connection", handleClientConnection)

server.on("listening", () => {
  console.log(`[proxy] Listening on ws://localhost:${PROXY_PORT}`)
})

server.on("error", (error) => {
  console.error("[proxy] Server error:", error)
})

ensureUpstream()
