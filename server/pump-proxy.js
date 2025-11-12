const WebSocket = require("ws")
const fs = require("fs")
const path = require("path")

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

const DATA_DIRECTORY = process.env.PUMP_PROXY_DATA_DIR || path.join(__dirname, "data")
const MINT_REGISTRY_PATH = path.join(DATA_DIRECTORY, "mint-registry.json")
const REGISTRY_WRITE_DEBOUNCE_MS = 2_000

const PUMP_FRONTEND_ENDPOINT = "https://frontend-api-v3.pump.fun/coins/"
const PUMP_REQUEST_HEADERS = {
  accept: "application/json, text/plain, */*",
  origin: "https://pump.fun",
  referer: "https://pump.fun",
  "user-agent": "pump-investments-proxy/1.0 (+https://pump.fun)",
}
const METADATA_HEADERS = { Accept: "application/json" }
const METADATA_CACHE_TTL_MS = Number(process.env.PUMP_PROXY_METADATA_TTL_MS || 15 * 60 * 1000)
const METADATA_REBROADCAST_INTERVAL_MS = Number(process.env.PUMP_PROXY_METADATA_REBROADCAST_MS || 60 * 1000)

const metadataCache = new Map()
const metadataInflight = new Map()
let registryWriteTimer = null
const metadataBroadcastTimestamps = new Map()

const fetchImpl = typeof fetch === "function" ? fetch : (...args) => import("node-fetch").then(({ default: fn }) => fn(...args))

const clients = new Set()
let upstream = null
let upstreamReady = false
let reconnectTimer = null
let buffer = ""
let processingBuffer = false

function tryBase64Decode(value) {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/=]+$/.test(value)) {
    return null
  }

  try {
    return Buffer.from(value, "base64").toString("utf8")
  } catch {
    return null
  }
}

function normalizeIpfsUri(uri) {
  if (!uri) {
    return null
  }

  const trimmed = String(uri).trim()
  if (trimmed.length === 0) {
    return null
  }

  if (trimmed.startsWith("ipfs://")) {
    return trimmed.replace("ipfs://", "https://pump.mypinata.cloud/ipfs/")
  }

  return trimmed
}

function normalizeEpochMillis(value) {
  if (value == null) {
    return undefined
  }

  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined
  }

  return numeric > 1_000_000_000_000 ? Math.round(numeric) : Math.round(numeric * 1000)
}

function sanitizeCoinDetails(coin) {
  if (!coin || typeof coin !== "object") {
    return null
  }

  const imageCandidate = coin.image_uri || coin.imageUri || coin.image
  const imageUri = normalizeIpfsUri(imageCandidate)

  const createdTs = normalizeEpochMillis(
    coin.created_timestamp ??
      coin.createdTimestamp ??
      coin.created_at ??
      coin.createdTs ??
      coin.created ??
      null,
  )

  const kingTs = normalizeEpochMillis(
    coin.king_of_the_hill_timestamp ??
      coin.kingOfTheHillTimestamp ??
      coin.koth_ts ??
      coin.kothTs ??
      null,
  )

  return {
    name: coin.name ?? null,
    symbol: coin.symbol ?? null,
    description: coin.description ?? coin.summary ?? null,
    image: imageUri,
    image_uri: imageUri,
    website: coin.website ?? coin.project_site ?? null,
    twitter: coin.twitter ?? coin.twitter_handle ?? coin.social_twitter ?? null,
    telegram: coin.telegram ?? coin.telegram_channel ?? coin.social_telegram ?? null,
    createdTimestamp: createdTs ?? null,
    created_timestamp: createdTs ?? null,
    kingOfTheHillTimestamp: kingTs ?? null,
    king_of_the_hill_timestamp: kingTs ?? null,
  }
}

function storeMetadataInCache(mint, payload, options = {}) {
  const { ttlMs = METADATA_CACHE_TTL_MS, persist = false, fetchedAt = Date.now() } = options

  const previous = metadataCache.get(mint)
  const hasUsefulData = Boolean(
    payload &&
      typeof payload === "object" &&
      ((payload.metadata && Object.keys(payload.metadata).length > 0) ||
        (payload.coin && Object.keys(payload.coin).length > 0)),
  )

  if (previous?.persistent && previous.payload && !hasUsefulData) {
    return previous.payload
  }

  const persistent = persist || Boolean(previous?.persistent)
  const expiresAt = persistent ? null : ttlMs == null ? null : Date.now() + ttlMs

  metadataCache.set(mint, { payload, expiresAt, fetchedAt, persistent })

  if (persistent) {
    schedulePersistMintRegistry()
  }
}

function getCachedMetadataPayload(mint) {
  const cached = metadataCache.get(mint)
  if (!cached) {
    return null
  }

  if (cached.expiresAt !== null && cached.expiresAt <= Date.now()) {
    metadataCache.delete(mint)
    return null
  }

  return cached.payload
}

function getAllCachedMetadataPayloads() {
  const payloads = []
  for (const [mint, entry] of metadataCache.entries()) {
    if (!entry) {
      metadataCache.delete(mint)
      continue
    }

    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      metadataCache.delete(mint)
      continue
    }
    payloads.push(entry.payload)
  }
  return payloads
}

function ensureDataDirectory() {
  try {
    if (!fs.existsSync(DATA_DIRECTORY)) {
      fs.mkdirSync(DATA_DIRECTORY, { recursive: true })
    }
  } catch (error) {
    console.error("[proxy] Failed to ensure data directory:", error)
  }
}

function persistMintRegistryNow() {
  try {
    ensureDataDirectory()
    const entries = []
    for (const [mint, entry] of metadataCache.entries()) {
      if (!entry || !entry.payload || !entry.persistent) {
        continue
      }

      entries.push({
        mint,
        fetchedAt: entry.fetchedAt ?? Date.now(),
        payload: entry.payload,
      })
    }

    const registry = {
      version: 1,
      updatedAt: Date.now(),
      mints: entries,
    }

    fs.writeFileSync(MINT_REGISTRY_PATH, JSON.stringify(registry, null, 2), "utf8")
  } catch (error) {
    console.error("[proxy] Failed to persist mint registry:", error)
  }
}

function schedulePersistMintRegistry() {
  if (registryWriteTimer) {
    clearTimeout(registryWriteTimer)
  }

  registryWriteTimer = setTimeout(() => {
    registryWriteTimer = null
    persistMintRegistryNow()
  }, REGISTRY_WRITE_DEBOUNCE_MS)
}

function loadMintRegistry() {
  try {
    ensureDataDirectory()
    if (!fs.existsSync(MINT_REGISTRY_PATH)) {
      return
    }

    const raw = fs.readFileSync(MINT_REGISTRY_PATH, "utf8")
    if (!raw) {
      return
    }

    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.mints)) {
      return
    }

    for (const entry of parsed.mints) {
      if (!entry || typeof entry.mint !== "string" || !entry.payload) {
        continue
      }

      storeMetadataInCache(entry.mint, entry.payload, {
        ttlMs: null,
        persist: false,
        fetchedAt: entry.fetchedAt ?? Date.now(),
      })
      metadataBroadcastTimestamps.set(entry.mint, 0)
    }

    console.log(`[proxy] Loaded ${parsed.mints.length} cached mint metadata entries`)
  } catch (error) {
    console.error("[proxy] Failed to load mint registry:", error)
  }
}

function broadcastMetadata(payload, options = {}) {
  if (!payload || typeof payload.mint !== "string") {
    return
  }

  const { force = false } = options
  const mint = payload.mint
  const lastBroadcast = metadataBroadcastTimestamps.get(mint) ?? 0

  if (!force && Date.now() - lastBroadcast < METADATA_REBROADCAST_INTERVAL_MS) {
    return
  }

  metadataBroadcastTimestamps.set(mint, Date.now())
  broadcast(payload)
}

async function fetchJsonWithHeaders(url, defaultHeaders = {}, init = {}) {
  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      ...init,
      headers: {
        ...defaultHeaders,
        ...(init.headers || {}),
      },
    })

    if (!response.ok) {
      console.warn(`[proxy] Request failed ${url} :: ${response.status} ${response.statusText}`)
      return null
    }

    return await response.json().catch((error) => {
      console.warn(`[proxy] Failed to parse JSON from ${url}:`, error)
      return null
    })
  } catch (error) {
    console.error(`[proxy] Request error ${url}:`, error)
    return null
  }
}

async function fetchPumpCoinDetails(mint) {
  return await fetchJsonWithHeaders(`${PUMP_FRONTEND_ENDPOINT}${mint}`, PUMP_REQUEST_HEADERS)
}

async function fetchMetadataDocument(metadataUri) {
  const normalized = normalizeIpfsUri(metadataUri)
  if (!normalized) {
    return null
  }

  return await fetchJsonWithHeaders(normalized, METADATA_HEADERS)
}

async function fetchMetadataPayload(mint, metadataUriHint) {
  const coinDetails = await fetchPumpCoinDetails(mint)

  const metadataUriCandidate =
    (coinDetails && (coinDetails.metadata_uri || coinDetails.metadataUri || coinDetails.metadata?.uri)) || metadataUriHint

  let metadataDocument = coinDetails?.metadata ?? null
  if (!metadataDocument && metadataUriCandidate) {
    metadataDocument = await fetchMetadataDocument(metadataUriCandidate)
  }

  const normalizedUri = normalizeIpfsUri(metadataUriCandidate)
  const payload = {
    type: "metadata",
    mint,
    metadata_uri: normalizedUri,
    metadata: metadataDocument ?? null,
    coin: sanitizeCoinDetails(coinDetails),
  }

  const success = Boolean(metadataDocument || payload.coin)
  storeMetadataInCache(mint, payload, {
    ttlMs: success ? null : 60_000,
    persist: success,
    fetchedAt: Date.now(),
  })
  return payload
}

async function maybeFetchAndBroadcastMetadata(mint, metadataUriHint) {
  if (!mint) {
    return null
  }

  const cached = getCachedMetadataPayload(mint)
  if (cached) {
    broadcastMetadata(cached)
    return cached
  }

  if (metadataInflight.has(mint)) {
    return metadataInflight.get(mint)
  }

  const promise = fetchMetadataPayload(mint, metadataUriHint)
    .then((payload) => {
      if (payload) {
        broadcastMetadata(payload, { force: true })
      }
      return payload
    })
    .catch((error) => {
      console.error(`[proxy] Metadata fetch failed for mint ${mint}:`, error)
      const fallback = {
        type: "metadata",
        mint,
        metadata_uri: normalizeIpfsUri(metadataUriHint),
        metadata: null,
        coin: null,
      }
      storeMetadataInCache(mint, fallback, { ttlMs: 60_000, persist: false, fetchedAt: Date.now() })
      broadcastMetadata(fallback, { force: true })
      return fallback
    })
    .finally(() => {
      metadataInflight.delete(mint)
    })

  metadataInflight.set(mint, promise)
  return promise
}

function decodePumpPayload(rawPayload) {
  try {
    let working = (rawPayload || "").trim()

    while (working.startsWith("\"") && working.endsWith("\"")) {
      try {
        const parsed = JSON.parse(working)
        if (typeof parsed !== "string") {
          working = JSON.stringify(parsed)
          break
        }
        working = parsed
      } catch {
        break
      }
    }

    const base64Decoded = tryBase64Decode(working)
    if (base64Decoded) {
      working = base64Decoded
    }

    working = working.replace(/\\"/g, '"')

    try {
      return JSON.parse(working)
    } catch {
      const lastBrace = working.lastIndexOf("}")
      if (lastBrace !== -1) {
        return JSON.parse(working.slice(0, lastBrace + 1))
      }
    }

    return null
  } catch (error) {
    console.error("[proxy] Failed to decode payload:", error)
    return null
  }
}

function convertPumpTradeToLocal(pumpTrade) {
  const timestampMs =
    typeof pumpTrade.timestamp === "string" ? new Date(pumpTrade.timestamp).getTime() : Date.now()

  const metadataUri = normalizeIpfsUri(pumpTrade.coinMeta?.uri)
  const createdTimestamp = normalizeEpochMillis(pumpTrade.coinMeta?.createdTs ?? pumpTrade.coinMeta?.created_ts)

  return {
    mint: (pumpTrade.mintAddress || "").trim(),
    name: pumpTrade.coinMeta?.name || "Unknown",
    symbol: pumpTrade.coinMeta?.symbol || "???",
    image_uri: "",
    usd_market_cap: Number(pumpTrade.marketCap || 0),
    market_cap: Number(pumpTrade.marketCap || 0),
    sol_amount: Number(pumpTrade.amountSol || pumpTrade.quoteAmount || 0),
    usd_amount: Number(pumpTrade.amountUsd || 0),
    is_buy: pumpTrade.type === "buy",
    user: pumpTrade.userAddress || "",
    creator: pumpTrade.creatorAddress || pumpTrade.coinMeta?.creator || "",
    creator_username: "",
    token_amount: Number(pumpTrade.baseAmount || 0),
    total_supply: 0,
    timestamp: Math.floor(timestampMs / 1000),
    virtual_sol_reserves: 0,
    virtual_token_reserves: 0,
    signature: pumpTrade.tx || "",
    created_timestamp: createdTimestamp ?? null,
    metadata_uri: metadataUri,
    website: null,
    twitter: null,
    telegram: null,
    king_of_the_hill_timestamp: pumpTrade.isBondingCurve ? null : timestampMs,
    description: null,
  }
}

async function handleTradePayload(payload) {
  const decoded = decodePumpPayload(payload)
  if (!decoded) {
    return
  }

  try {
    const trade = convertPumpTradeToLocal(decoded)
    if (!trade.mint || !trade.signature) {
      return
    }

    broadcast({ type: "trade", trade })

    const metadataUriHint = decoded?.coinMeta?.uri || decoded?.coinMeta?.metadataUri || null
    void maybeFetchAndBroadcastMetadata(trade.mint, metadataUriHint)
  } catch (error) {
    console.error("[proxy] Failed to process trade payload:", error)
  }
}

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

async function processNextFrame() {
  if (!upstream || upstream.readyState !== WebSocket.OPEN) {
    return false
  }

  if (buffer.length === 0) {
    return false
  }

  if (buffer.startsWith("PING")) {
    upstream.send("PONG\r\n")
    const newline = buffer.indexOf("\r\n")
    buffer = newline === -1 ? "" : buffer.slice(newline + 2)
    return true
  }

  if (buffer.startsWith("PONG") || buffer.startsWith("+OK") || buffer.startsWith("INFO")) {
    const newline = buffer.indexOf("\r\n")
    if (newline === -1) {
      return false
    }
    buffer = buffer.slice(newline + 2)
    return true
  }

  if (!buffer.startsWith("MSG")) {
    const newline = buffer.indexOf("\r\n")
    if (newline === -1) {
      return false
    }
    buffer = buffer.slice(newline + 2)
    return true
  }

  const headerEnd = buffer.indexOf("\r\n")
  if (headerEnd === -1) {
    return false
  }

  const header = buffer.slice(0, headerEnd)
  const parts = header.trim().split(" ")
  if (parts.length < 4) {
    buffer = buffer.slice(headerEnd + 2)
    return true
  }

  const size = Number.parseInt(parts[parts.length - 1], 10)
  if (!Number.isFinite(size) || size < 0) {
    buffer = buffer.slice(headerEnd + 2)
    return true
  }

  const totalLength = headerEnd + 2 + size + 2
  if (buffer.length < totalLength) {
    return false
  }

  const payload = buffer.slice(headerEnd + 2, headerEnd + 2 + size)
  buffer = buffer.slice(totalLength)

  await handleTradePayload(payload)
  return true
}

async function processQueuedBuffer() {
  if (processingBuffer) {
    return
  }

  processingBuffer = true
  try {
    while (await processNextFrame()) {
      // Continue draining frames while data is available
    }
  } finally {
    processingBuffer = false
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
      void processQueuedBuffer()
      return
    }

    if (Buffer.isBuffer(data)) {
      buffer += data.toString("utf8")
      void processQueuedBuffer()
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

  for (const payload of getAllCachedMetadataPayloads()) {
    client.send(JSON.stringify(payload))
  }

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

loadMintRegistry()
ensureUpstream()

function handleShutdown() {
  persistMintRegistryNow()
  process.exit(0)
}

process.on("beforeExit", () => {
  persistMintRegistryNow()
})

process.on("SIGINT", handleShutdown)
process.on("SIGTERM", handleShutdown)
