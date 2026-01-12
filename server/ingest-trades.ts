import { PrismaClient } from "@prisma/client"
import { Decimal } from "@prisma/client/runtime/library"
import WebSocket from "ws"
import {
  decodePumpPayload,
  type PumpUnifiedTrade,
  getIpfsGatewayUrls,
  normalizeIpfsUri,
} from "@/lib/pump-trades"
import { normalizeTokenMetadata } from "@/lib/token-metadata"
import { fetchPumpCoin, PUMP_HEADERS } from "@/lib/pump-coin"
import { getDexPairCreatedAt } from "@/lib/dexscreener"

// =============================================================================
// Configuration
// =============================================================================

const QUEUE_BATCH_SIZE = 800 // Larger batches with token ID caching
const QUEUE_FLUSH_INTERVAL_MS = 500 // Flush every 500ms for faster response
const CONNECTION_LIMIT = 15 // Increased for 10 parallel processors

// Metadata retry configuration
const METADATA_RETRY_INTERVAL_MS = 10_000 // Reduced from 15s to 10s for faster processing
const METADATA_RETRY_BATCH_SIZE = 80 // Increased from 40 to 80 tokens per cycle
const METADATA_RETRY_MAX_ATTEMPTS = 5
const METADATA_FETCH_MAX_ATTEMPTS = 3
const METADATA_MIN_INTERVAL_MS = 150

// Cleanup configuration
const TRADE_RETENTION_HOURS = process.env.TRADE_RETENTION_HOURS
  ? parseInt(process.env.TRADE_RETENTION_HOURS, 10)
  : 0
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000
const CLEANUP_BATCH_SIZE = 1000

// NATS connection
const NATS_URL = "wss://unified-prod.nats.realtime.pump.fun/"
const NATS_HEADERS = {
  Origin: "https://pump.fun",
  "User-Agent": "pump-investments-ingester/1.0",
}
const NATS_CONNECT_PAYLOAD = {
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

// =============================================================================
// Database Setup
// =============================================================================

function buildConnectionUrl(url?: string): string | undefined {
  if (!url) return url
  try {
    const parsed = new URL(url)
    parsed.searchParams.set("connection_limit", String(CONNECTION_LIMIT))
    parsed.searchParams.set("pool_timeout", "0")
    return parsed.toString()
  } catch {
    return `${url}${url.includes("?") ? "&" : "?"}connection_limit=${CONNECTION_LIMIT}&pool_timeout=0`
  }
}

const prisma = new PrismaClient({
  datasources: { db: { url: buildConnectionUrl(process.env.DATABASE_URL) } },
})

// =============================================================================
// Constants
// =============================================================================

const TOKEN_DECIMALS = new Decimal(1_000_000)
const TOTAL_SUPPLY_TOKENS = new Decimal("1000000000")

// =============================================================================
// State
// =============================================================================

const tradeQueue: PumpUnifiedTrade[] = []
let activeProcessors = 0
const MAX_PROCESSORS = 10 // Parallel processors - safe now with ON CONFLICT DO NOTHING
let lastQueueFlush = Date.now()

let ws: WebSocket | null = null
let reconnectTimer: NodeJS.Timeout | null = null
let messageBuffer = ""

// SOL price cache
let solPriceCache = { value: 160, updatedAt: 0 }

// Token ID cache (mint -> id) - avoids repeated SELECT queries
const tokenIdCache = new Map<string, string>()

// Metadata caches
const metadataCache = new Map<string, unknown>()
const metadataRetryQueue = new Set<string>()
const metadataRetryAttempts = new Map<string, number>()
const metadataFirstSeenTime = new Map<string, number>()
let isProcessingMetadataQueue = false
let lastMetadataRequestAt = 0
let metadataDynamicDelayMs = 0

// =============================================================================
// Utilities
// =============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function escapeSQL(value: string | null | undefined): string {
  if (value === null || value === undefined) return "NULL"
  // Escape single quotes and backslashes for PostgreSQL
  const escaped = value.replace(/\\/g, "\\\\").replace(/'/g, "''")
  return `'${escaped}'`
}

function toDecimal(value: unknown, fallback = "0"): Decimal {
  if (value === null || value === undefined) return new Decimal(fallback)
  try {
    return new Decimal(value.toString())
  } catch {
    return new Decimal(fallback)
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim()
    }
  }
  return undefined
}

function generateCuid(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `c${timestamp}${random}`
}

// =============================================================================
// SOL Price
// =============================================================================

async function getSolPriceUsd(): Promise<number> {
  const now = Date.now()
  if (now - solPriceCache.updatedAt < 60_000) {
    return solPriceCache.value
  }

  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { headers: { accept: "application/json" } }
    )

    if (response.ok) {
      const data = (await response.json()) as { solana?: { usd?: number } }
      const price = data.solana?.usd
      if (typeof price === "number" && Number.isFinite(price)) {
        solPriceCache = { value: price, updatedAt: now }
        return price
      }
    }
  } catch (error) {
    console.warn("[ingest] Failed to fetch SOL price:", (error as Error).message)
  }

  return solPriceCache.value
}

// =============================================================================
// Trade Processing Types
// =============================================================================

interface PreparedTrade {
  mint: string
  tx: string
  userAddress: string
  isBuy: boolean
  amountSol: Decimal
  amountUsd: Decimal
  baseAmount: Decimal
  priceSol: Decimal
  priceUsd: Decimal
  marketCapUsd: Decimal
  timestampMs: number
  symbol: string
  name: string
  creatorAddress: string
  createdTs: number
  imageUri: string | null
  metadataUri: string | null
  twitter: string | null
  telegram: string | null
  website: string | null
  description: string | null
  bondingCurve: string | null
  associatedBondingCurve: string | null
  isKoth: boolean
}

// =============================================================================
// Trade Preparation
// =============================================================================

function prepareTrade(trade: PumpUnifiedTrade, solPriceUsd: number): PreparedTrade | null {
  if (!trade.mintAddress || !trade.tx) return null

  const isBuy = trade.type?.toLowerCase() === "buy"
  const amountSol = toDecimal(trade.amountSol ?? trade.quoteAmount ?? "0").toDecimalPlaces(9)
  const baseAmountTokens = toDecimal(trade.baseAmount ?? "0").toDecimalPlaces(9)
  const baseAmountRaw = baseAmountTokens.mul(TOKEN_DECIMALS).toDecimalPlaces(0)

  if (amountSol.lte(0) || baseAmountTokens.lte(0)) return null

  const timestampMs = Number.isFinite(Date.parse(trade.timestamp))
    ? Date.parse(trade.timestamp)
    : Date.now()

  let priceSol = trade.priceSol
    ? toDecimal(trade.priceSol)
    : trade.priceQuotePerBase
      ? toDecimal(trade.priceQuotePerBase)
      : amountSol.div(baseAmountTokens)
  priceSol = priceSol.toDecimalPlaces(18)

  let priceUsd = trade.priceUsd ? toDecimal(trade.priceUsd) : priceSol.mul(solPriceUsd)
  priceUsd = priceUsd.toDecimalPlaces(8)

  let amountUsd = trade.amountUsd ? toDecimal(trade.amountUsd) : amountSol.mul(solPriceUsd)
  amountUsd = amountUsd.toDecimalPlaces(2)

  const marketCapUsd = trade.marketCap
    ? toDecimal(trade.marketCap)
    : priceUsd.mul(TOTAL_SUPPLY_TOKENS).toDecimalPlaces(2)

  const coinMeta = (trade.coinMeta as Record<string, unknown> | undefined) ?? {}
  const metadata = normalizeTokenMetadata(coinMeta)

  const rawMetadataUri = firstString(coinMeta.uri, coinMeta.metadata_uri, coinMeta.metadataUri)
  const metadataUri = rawMetadataUri ? normalizeIpfsUri(rawMetadataUri) : null
  const imageUri = metadata.image ? normalizeIpfsUri(metadata.image) : null

  const creatorAddress = trade.creatorAddress ?? (coinMeta.creator as string) ?? "unknown"
  const feedCreatedTs = coinMeta.createdTs as number | undefined
  const createdTs =
    typeof feedCreatedTs === "number" && Number.isFinite(feedCreatedTs) && feedCreatedTs > 0
      ? feedCreatedTs
      : timestampMs

  const symbolFromName = (name?: string | null) =>
    name ? name.replace(/[^A-Za-z0-9]/g, "").slice(0, 10).toUpperCase() : undefined

  const symbol =
    metadata.symbol ??
    (coinMeta.symbol as string) ??
    symbolFromName(metadata.name ?? (coinMeta.name as string)) ??
    trade.mintAddress.slice(0, 6).toUpperCase()

  const name = metadata.name ?? (coinMeta.name as string) ?? symbol ?? trade.mintAddress

  const bondingCurve = firstString(coinMeta.bondingCurve, coinMeta.bonding_curve) ?? null
  const associatedBondingCurve = firstString(
    coinMeta.associatedBondingCurve,
    coinMeta.associated_bonding_curve
  ) ?? null

  const program = typeof trade.program === "string" ? trade.program.toLowerCase() : ""
  const isKoth = trade.isBondingCurve === false || (!bondingCurve && program.includes("amm"))

  if (!metadataFirstSeenTime.has(trade.mintAddress)) {
    metadataFirstSeenTime.set(trade.mintAddress, Date.now())
  }

  return {
    mint: trade.mintAddress,
    tx: trade.tx,
    userAddress: trade.userAddress ?? "unknown",
    isBuy,
    amountSol,
    amountUsd,
    baseAmount: baseAmountRaw,
    priceSol,
    priceUsd,
    marketCapUsd,
    timestampMs,
    symbol,
    name,
    creatorAddress,
    createdTs,
    imageUri,
    metadataUri,
    twitter: metadata.twitter ?? null,
    telegram: metadata.telegram ?? null,
    website: metadata.website ?? null,
    description: metadata.description ?? null,
    bondingCurve,
    associatedBondingCurve,
    isKoth,
  }
}

// =============================================================================
// High-Performance Bulk Insert (Raw SQL)
// =============================================================================

async function persistTradesBulk(trades: PreparedTrade[]): Promise<void> {
  if (trades.length === 0) return

  const startTime = Date.now()

  // Group by mint to get unique tokens and their latest trade
  const tokenMap = new Map<string, PreparedTrade>()
  for (const trade of trades) {
    const existing = tokenMap.get(trade.mint)
    if (!existing || trade.timestampMs > existing.timestampMs) {
      tokenMap.set(trade.mint, trade)
    }
  }

  const uniqueTokens = Array.from(tokenMap.values())
  const mintToId = new Map<string, string>()

  try {
    // Step 1: Check cache first, only query/insert tokens not in cache
    const uncachedTokens: PreparedTrade[] = []
    for (const t of uniqueTokens) {
      const cachedId = tokenIdCache.get(t.mint)
      if (cachedId) {
        mintToId.set(t.mint, cachedId)
      } else {
        uncachedTokens.push(t)
      }
    }

    // Only process uncached tokens
    if (uncachedTokens.length > 0) {
      const tokenValues = uncachedTokens
        .map((t) => {
          const id = generateCuid()
          return `(${escapeSQL(id)},${escapeSQL(t.mint)},${escapeSQL(t.symbol.slice(0, 50))},${escapeSQL(t.name.slice(0, 200))},${escapeSQL(t.imageUri)},${escapeSQL(t.metadataUri)},${escapeSQL(t.twitter)},${escapeSQL(t.telegram)},${escapeSQL(t.website)},${escapeSQL(t.description?.slice(0, 1000) ?? null)},${escapeSQL(t.creatorAddress)},${t.createdTs},${t.isKoth ? t.timestampMs : "NULL"},${t.isKoth},${escapeSQL(t.bondingCurve)},${escapeSQL(t.associatedBondingCurve)},NOW())`
        })
        .join(",")

      // INSERT new tokens, skip existing
      await prisma.$executeRawUnsafe(`
        INSERT INTO tokens (id,mint_address,symbol,name,image_uri,metadata_uri,twitter,telegram,website,description,creator_address,created_timestamp,king_of_the_hill_timestamp,completed,bonding_curve,associated_bonding_curve,updated_at)
        VALUES ${tokenValues}
        ON CONFLICT (mint_address) DO NOTHING
      `)

      // Get IDs for uncached tokens only
      const mints = uncachedTokens.map((t) => t.mint)
      const tokenIds = await prisma.token.findMany({
        where: { mintAddress: { in: mints } },
        select: { id: true, mintAddress: true, metadataUri: true, imageUri: true },
      })
      for (const row of tokenIds) {
        mintToId.set(row.mintAddress, row.id)
        tokenIdCache.set(row.mintAddress, row.id) // Cache for future
      }

      // Schedule metadata retries for tokens missing metadata only
      for (const t of uncachedTokens) {
        const token = tokenIds.find((token) => token.mintAddress === t.mint)
        // Only schedule if token doesn't have both metadataUri and imageUri
        if (!token || !token.metadataUri || !token.imageUri) {
          scheduleMetadataRetry(t.mint)
        }
      }
    }

    // Step 2: Run price and trade inserts in PARALLEL for speed
    const priceTokens = uniqueTokens.filter((t) => mintToId.has(t.mint))
    const validTrades = trades.filter((t) => mintToId.has(t.mint))

    const parallelOps: Promise<unknown>[] = []

    // Price upsert
    if (priceTokens.length > 0) {
      const priceValues = priceTokens
        .map((t) => {
          const tokenId = mintToId.get(t.mint)!
          return `(${escapeSQL(tokenId)},${t.priceSol},${t.priceUsd},${t.marketCapUsd},${t.timestampMs},NOW())`
        })
        .join(",")

      parallelOps.push(
        prisma.$executeRawUnsafe(`
          INSERT INTO token_prices (token_id,price_sol,price_usd,market_cap_usd,last_trade_timestamp,updated_at)
          VALUES ${priceValues}
          ON CONFLICT (token_id) DO UPDATE SET
            price_sol=EXCLUDED.price_sol,price_usd=EXCLUDED.price_usd,
            market_cap_usd=EXCLUDED.market_cap_usd,last_trade_timestamp=EXCLUDED.last_trade_timestamp,updated_at=NOW()
        `)
      )
    }

    // Trade insert
    if (validTrades.length > 0) {
      const tradeValues = validTrades
        .map((t) => {
          const tokenId = mintToId.get(t.mint)!
          return `(${escapeSQL(tokenId)},${escapeSQL(t.tx)},${escapeSQL(t.userAddress)},${t.isBuy},${t.amountSol},${t.amountUsd},${t.baseAmount},${t.priceSol},${t.priceUsd},${t.timestampMs},NOW())`
        })
        .join(",")

      parallelOps.push(
        prisma.$executeRawUnsafe(`
          INSERT INTO trades (token_id,tx_signature,user_address,is_buy,amount_sol,amount_usd,base_amount,price_sol,price_usd,timestamp,created_at)
          VALUES ${tradeValues}
          ON CONFLICT (tx_signature) DO NOTHING
        `)
      )
    }

    // Run both in parallel
    await Promise.all(parallelOps)

    const duration = Date.now() - startTime
    const rate = trades.length / (duration / 1000)
    console.log(
      `[ingest] ✅ ${trades.length} trades in ${duration}ms (${rate.toFixed(0)}/sec) | cache: ${tokenIdCache.size}`
    )
  } catch (error) {
    console.error("[ingest] ❌ Bulk insert failed:", (error as Error).message)
    throw error
  }
}

// =============================================================================
// Queue Processing
// =============================================================================

async function processQueue(): Promise<void> {
  if (activeProcessors >= MAX_PROCESSORS || tradeQueue.length === 0) return

  activeProcessors++
  const batchSize = Math.min(tradeQueue.length, QUEUE_BATCH_SIZE)
  const batch = tradeQueue.splice(0, batchSize)
  lastQueueFlush = Date.now()

  try {
    const solPrice = await getSolPriceUsd()
    const prepared = batch
      .map((trade) => prepareTrade(trade, solPrice))
      .filter((t): t is PreparedTrade => t !== null)

    if (prepared.length > 0) {
      // Sort by mint to ensure consistent lock order (prevents deadlocks)
      prepared.sort((a, b) => a.mint.localeCompare(b.mint))
      await persistTradesBulk(prepared)
    }

    if (tradeQueue.length > 0) {
      console.log(`[ingest] Queue: ${tradeQueue.length}`)
    }
  } catch (error) {
    const errMsg = (error as Error).message
    // Retry on deadlock
    if (errMsg.includes("deadlock") || errMsg.includes("40P01")) {
      console.warn(`[ingest] ⚠️ Deadlock, retrying ${batch.length} trades...`)
      tradeQueue.unshift(...batch)
    } else {
      console.error("[ingest] ❌ Error:", errMsg)
      tradeQueue.unshift(...batch)
    }
  } finally {
    activeProcessors--
    // Process next batch immediately
    if (tradeQueue.length >= QUEUE_BATCH_SIZE) {
      setImmediate(() => void processQueue())
    }
  }
}

function scheduleQueueProcessing(): void {
  if (tradeQueue.length >= QUEUE_BATCH_SIZE && activeProcessors < MAX_PROCESSORS) {
    void processQueue()
  }
}

// Periodic flush for low-volume periods
setInterval(() => {
  if (tradeQueue.length > 0 && Date.now() - lastQueueFlush >= QUEUE_FLUSH_INTERVAL_MS) {
    void processQueue()
  }
}, QUEUE_FLUSH_INTERVAL_MS / 2)

// =============================================================================
// Metadata Retry System
// =============================================================================

function scheduleMetadataRetry(mint: string): void {
  if (!mint || metadataRetryQueue.has(mint)) return
  const attempts = metadataRetryAttempts.get(mint) ?? 0
  if (attempts >= METADATA_RETRY_MAX_ATTEMPTS) return
  metadataRetryAttempts.set(mint, attempts + 1)
  metadataRetryQueue.add(mint)
}

async function fetchMetadataFromUri(uri: string): Promise<unknown | null> {
  if (!uri || metadataCache.has(uri)) return metadataCache.get(uri) ?? null

  const candidates = getIpfsGatewayUrls(uri)
  const targets = candidates.length > 0 ? candidates : [normalizeIpfsUri(uri) ?? uri]

  for (const target of targets) {
    for (let attempt = 0; attempt < METADATA_FETCH_MAX_ATTEMPTS; attempt++) {
      try {
        const elapsed = Date.now() - lastMetadataRequestAt
        const requiredSpacing = METADATA_MIN_INTERVAL_MS + metadataDynamicDelayMs
        if (elapsed < requiredSpacing) {
          await delay(requiredSpacing - elapsed)
        }
        lastMetadataRequestAt = Date.now()

        const response = await fetch(target, {
          headers: { ...PUMP_HEADERS, accept: "application/json" },
        })

        if (response.status >= 500 || response.status === 429) {
          metadataDynamicDelayMs = Math.min(metadataDynamicDelayMs + 100, 2000)
          await delay(250 * Math.pow(2, attempt))
          continue
        }

        metadataDynamicDelayMs = Math.max(0, metadataDynamicDelayMs - 25)

        if (response.ok) {
          const json = await response.json()
          metadataCache.set(uri, json)
          return json
        }
      } catch {
        await delay(250 * Math.pow(2, attempt))
      }
    }
  }
  return null
}

async function refreshTokenMetadata(mint: string): Promise<boolean> {
  try {
    const token = await prisma.token.findUnique({
      where: { mintAddress: mint },
      select: {
        id: true,
        metadataUri: true,
        imageUri: true,
        name: true,
        symbol: true,
        description: true,
        twitter: true,
        telegram: true,
        website: true,
        completed: true,
        createdTimestamp: true,
      },
    })

    if (!token) return true

    // Skip if token already has both metadataUri and imageUri
    if (token.metadataUri && token.imageUri) {
      return true
    }

    const coinInfo = await fetchPumpCoin(mint)
    if (!coinInfo) return false

    const coinRecord = coinInfo as Record<string, unknown>
    const rawUri = firstString(coinRecord.metadataUri, coinRecord.metadata_uri, coinRecord.uri)
    const metadataUri = rawUri ? normalizeIpfsUri(rawUri) : null

    let metadata = normalizeTokenMetadata(
      (coinRecord.metadata as Record<string, unknown>) ?? coinRecord
    )

    if (rawUri) {
      const remoteData = await fetchMetadataFromUri(rawUri)
      if (remoteData && typeof remoteData === "object") {
        const remoteMeta = normalizeTokenMetadata(remoteData as Record<string, unknown>)
        metadata = { ...metadata, ...remoteMeta }
      }
    }

    const imageUri = metadata.image ? normalizeIpfsUri(metadata.image) : null

    const updates: Record<string, unknown> = {}

    if (metadata.name && token.name?.match(/^[A-Z0-9]{1,6}$/)) {
      updates.name = metadata.name
    }
    if (metadata.symbol && token.symbol?.match(/^[A-Z0-9]{1,6}$/)) {
      updates.symbol = metadata.symbol
    }
    if (metadataUri && !token.metadataUri) {
      updates.metadataUri = metadataUri
    }
    if (imageUri && !token.imageUri) {
      updates.imageUri = imageUri
    }
    if (metadata.description && !token.description) {
      updates.description = metadata.description
    }
    if (metadata.twitter && !token.twitter) {
      updates.twitter = metadata.twitter
    }
    if (metadata.telegram && !token.telegram) {
      updates.telegram = metadata.telegram
    }
    if (metadata.website && !token.website) {
      updates.website = metadata.website
    }

    if (token.completed) {
      const dexCreatedAt = await getDexPairCreatedAt(mint)
      if (dexCreatedAt && (!token.createdTimestamp || dexCreatedAt < Number(token.createdTimestamp))) {
        updates.createdTimestamp = BigInt(dexCreatedAt)
      }
    }

    if (Object.keys(updates).length > 0) {
      await prisma.token.update({
        where: { id: token.id },
        data: updates,
      })
    }

    return true
  } catch (error) {
    console.warn(`[metadata] Failed ${mint}:`, (error as Error).message)
    return false
  }
}

async function processMetadataRetryQueue(): Promise<void> {
  if (isProcessingMetadataQueue || metadataRetryQueue.size === 0) return

  isProcessingMetadataQueue = true
  const batch = Array.from(metadataRetryQueue).slice(0, METADATA_RETRY_BATCH_SIZE)
  let successCount = 0

  try {
    for (const mint of batch) {
      metadataRetryQueue.delete(mint)
      const success = await refreshTokenMetadata(mint)
      if (success) {
        metadataRetryAttempts.delete(mint)
        successCount++
        const firstSeen = metadataFirstSeenTime.get(mint)
        metadataFirstSeenTime.delete(mint)
        if (firstSeen) {
          const waitSec = Math.floor((Date.now() - firstSeen) / 1000)
          console.log(`[metadata] ✅ ${mint.slice(0, 8)}... (${waitSec}s)`)
        }
      } else {
        scheduleMetadataRetry(mint)
      }
      await delay(50)
    }

    console.log(`[metadata] ${batch.length} processed (${successCount} ok) | Queue: ${metadataRetryQueue.size}`)
  } finally {
    isProcessingMetadataQueue = false
  }
}

setInterval(() => void processMetadataRetryQueue(), METADATA_RETRY_INTERVAL_MS)

// Periodic logging of metadata queue size
setInterval(() => {
  const queueSize = metadataRetryQueue.size
  if (queueSize > 0) {
    console.log(`[metadata] Queue size: ${queueSize} tokens waiting for metadata`)
  }
}, 10_000) // Log every 10 seconds if queue has items

// =============================================================================
// Cleanup Old Trades
// =============================================================================

async function cleanupOldTrades(): Promise<void> {
  if (TRADE_RETENTION_HOURS <= 0) return

  try {
    const cutoff = BigInt(Date.now() - TRADE_RETENTION_HOURS * 60 * 60 * 1000)
    console.log(`[cleanup] Cleaning trades older than ${TRADE_RETENTION_HOURS}h`)

    let totalDeleted = 0
    let batchDeleted = 0

    do {
      const result = await prisma.$executeRawUnsafe(`
        DELETE FROM trades
        WHERE id IN (
          SELECT id FROM trades
          WHERE timestamp < ${cutoff}
          LIMIT ${CLEANUP_BATCH_SIZE}
        )
      `)
      batchDeleted = Number(result)
      totalDeleted += batchDeleted

      if (batchDeleted > 0) {
        console.log(`[cleanup] Deleted ${batchDeleted} (${totalDeleted} total)`)
        await delay(100)
      }
    } while (batchDeleted === CLEANUP_BATCH_SIZE)

    console.log(`[cleanup] ✅ Done: ${totalDeleted} trades deleted`)
  } catch (error) {
    console.error("[cleanup] ❌ Failed:", (error as Error).message)
  }
}

if (TRADE_RETENTION_HOURS > 0) {
  console.log(`[cleanup] Retention: ${TRADE_RETENTION_HOURS}h`)
  setTimeout(() => void cleanupOldTrades(), 5 * 60 * 1000)
  setInterval(() => void cleanupOldTrades(), CLEANUP_INTERVAL_MS)
}

// =============================================================================
// Seed Metadata Queue on Startup
// =============================================================================

async function seedMetadataRetryQueue(): Promise<void> {
  try {
    const candidates = await prisma.token.findMany({
      where: {
        OR: [{ imageUri: null }, { metadataUri: null }, { description: null }],
      },
      select: { mintAddress: true },
      take: 5000,
    })

    for (const token of candidates) {
      if (token.mintAddress) {
        scheduleMetadataRetry(token.mintAddress)
      }
    }

    console.log(`[metadata] Seeded ${candidates.length} tokens`)
  } catch (error) {
    console.warn("[metadata] Seed failed:", (error as Error).message)
  }
}

void seedMetadataRetryQueue()

// =============================================================================
// WebSocket / NATS Connection
// =============================================================================

function handleMessageChunk(chunk: string): void {
  messageBuffer += chunk

  while (messageBuffer.length > 0) {
    if (messageBuffer.startsWith("PING")) {
      ws?.send("PONG\r\n")
      const newline = messageBuffer.indexOf("\r\n")
      messageBuffer = newline === -1 ? "" : messageBuffer.slice(newline + 2)
      continue
    }

    if (messageBuffer.startsWith("PONG") || messageBuffer.startsWith("+OK") || messageBuffer.startsWith("INFO")) {
      const newline = messageBuffer.indexOf("\r\n")
      if (newline === -1) return
      messageBuffer = messageBuffer.slice(newline + 2)
      continue
    }

    if (!messageBuffer.startsWith("MSG")) {
      const newline = messageBuffer.indexOf("\r\n")
      messageBuffer = newline === -1 ? "" : messageBuffer.slice(newline + 2)
      continue
    }

    const headerEnd = messageBuffer.indexOf("\r\n")
    if (headerEnd === -1) return

    const header = messageBuffer.slice(0, headerEnd)
    const parts = header.split(" ")
    if (parts.length < 4) {
      messageBuffer = messageBuffer.slice(headerEnd + 2)
      continue
    }

    const size = Number(parts[3])
    const totalLength = headerEnd + 2 + size + 2
    if (messageBuffer.length < totalLength) return

    const payload = messageBuffer.slice(headerEnd + 2, headerEnd + 2 + size)
    messageBuffer = messageBuffer.slice(totalLength)

    const trade = decodePumpPayload(payload)
    if (trade) {
      tradeQueue.push(trade as PumpUnifiedTrade)

      if (tradeQueue.length % 500 === 0) {
        console.log(`[ingest] Queue: ${tradeQueue.length}`)
      }

      scheduleQueueProcessing()
    }
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    console.log("[ingest] Reconnecting...")
    connectToFeed()
  }, 2000)
}

function connectToFeed(): void {
  ws = new WebSocket(NATS_URL, { headers: NATS_HEADERS })

  ws.once("open", () => {
    console.log("✅ Connected to Pump.fun trade feed")
    messageBuffer = ""
    ws?.send(`CONNECT ${JSON.stringify(NATS_CONNECT_PAYLOAD)}\r\n`)
    ws?.send("PING\r\n")
    ws?.send("SUB unifiedTradeEvent.processed sub0\r\n")
  })

  ws.on("message", (data: WebSocket.Data) => handleMessageChunk(data.toString()))

  ws.on("close", (code: number) => {
    console.warn(`[ingest] Closed (${code})`)
    scheduleReconnect()
  })

  ws.on("error", (error: Error) => {
    console.error("[ingest] WS error:", error.message)
    ws?.close()
  })
}

// =============================================================================
// Startup
// =============================================================================

console.log("🚀 Trade ingestion (optimized)")
console.log(`   Batch: ${QUEUE_BATCH_SIZE} | Flush: ${QUEUE_FLUSH_INTERVAL_MS}ms | Pool: ${CONNECTION_LIMIT}`)

connectToFeed()

// Auto-restart every 24 hours
setTimeout(async () => {
  console.log("🔄 24h restart...")
  ws?.close()
  await prisma.$disconnect()
  process.exit(0)
}, 24 * 60 * 60 * 1000)

process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down...")
  ws?.close()
  await prisma.$disconnect()
  process.exit(0)
})

process.on("SIGTERM", async () => {
  console.log("\n🛑 Shutting down...")
  ws?.close()
  await prisma.$disconnect()
  process.exit(0)
})
