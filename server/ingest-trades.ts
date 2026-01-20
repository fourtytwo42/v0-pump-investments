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
const METADATA_RETRY_INTERVAL_MS = 1_000 // Check queue every second
const METADATA_RETRY_TIMEOUT_MS = 6_000 // 6 second timeout per token
const METADATA_RETRY_BATCH_SIZE = 25 // Process 25 tokens in parallel per batch
const METADATA_RETRY_MAX_ATTEMPTS = 5
const METADATA_FETCH_MAX_ATTEMPTS = 3
const METADATA_MIN_INTERVAL_MS = 150

// Cleanup configuration
const TRADE_RETENTION_HOURS = process.env.TRADE_RETENTION_HOURS
  ? parseInt(process.env.TRADE_RETENTION_HOURS, 10)
  : 0
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000
const CLEANUP_BATCH_SIZE = 1000

// Candle generation configuration
const ENABLE_CANDLE_GENERATION = process.env.ENABLE_CANDLE_GENERATION === "true"
const CANDLE_GENERATION_INTERVAL_MS = 60 * 1000 // Run every minute
const CANDLE_BATCH_SIZE = 100 // Process 100 tokens per cycle

// Logging throttling
const LOG_INTERVAL_MS = 30 * 1000 // Log every 30 seconds max
let lastLogTime = 0
let logBatchCount = 0

// Track when the service started - only process tokens with trades from this point forward
// This avoids backfilling old data and focuses on active tokens
const SERVICE_START_TIMESTAMP = BigInt(Date.now())

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
const MAX_PROCESSORS = 5 // Reduced from 10 to avoid connection pool exhaustion
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
  isCompleted: boolean
  kingOfTheHillTimestamp: number | null
  raw: PumpUnifiedTrade | null // Store full raw payload including marketCap
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
  // completed = true when token has graduated
  // The API uses "complete" (boolean), not "completed"
  // Note: bonding curve address persists even after graduation, so we can't rely on it
  // The websocket isBondingCurve flag is also unreliable - use API "complete" field when available
  const coinInfoComplete = coinMeta.complete ?? coinMeta.completed ?? coinMeta.isCompleted
  const isCompleted = typeof coinInfoComplete === "boolean" 
    ? coinInfoComplete 
    : (trade.isBondingCurve === false) // Fallback to websocket flag if coinMeta doesn't have complete status
  
  // KOTH is a milestone during bonding (about halfway), not graduation
  // We'll determine KOTH separately - for now, we don't set it from trade data
  // KOTH timestamp should come from metadata or be calculated separately
  const kingOfTheHillTimestamp: number | null = null

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
    isCompleted,
    kingOfTheHillTimestamp,
    raw: trade, // Store full raw payload including marketCap, supply, etc.
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
          return `(${escapeSQL(id)},${escapeSQL(t.mint)},${escapeSQL(t.symbol.slice(0, 50))},${escapeSQL(t.name.slice(0, 200))},${escapeSQL(t.imageUri)},${escapeSQL(t.metadataUri)},${escapeSQL(t.twitter)},${escapeSQL(t.telegram)},${escapeSQL(t.website)},${escapeSQL(t.description?.slice(0, 1000) ?? null)},${escapeSQL(t.creatorAddress)},${t.createdTs},${t.kingOfTheHillTimestamp ? t.kingOfTheHillTimestamp : "NULL"},${t.isCompleted},${escapeSQL(t.bondingCurve)},${escapeSQL(t.associatedBondingCurve)},NOW())`
        })
        .join(",")

      // INSERT new tokens, update existing if bonding status changed (only if we have values)
      if (tokenValues.length > 0) {
        try {
          await prisma.$executeRawUnsafe(`
            INSERT INTO tokens (id,mint_address,symbol,name,image_uri,metadata_uri,twitter,telegram,website,description,creator_address,created_timestamp,king_of_the_hill_timestamp,completed,bonding_curve,associated_bonding_curve,updated_at)
            VALUES ${tokenValues}
            ON CONFLICT (mint_address) DO UPDATE SET
              bonding_curve = EXCLUDED.bonding_curve,
              associated_bonding_curve = EXCLUDED.associated_bonding_curve,
              completed = EXCLUDED.completed,
              king_of_the_hill_timestamp = EXCLUDED.king_of_the_hill_timestamp,
              updated_at = NOW()
          `)
        } catch (error) {
          const errMsg = (error as Error).message
          console.error(`[ingest] Token insert failed for ${uncachedTokens.length} tokens:`, errMsg)
          // If it's a connection error, don't throw - let it retry later
          if (errMsg.includes("connector") || errMsg.includes("connection")) {
            console.warn(`[ingest] Connection issue, will retry tokens later`)
            // Put tokens back in queue for retry
            for (const t of uncachedTokens) {
              tradeQueue.unshift({ mintAddress: t.mint } as PumpUnifiedTrade)
            }
            return // Exit early, don't process prices/trades if tokens failed
          }
          throw error
        }
      }

      // Get IDs for uncached tokens only
      const mints = uncachedTokens.map((t) => t.mint)
      const tokenIds = await prisma.token.findMany({
        where: { mintAddress: { in: mints } },
        select: { id: true, mintAddress: true, metadataUri: true, imageUri: true, completed: true },
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

    // Step 2: Run price, market cap history, and trade inserts in PARALLEL for speed
    const priceTokens = uniqueTokens.filter((t) => mintToId.has(t.mint))
    const validTrades = trades.filter((t) => mintToId.has(t.mint))

    const parallelOps: Promise<unknown>[] = []

    // Price upsert
    if (priceTokens.length > 0) {
      const priceValues = priceTokens
        .map((t) => {
          const tokenId = mintToId.get(t.mint)
          if (!tokenId) return null
          // Convert Decimal to string for SQL
          const priceSol = t.priceSol.toString()
          const priceUsd = t.priceUsd.toString()
          const marketCapUsd = t.marketCapUsd.toString()
          return `(${escapeSQL(tokenId)},${priceSol},${priceUsd},${marketCapUsd},${t.timestampMs},NOW())`
        })
        .filter((v): v is string => v !== null)
        .join(",")

      if (priceValues.length > 0) {
        parallelOps.push(
          prisma.$executeRawUnsafe(`
            INSERT INTO token_prices (token_id,price_sol,price_usd,market_cap_usd,last_trade_timestamp,updated_at)
            VALUES ${priceValues}
            ON CONFLICT (token_id) DO UPDATE SET
              price_sol=EXCLUDED.price_sol,price_usd=EXCLUDED.price_usd,
              market_cap_usd=EXCLUDED.market_cap_usd,last_trade_timestamp=EXCLUDED.last_trade_timestamp,updated_at=NOW()
          `).catch((error) => {
            const errMsg = (error as Error).message
            console.error(`[ingest] Price upsert failed for ${priceTokens.length} tokens:`, errMsg)
            // If connection error, return resolved promise to continue
            if (errMsg.includes("connector") || errMsg.includes("connection")) {
              console.warn(`[ingest] Connection issue on price upsert, skipping`)
              return Promise.resolve()
            }
            throw error
          })
        )
      }
    }

    // Market cap history insert (store time series of market cap per trade)
    if (validTrades.length > 0) {
      const marketCapValues = validTrades
        .map((t) => {
          const tokenId = mintToId.get(t.mint)
          if (!tokenId) return null
          // Convert Decimal to string for SQL
          const marketCapUsd = t.marketCapUsd.toString()
          return `(${escapeSQL(tokenId)},${t.timestampMs},${marketCapUsd},'trade',NOW())`
        })
        .filter((v): v is string => v !== null)
        .join(",")

      if (marketCapValues.length > 0) {
        parallelOps.push(
          prisma.$executeRawUnsafe(`
            INSERT INTO token_market_caps (token_id,timestamp,market_cap_usd,source,created_at)
            VALUES ${marketCapValues}
            ON CONFLICT (token_id, timestamp) DO NOTHING
          `).catch((error) => {
            const errMsg = (error as Error).message
            // Non-fatal: market cap history insert failures shouldn't block trade ingestion
            if (errMsg.includes("connector") || errMsg.includes("connection")) {
              console.warn(`[ingest] Connection issue on market cap history insert, skipping`)
              return Promise.resolve()
            }
            // Only log, don't throw - market cap history is secondary to trade ingestion
            console.warn(`[ingest] Market cap history insert failed (non-fatal):`, errMsg)
            return Promise.resolve()
          })
        )
      }
    }

    // Trade insert (with raw JSONB payload including marketCap)
    if (validTrades.length > 0) {
      const tradeValues = validTrades
        .map((t) => {
          const tokenId = mintToId.get(t.mint)
          if (!tokenId) return null
          // Convert Decimal to string for SQL
          const amountSol = t.amountSol.toString()
          const amountUsd = t.amountUsd.toString()
          const baseAmount = t.baseAmount.toString()
          const priceSol = t.priceSol.toString()
          const priceUsd = t.priceUsd.toString()
          // Store raw payload as JSONB (includes marketCap, supply, etc.)
          const rawJson = t.raw ? escapeSQL(JSON.stringify(t.raw)) : "NULL"
          return `(${escapeSQL(tokenId)},${escapeSQL(t.tx)},${escapeSQL(t.userAddress)},${t.isBuy},${amountSol},${amountUsd},${baseAmount},${priceSol},${priceUsd},${t.timestampMs},${rawJson}::jsonb,NOW())`
        })
        .filter((v): v is string => v !== null)
        .join(",")

      if (tradeValues.length > 0) {
        parallelOps.push(
          prisma.$executeRawUnsafe(`
            INSERT INTO trades (token_id,tx_signature,user_address,is_buy,amount_sol,amount_usd,base_amount,price_sol,price_usd,timestamp,raw,created_at)
            VALUES ${tradeValues}
            ON CONFLICT (tx_signature) DO NOTHING
          `).catch((error) => {
            const errMsg = (error as Error).message
            console.error(`[ingest] Trade insert failed for ${validTrades.length} trades:`, errMsg)
            // If connection error, return resolved promise to continue
            if (errMsg.includes("connector") || errMsg.includes("connection")) {
              console.warn(`[ingest] Connection issue on trade insert, skipping`)
              return Promise.resolve()
            }
            throw error
          })
        )
      }
    }

    // Run both in parallel (only if we have operations)
    if (parallelOps.length > 0) {
      try {
        await Promise.all(parallelOps)
      } catch (error) {
        // If parallel execution fails, try sequential as fallback
        console.warn(`[ingest] Parallel execution failed, retrying sequentially:`, (error as Error).message)
        for (const op of parallelOps) {
          try {
            await op
          } catch (seqError) {
            console.error(`[ingest] Sequential operation also failed:`, (seqError as Error).message)
            // Don't throw - continue with other operations
          }
        }
      }
    }

    // Step 3: Update completion status for tokens with market cap > $60k
    // Assume tokens over $60k have graduated from bonding curve
    if (priceTokens.length > 0) {
      const graduatedTokens = priceTokens.filter((t) => {
        const marketCap = t.marketCapUsd.toNumber()
        return marketCap > 60000
      })

      if (graduatedTokens.length > 0) {
        const graduatedMints = graduatedTokens.map((t) => t.mint)
        // Update tokens to completed = true if market cap > $60k
        await prisma.token.updateMany({
          where: {
            mintAddress: { in: graduatedMints },
            completed: false, // Only update if not already completed
          },
          data: {
            completed: true,
          },
        }).catch((error) => {
          // Don't fail the whole batch if this update fails
          console.warn(`[ingest] Failed to update completion status for ${graduatedTokens.length} tokens:`, (error as Error).message)
        })
      }
    }

    const duration = Date.now() - startTime
    const rate = trades.length / (duration / 1000)
    logBatchCount++
    const now = Date.now()
    
    // Only log every 30 seconds or every 20 batches, whichever comes first
    if (now - lastLogTime >= LOG_INTERVAL_MS || logBatchCount >= 20) {
      console.log(
        `[ingest] ✅ ${trades.length} trades in ${duration}ms (${rate.toFixed(0)}/sec) | cache: ${tokenIdCache.size} | batches: ${logBatchCount}`
      )
      lastLogTime = now
      logBatchCount = 0
    }
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

    // Only log queue size every 30 seconds
    const now = Date.now()
    if (tradeQueue.length > 0 && (now - lastLogTime >= LOG_INTERVAL_MS)) {
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

function isValidSolanaAddress(address: string): boolean {
  // Solana addresses are base58 encoded and typically 32-44 characters
  // Filter out obvious fake addresses (ending in "pump", too short, etc.)
  if (!address || address.length < 32 || address.length > 44) return false
  if (address.toLowerCase().endsWith("pump")) return false
  // Base58 characters: 1-9, A-H, J-N, P-Z, a-k, m-z (no 0, O, I, l)
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/
  return base58Regex.test(address)
}

function scheduleMetadataRetry(mint: string): void {
  if (!mint || !isValidSolanaAddress(mint) || metadataRetryQueue.has(mint)) return
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
          try {
            const json = await response.json()
            metadataCache.set(uri, json)
            return json
          } catch (parseError) {
            // If response is not valid JSON (e.g., image file), skip this target
            continue
          }
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

    // Only fetch metadata if token is missing it
    // We'll update completed status when we fetch metadata, but we can't fetch for every token on every trade
    const shouldFetchMetadata = !token.metadataUri || !token.imageUri
    
    // If token already has metadata, skip to avoid rate limits
    // Completion status will be updated when metadata is fetched for tokens that need it
    if (!shouldFetchMetadata) {
      return true
    }

    const coinInfo = await fetchPumpCoin(mint)
    if (!coinInfo) {
      // If fetchPumpCoin returns null, the token doesn't exist on pump.fun
      // Don't retry - mark as max attempts to prevent re-queuing
      metadataRetryAttempts.set(mint, METADATA_RETRY_MAX_ATTEMPTS)
      return false
    }

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

    // Update completed status from API when we fetch metadata (authoritative source)
    // This is the only time we check completion status to avoid rate limits
    const coinInfoComplete = coinRecord.complete ?? coinRecord.completed ?? coinRecord.isCompleted
    if (typeof coinInfoComplete === "boolean" && coinInfoComplete !== token.completed) {
      updates.completed = coinInfoComplete
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

    // Completed status is already updated above from coinInfo
    if (token.completed || (typeof coinInfoComplete === "boolean" && coinInfoComplete)) {
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

    // Only return true if we now have both metadataUri and imageUri (or already had both)
    // This prevents re-seeding tokens that legitimately don't have metadata available
    const updatedToken = await prisma.token.findUnique({
      where: { id: token.id },
      select: { metadataUri: true, imageUri: true },
    })
    if (updatedToken && updatedToken.metadataUri && updatedToken.imageUri) {
      return true
    }

    // Return false if we still don't have both metadataUri and imageUri
    // This will cause the token to be retried (up to METADATA_RETRY_MAX_ATTEMPTS)
    return false
  } catch (error) {
    console.warn(`[metadata] Failed ${mint}:`, (error as Error).message)
    return false
  }
}

async function processMetadataRetryQueue(): Promise<void> {
  if (isProcessingMetadataQueue) {
    return
  }
  if (metadataRetryQueue.size === 0) {
    return
  }

  isProcessingMetadataQueue = true
  const batchStartTime = Date.now()

  try {
    // Get batch of 25 tokens
    const batch = Array.from(metadataRetryQueue).slice(0, METADATA_RETRY_BATCH_SIZE)
    if (batch.length === 0) {
      return
    }

    // Remove all from queue immediately
    for (const mint of batch) {
      metadataRetryQueue.delete(mint)
    }

    // Processing batch - no log needed, batch summary will show

    // Process all tokens in parallel with timeout
    const promises = batch.map(async (mint) => {
      const tokenStartTime = Date.now()
      
      try {
        // Use Promise.race with timeout to prevent hanging
        const timeoutPromise = new Promise<boolean>((resolve) => {
          setTimeout(() => {
            resolve(false)
          }, METADATA_RETRY_TIMEOUT_MS)
        })

        const metadataPromise = refreshTokenMetadata(mint).catch(() => false)
        const success = await Promise.race([metadataPromise, timeoutPromise])

        const tokenElapsed = Date.now() - tokenStartTime

        if (tokenElapsed >= METADATA_RETRY_TIMEOUT_MS) {
          // Timeout occurred - re-queue the mint
          const attempts = metadataRetryAttempts.get(mint) ?? 0
          if (attempts < METADATA_RETRY_MAX_ATTEMPTS) {
            scheduleMetadataRetry(mint)
          }
          return { mint, success: false, timeout: true, elapsed: tokenElapsed }
        } else if (success) {
          // Success
          metadataRetryAttempts.delete(mint)
          const firstSeen = metadataFirstSeenTime.get(mint)
          metadataFirstSeenTime.delete(mint)
          return { mint, success: true, timeout: false, elapsed: tokenElapsed, firstSeen }
        } else {
          // Failed but didn't timeout - re-queue if under max attempts
          const attempts = metadataRetryAttempts.get(mint) ?? 0
          if (attempts < METADATA_RETRY_MAX_ATTEMPTS) {
            scheduleMetadataRetry(mint)
          }
          return { mint, success: false, timeout: false, elapsed: tokenElapsed }
        }
      } catch (error) {
        // Error occurred - re-queue if under max attempts
        const attempts = metadataRetryAttempts.get(mint) ?? 0
        if (attempts < METADATA_RETRY_MAX_ATTEMPTS) {
          scheduleMetadataRetry(mint)
        }
        return { mint, success: false, timeout: false, elapsed: tokenElapsed, error: (error as Error).message }
      }
    })

    // Wait for all promises to complete
    const results = await Promise.all(promises)

    // Count results (no individual logging - batch summary is enough)
    let successCount = 0
    let timeoutCount = 0
    let failedCount = 0

    for (const result of results) {
      if (result.success) {
        successCount++
      } else if (result.timeout) {
        timeoutCount++
      } else {
        failedCount++
        // Only log actual errors (not normal failures)
        if (result.error) {
          console.warn(`[metadata] ❌ Error processing ${result.mint.slice(0, 8)}...:`, result.error)
        }
      }
    }

    const batchElapsed = Date.now() - batchStartTime
    console.log(`[metadata] Batch complete: ${batch.length} processed (${successCount} ok, ${timeoutCount} timeout, ${failedCount} failed) | Queue: ${metadataRetryQueue.size} | Time: ${batchElapsed}ms`)

  } catch (error) {
    console.error(`[metadata] ❌ Error in processMetadataRetryQueue:`, (error as Error).message)
  } finally {
    isProcessingMetadataQueue = false
  }
}

// Start metadata processing interval - process one token at a time
setInterval(() => {
  if (metadataRetryQueue.size > 0 && !isProcessingMetadataQueue) {
    void processMetadataRetryQueue()
  }
}, METADATA_RETRY_INTERVAL_MS)

// Log queue size periodically (every 30 seconds) for monitoring
setInterval(() => {
  if (metadataRetryQueue.size > 0) {
    console.log(`[metadata] Queue size: ${metadataRetryQueue.size} tokens waiting for metadata`)
  }
}, 30_000)

// Also trigger immediately if queue has items
if (metadataRetryQueue.size > 0) {
  setTimeout(() => void processMetadataRetryQueue(), 1000)
}


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
    // Only seed tokens that have recent trades (from service start time forward)
    // This avoids backfilling old data and focuses on active tokens
    const nowTimestamp = BigInt(Date.now())
    
    // Count total tokens missing metadata (for logging only)
    const totalMissing = await prisma.token.count({
      where: {
        OR: [
          { metadataUri: null, imageUri: null },
          { metadataUri: null },
          { imageUri: null },
        ],
      },
    })

    // Count tokens with recent trades (from service start) that are missing metadata
    const activeMissing = await prisma.token.count({
      where: {
        OR: [
          { metadataUri: null, imageUri: null },
          { metadataUri: null },
          { imageUri: null },
        ],
        price: {
          lastTradeTimestamp: {
            gte: SERVICE_START_TIMESTAMP,
          },
        },
      },
    })

    // Only seed tokens missing metadata AND having recent trades (from service start forward)
    // Process in batches to avoid memory issues and stop if queue gets too large
    const batchSize = 5000
    let totalSeeded = 0
    let totalInvalid = 0
    let offset = 0
    let hasMore = true

    while (hasMore && metadataRetryQueue.size < 10000) {
      const candidates = await prisma.token.findMany({
        where: {
          OR: [
            { metadataUri: null, imageUri: null },
            { metadataUri: null },
            { imageUri: null },
          ],
          price: {
            lastTradeTimestamp: {
              gte: SERVICE_START_TIMESTAMP,
            },
          },
        },
        select: { mintAddress: true },
        skip: offset,
        take: batchSize,
      })

      if (candidates.length === 0) {
        hasMore = false
        break
      }

      let validCount = 0
      let invalidCount = 0
      for (const token of candidates) {
        if (token.mintAddress && isValidSolanaAddress(token.mintAddress)) {
          scheduleMetadataRetry(token.mintAddress)
          validCount++
        } else {
          invalidCount++
        }
      }

      totalSeeded += validCount
      totalInvalid += invalidCount
      offset += batchSize

      // Stop if we've processed all or if queue is getting too large
      if (candidates.length < batchSize) {
        hasMore = false
      }
    }

    if (totalSeeded > 0) {
      console.log(`[metadata] Seeded ${totalSeeded} active tokens (${totalInvalid} invalid filtered) | Active missing: ${activeMissing} | Total missing: ${totalMissing}`)
    }
  } catch (error) {
    console.warn("[metadata] Seed failed:", (error as Error).message)
  }
}

void seedMetadataRetryQueue()

// =============================================================================
// Candle Generation (Background Process)
// =============================================================================

async function generateFeaturesForCandles(): Promise<number> {
  if (!ENABLE_CANDLE_GENERATION) return 0

  try {
    // Generate features for candles that don't have features yet
    // Features: return, range, body, dlog_volume, ret_mean_15, ret_std_15, ret_mean_60, ret_std_60
    // Use full candle history per token for rolling windows, then upsert missing/bad rows.
    const updateResult = await prisma.$executeRawUnsafe(`
      WITH target_tokens AS (
        SELECT DISTINCT c.token_id
        FROM pump_candles_1m c
        LEFT JOIN pump_features_1m f
          ON f.token_id = c.token_id
          AND f.timestamp = c.timestamp
        WHERE f.token_id IS NULL
          OR (
            f.ret_mean_15 IS NULL
            AND f.ret_std_15 IS NULL
            AND f.ret_mean_60 IS NULL
            AND f.ret_std_60 IS NULL
          )
      ),
      candle_series AS (
        SELECT 
          c.token_id,
          c.timestamp,
          c.open,
          c.high,
          c.low,
          c.close,
          c.volume_usd,
          LAG(c.close, 1) OVER (PARTITION BY c.token_id ORDER BY c.timestamp) as prev_close
        FROM pump_candles_1m c
        JOIN target_tokens t ON t.token_id = c.token_id
      ),
      candle_returns AS (
        SELECT 
          cs.token_id,
          cs.timestamp,
          cs.open,
          cs.high,
          cs.low,
          cs.close,
          cs.volume_usd,
          CASE 
            WHEN cs.prev_close > 0 
            THEN (cs.close - cs.prev_close) / cs.prev_close
            ELSE NULL
          END as return_val
        FROM candle_series cs
      ),
      feature_rows AS (
        SELECT 
          cr.token_id,
          cr.timestamp,
          cr.return_val as "return",
          (cr.high - cr.low) as range,
          (cr.close - cr.open) as body,
          CASE 
            WHEN cr.volume_usd > 0 THEN LN(cr.volume_usd + 1)
            ELSE NULL
          END as dlog_volume,
          AVG(cr.return_val) OVER (PARTITION BY cr.token_id ORDER BY cr.timestamp ROWS BETWEEN 14 PRECEDING AND CURRENT ROW) as ret_mean_15,
          STDDEV(cr.return_val) OVER (PARTITION BY cr.token_id ORDER BY cr.timestamp ROWS BETWEEN 14 PRECEDING AND CURRENT ROW) as ret_std_15,
          AVG(cr.return_val) OVER (PARTITION BY cr.token_id ORDER BY cr.timestamp ROWS BETWEEN 59 PRECEDING AND CURRENT ROW) as ret_mean_60,
          STDDEV(cr.return_val) OVER (PARTITION BY cr.token_id ORDER BY cr.timestamp ROWS BETWEEN 59 PRECEDING AND CURRENT ROW) as ret_std_60
        FROM candle_returns cr
      )
      UPDATE pump_features_1m f
      SET
        "return" = fr."return",
        range = fr.range,
        body = fr.body,
        dlog_volume = fr.dlog_volume,
        ret_mean_15 = fr.ret_mean_15,
        ret_std_15 = fr.ret_std_15,
        ret_mean_60 = fr.ret_mean_60,
        ret_std_60 = fr.ret_std_60
      FROM feature_rows fr
      WHERE f.token_id = fr.token_id
        AND f.timestamp = fr.timestamp
        AND (
          f.ret_mean_15 IS NULL
          AND f.ret_std_15 IS NULL
          AND f.ret_mean_60 IS NULL
          AND f.ret_std_60 IS NULL
        );
    `)

    const insertResult = await prisma.$executeRawUnsafe(`
      WITH target_tokens AS (
        SELECT DISTINCT c.token_id
        FROM pump_candles_1m c
        LEFT JOIN pump_features_1m f
          ON f.token_id = c.token_id
          AND f.timestamp = c.timestamp
        WHERE f.token_id IS NULL
      ),
      candle_series AS (
        SELECT 
          c.token_id,
          c.timestamp,
          c.open,
          c.high,
          c.low,
          c.close,
          c.volume_usd,
          LAG(c.close, 1) OVER (PARTITION BY c.token_id ORDER BY c.timestamp) as prev_close
        FROM pump_candles_1m c
        JOIN target_tokens t ON t.token_id = c.token_id
      ),
      candle_returns AS (
        SELECT 
          cs.token_id,
          cs.timestamp,
          cs.open,
          cs.high,
          cs.low,
          cs.close,
          cs.volume_usd,
          CASE 
            WHEN cs.prev_close > 0 
            THEN (cs.close - cs.prev_close) / cs.prev_close
            ELSE NULL
          END as return_val
        FROM candle_series cs
      ),
      feature_rows AS (
        SELECT 
          cr.token_id,
          cr.timestamp,
          cr.return_val as "return",
          (cr.high - cr.low) as range,
          (cr.close - cr.open) as body,
          CASE 
            WHEN cr.volume_usd > 0 THEN LN(cr.volume_usd + 1)
            ELSE NULL
          END as dlog_volume,
          AVG(cr.return_val) OVER (PARTITION BY cr.token_id ORDER BY cr.timestamp ROWS BETWEEN 14 PRECEDING AND CURRENT ROW) as ret_mean_15,
          STDDEV(cr.return_val) OVER (PARTITION BY cr.token_id ORDER BY cr.timestamp ROWS BETWEEN 14 PRECEDING AND CURRENT ROW) as ret_std_15,
          AVG(cr.return_val) OVER (PARTITION BY cr.token_id ORDER BY cr.timestamp ROWS BETWEEN 59 PRECEDING AND CURRENT ROW) as ret_mean_60,
          STDDEV(cr.return_val) OVER (PARTITION BY cr.token_id ORDER BY cr.timestamp ROWS BETWEEN 59 PRECEDING AND CURRENT ROW) as ret_std_60
        FROM candle_returns cr
      )
      INSERT INTO pump_features_1m (token_id, timestamp, "return", range, body, dlog_volume, ret_mean_15, ret_std_15, ret_mean_60, ret_std_60)
      SELECT 
        fr.token_id,
        fr.timestamp,
        fr."return",
        fr.range,
        fr.body,
        fr.dlog_volume,
        fr.ret_mean_15,
        fr.ret_std_15,
        fr.ret_mean_60,
        fr.ret_std_60
      FROM feature_rows fr
      WHERE NOT EXISTS (
        SELECT 1 FROM pump_features_1m f
        WHERE f.token_id = fr.token_id
          AND f.timestamp = fr.timestamp
      )
    `)

    return Number(updateResult) + Number(insertResult)
    } catch (error) {
    console.error("[features] Error generating features:", (error as Error).message)
    return 0
  }
}

async function generateCandlesAndCleanupTrades(): Promise<void> {
  if (!ENABLE_CANDLE_GENERATION) return

  const startTime = Date.now()
  try {
    // Only process trades that are at least 1 minute old (complete minutes)
    const oneMinuteAgo = BigInt(Date.now() - 60 * 1000)
    
    // Generate candles using SQL aggregation (efficient batch processing)
    // This generates 1-minute candles for all tokens that have unprocessed trades
    // Using NOT EXISTS to prevent duplicates (no ON CONFLICT since constraint might not exist)
    const insertResult = await prisma.$executeRawUnsafe(`
      INSERT INTO pump_candles_1m (token_id, timestamp, open, high, low, close, volume_usd, volume_sol, trades)
      SELECT 
        token_id,
        DATE_TRUNC('minute', TO_TIMESTAMP(timestamp::bigint / 1000.0)) as timestamp,
        (array_agg(price_usd ORDER BY timestamp ASC))[1] as open,
        MAX(price_usd) as high,
        MIN(price_usd) as low,
        (array_agg(price_usd ORDER BY timestamp DESC))[1] as close,
        SUM(amount_usd) as volume_usd,
        SUM(amount_sol) as volume_sol,
        COUNT(*)::integer as trades
      FROM trades
      WHERE timestamp < ${oneMinuteAgo}
        AND NOT EXISTS (
          SELECT 1 FROM pump_candles_1m pc
          WHERE pc.token_id = trades.token_id
            AND pc.timestamp = DATE_TRUNC('minute', TO_TIMESTAMP(trades.timestamp::bigint / 1000.0))
        )
      GROUP BY token_id, DATE_TRUNC('minute', TO_TIMESTAMP(timestamp::bigint / 1000.0))
    `)

    const candlesGenerated = Number(insertResult)

    // Generate features for all candles that don't have features yet (non-blocking)
    // This includes both newly generated candles and any existing candles that need features
    let featuresGenerated = 0
    try {
      featuresGenerated = await generateFeaturesForCandles()
      } catch (error) {
      console.error("[features] Error (non-fatal):", (error as Error).message)
    }

    // Delete processed trades (no retention period - delete immediately)
    // Delete trades that have been processed into candles and are at least 1 minute old
    const deleteResult = await prisma.$executeRawUnsafe(`
      DELETE FROM trades
      WHERE timestamp < ${oneMinuteAgo}
        AND EXISTS (
          SELECT 1 FROM pump_candles_1m pc
          WHERE pc.token_id = trades.token_id
            AND pc.timestamp = DATE_TRUNC('minute', TO_TIMESTAMP(trades.timestamp::bigint / 1000.0))
        )
    `)

    const deletedCount = Number(deleteResult)
    const duration = Date.now() - startTime
    
    if (candlesGenerated > 0 || deletedCount > 0 || featuresGenerated > 0) {
      console.log(`[candles] Generated ${candlesGenerated} candles, ${featuresGenerated} features, deleted ${deletedCount} trades (${duration}ms)`)
    }
  } catch (error) {
    console.error("[candles] Error:", (error as Error).message)
  }
}

if (ENABLE_CANDLE_GENERATION) {
  console.log("[candles] Candle generation enabled - will process trades every minute")
  // Start after 2 minutes to let some trades accumulate
  setTimeout(() => void generateCandlesAndCleanupTrades(), 2 * 60 * 1000)
  // Run every minute
  setInterval(() => void generateCandlesAndCleanupTrades(), CANDLE_GENERATION_INTERVAL_MS)
}

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

      // Only log queue size every 30 seconds (throttled above)
      // Removed frequent queue logging

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
