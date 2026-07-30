import { PrismaClient, type TokenLifecycleStatus } from "@prisma/client"
import { Decimal } from "@prisma/client/runtime/library"
import WebSocket from "ws"
import {
  decodePumpPayload,
  type PumpUnifiedTrade,
  getIpfsGatewayUrls,
  normalizeIpfsUri,
} from "@/lib/pump-trades"
import { normalizeTokenMetadata, type TokenMetadata } from "@/lib/token-metadata"
import { fetchPumpCoin, PUMP_HEADERS, shouldSkipPumpCoinFetch } from "@/lib/pump-coin"
import { getDexPairCreatedAt } from "@/lib/dexscreener"
import { BoundedCache } from "@/lib/bounded-cache"
import {
  DEFAULT_LIFECYCLE_BATCH_SIZE,
  fetchPumpLifecycleBatch,
  fetchPumpLifecycleSingle,
  PumpLifecycleRequestError,
} from "@/lib/pump-lifecycle"
import {
  classifyPumpLifecycle,
  isCompletedLifecycle,
  lifecycleRetryDelayMs,
  reduceLifecycle,
} from "@/lib/token-lifecycle"

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

function parseEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const INGEST_RECONNECT_MIN_MS = parseEnvNumber("INGEST_RECONNECT_MIN_MS", 2_000)
const INGEST_RECONNECT_MAX_MS = parseEnvNumber("INGEST_RECONNECT_MAX_MS", 60_000)
const INGEST_CONNECT_TIMEOUT_MS = parseEnvNumber("INGEST_CONNECT_TIMEOUT_MS", 10_000)
const INGEST_PING_INTERVAL_MS = parseEnvNumber("INGEST_PING_INTERVAL_MS", 15_000)
const INGEST_STALE_AFTER_MS = parseEnvNumber("INGEST_STALE_AFTER_MS", 45_000)
const INGEST_BACKOFF_RESET_AFTER_MS = parseEnvNumber("INGEST_BACKOFF_RESET_AFTER_MS", 30_000)
const INGEST_PING_TIMEOUT_MS = 20_000
const INGEST_HEALTH_CHECK_INTERVAL_MS = Math.min(5_000, INGEST_PING_INTERVAL_MS)
const INGEST_HEALTH_LOG_INTERVAL_MS = 60_000
const INGEST_METADATA_BATCH_SIZE_NORMAL = parseEnvNumber("INGEST_METADATA_BATCH_SIZE_NORMAL", METADATA_RETRY_BATCH_SIZE)
const INGEST_METADATA_BATCH_SIZE_ELEVATED = parseEnvNumber(
  "INGEST_METADATA_BATCH_SIZE_ELEVATED",
  INGEST_METADATA_BATCH_SIZE_NORMAL * 2,
)
const INGEST_METADATA_ACTIVE_WINDOW_MS = parseEnvNumber("INGEST_METADATA_ACTIVE_WINDOW_MS", 30 * 60 * 1000)
const INGEST_METADATA_NOT_FOUND_COOLDOWN_MS = parseEnvNumber(
  "INGEST_METADATA_NOT_FOUND_COOLDOWN_MS",
  30 * 60 * 1000,
)
const INGEST_METADATA_TRANSIENT_COOLDOWN_MS = parseEnvNumber(
  "INGEST_METADATA_TRANSIENT_COOLDOWN_MS",
  2 * 60 * 1000,
)
const INGEST_METADATA_OVERLOAD_QUEUE_THRESHOLD = parseEnvNumber("INGEST_METADATA_OVERLOAD_QUEUE_THRESHOLD", 1000)
const INGEST_METADATA_ELEVATED_QUEUE_THRESHOLD = Math.max(
  INGEST_METADATA_BATCH_SIZE_NORMAL * 4,
  Math.floor(INGEST_METADATA_OVERLOAD_QUEUE_THRESHOLD / 2),
)
const INGEST_METADATA_INACTIVE_EXPIRY_MS = Math.max(INGEST_METADATA_ACTIVE_WINDOW_MS * 12, 6 * 60 * 60 * 1000)
const LIFECYCLE_VERIFIER_ENABLED = process.env.LIFECYCLE_VERIFIER_ENABLED !== "false"
const LIFECYCLE_BATCH_SIZE = parseEnvNumber("LIFECYCLE_BATCH_SIZE", DEFAULT_LIFECYCLE_BATCH_SIZE)
const LIFECYCLE_ACTIVE_RECHECK_MS = parseEnvNumber("LIFECYCLE_ACTIVE_RECHECK_MS", 60_000)
const LIFECYCLE_FULL_RECHECK_MS = parseEnvNumber("LIFECYCLE_FULL_RECHECK_MS", 15 * 60_000)

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

type ConnectionState = "idle" | "connecting" | "connected" | "reconnect_wait" | "shutting_down"

let ws: WebSocket | null = null
let reconnectTimer: NodeJS.Timeout | null = null
let connectTimeoutTimer: NodeJS.Timeout | null = null
let heartbeatTimer: NodeJS.Timeout | null = null
let backoffResetTimer: NodeJS.Timeout | null = null
let messageBuffer = ""
let connectionState: ConnectionState = "idle"
let connectionAttempt = 0
let activeConnectionId = 0
let reconnectAttemptCount = 0
let lastConnectStartedAt = 0
let lastConnectedAt = 0
let lastMessageAt = 0
let lastPingSentAt = 0
let lastPongAt = 0
let lastDisconnectAt = 0

// SOL price cache
let solPriceCache = { value: 160, updatedAt: 0 }

// Token ID cache (mint -> id) - avoids repeated SELECT queries
const tokenIdCache = new BoundedCache<string, string>(100_000, 24 * 60 * 60 * 1000)

// Metadata caches
const metadataCache = new BoundedCache<string, unknown>(5_000, 10 * 60 * 1000)
const metadataRetryQueue = new Map<string, MetadataRetryState>()
let isProcessingMetadataQueue = false
let lastMetadataRequestAt = 0
let metadataDynamicDelayMs = 0
let latestTradeSeenTimestampMs = 0
let latestTradePersistedTimestampMs = 0
let tokenRevisionDirty = false
let lifecycleWorkerRunning = false
const metadataStats = {
  success: 0,
  timeout: 0,
  failed: 0,
  cooldownSkips: 0,
}

// =============================================================================
// Utilities
// =============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function clearTimer(timer: NodeJS.Timeout | null): null {
  if (timer) clearTimeout(timer)
  return null
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
// Pump lifecycle verification
// =============================================================================

interface LifecycleCheckRequest {
  tokenId: string
  reason: string
  priority: number
}

async function enqueueLifecycleChecks(requests: LifecycleCheckRequest[]): Promise<void> {
  if (!LIFECYCLE_VERIFIER_ENABLED || requests.length === 0) return
  const deduplicated = new Map<string, LifecycleCheckRequest>()
  for (const request of requests) {
    const current = deduplicated.get(request.tokenId)
    if (!current || request.priority > current.priority) deduplicated.set(request.tokenId, request)
  }
  const values = Array.from(deduplicated.values())
    .map(
      (request) =>
        `(${escapeSQL(request.tokenId)},NOW(),NOW(),0,${request.priority},${escapeSQL(request.reason)},NOW())`,
    )
    .join(",")
  await prisma.$executeRawUnsafe(`
    INSERT INTO token_lifecycle_checks
      (token_id,requested_at,next_attempt_at,attempts,priority,reason,updated_at)
    VALUES ${values}
    ON CONFLICT (token_id) DO UPDATE SET
      requested_at = NOW(),
      next_attempt_at = LEAST(token_lifecycle_checks.next_attempt_at, NOW()),
      priority = GREATEST(token_lifecycle_checks.priority, EXCLUDED.priority),
      reason = EXCLUDED.reason,
      updated_at = NOW()
  `)
}

async function enqueueLifecycleChecksByQuery(mode: "all" | "active"): Promise<void> {
  if (!LIFECYCLE_VERIFIER_ENABLED) return
  const activeCutoff = BigInt(Date.now() - 60 * 60 * 1000)
  if (mode === "active") {
    await prisma.$executeRawUnsafe(`
      INSERT INTO token_lifecycle_checks
        (token_id,requested_at,next_attempt_at,attempts,priority,reason,updated_at)
      SELECT DISTINCT t.id,NOW(),NOW(),0,40,'active_recheck',NOW()
      FROM tokens t
      JOIN trades tr ON tr.token_id=t.id AND tr.timestamp >= ${activeCutoff}
      WHERE t.lifecycle_status IN ('UNKNOWN','BONDING')
      ON CONFLICT (token_id) DO UPDATE SET
        requested_at=NOW(),
        next_attempt_at=LEAST(token_lifecycle_checks.next_attempt_at,NOW()),
        priority=GREATEST(token_lifecycle_checks.priority,40),
        reason='active_recheck',
        updated_at=NOW()
    `)
    return
  }

  await prisma.$executeRawUnsafe(`
    INSERT INTO token_lifecycle_checks
      (token_id,requested_at,next_attempt_at,attempts,priority,reason,updated_at)
    SELECT t.id,NOW(),NOW(),0,10,'full_recheck',NOW()
    FROM tokens t
    WHERE t.lifecycle_status IN ('UNKNOWN','BONDING','CURVE_COMPLETE')
    ON CONFLICT (token_id) DO UPDATE SET
      requested_at=NOW(),
      next_attempt_at=LEAST(token_lifecycle_checks.next_attempt_at,NOW()),
      priority=GREATEST(token_lifecycle_checks.priority,10),
      reason='full_recheck',
      updated_at=NOW()
  `)
}

async function rescheduleLifecycleCheck(
  tokenId: string,
  attempts: number,
  error: string,
  explicitDelayMs?: number | null,
): Promise<void> {
  const delayMs = explicitDelayMs ?? lifecycleRetryDelayMs(attempts)
  await prisma.tokenLifecycleCheck.update({
    where: { tokenId },
    data: {
      attempts,
      lastError: error.slice(0, 500),
      nextAttemptAt: new Date(Date.now() + delayMs),
      priority: Math.max(0, 100 - attempts),
    },
  })
}

async function applyVerifiedLifecycle(
  check: Awaited<ReturnType<typeof getLifecycleChecks>>[number],
  payload: Record<string, unknown>,
): Promise<boolean> {
  const verified = classifyPumpLifecycle(payload)
  if (!verified) {
    await rescheduleLifecycleCheck(check.tokenId, check.attempts + 1, "unclassifiable Pump response")
    return false
  }

  const transition = reduceLifecycle(check.token.lifecycleStatus, verified)
  const now = new Date()
  if (transition.conflict) {
    console.warn(
      `[lifecycle] event=conflict mint=${check.token.mintAddress} current=${check.token.lifecycleStatus} observed=${verified.status}`,
    )
  }

  await prisma.$transaction([
    prisma.token.update({
      where: { id: check.tokenId },
      data: {
        lifecycleStatus: transition.next,
        lifecycleVerifiedAt: now,
        completed: isCompletedLifecycle(transition.next),
        pumpSwapPool: verified.pumpSwapPool ?? check.token.pumpSwapPool,
        graduatedAt:
          isCompletedLifecycle(transition.next) && !check.token.graduatedAt
            ? now
            : check.token.graduatedAt,
        bondingCurve: verified.bondingCurve ?? check.token.bondingCurve,
        associatedBondingCurve:
          verified.associatedBondingCurve ?? check.token.associatedBondingCurve,
      },
    }),
    prisma.tokenLifecycleCheck.delete({ where: { tokenId: check.tokenId } }),
  ])
  tokenRevisionDirty = true
  return true
}

async function getLifecycleChecks() {
  return prisma.tokenLifecycleCheck.findMany({
    where: { nextAttemptAt: { lte: new Date() } },
    orderBy: [{ priority: "desc" }, { requestedAt: "asc" }],
    take: LIFECYCLE_BATCH_SIZE,
    include: {
      token: {
        select: {
          mintAddress: true,
          lifecycleStatus: true,
          pumpSwapPool: true,
          graduatedAt: true,
          bondingCurve: true,
          associatedBondingCurve: true,
        },
      },
    },
  })
}

async function processLifecycleChecks(): Promise<void> {
  if (!LIFECYCLE_VERIFIER_ENABLED || lifecycleWorkerRunning) return
  lifecycleWorkerRunning = true
  let checks: Awaited<ReturnType<typeof getLifecycleChecks>> = []
  try {
    checks = await getLifecycleChecks()
    if (checks.length === 0) return
    const payloads = await fetchPumpLifecycleBatch(checks.map((check) => check.token.mintAddress))
    const byMint = new Map<string, Record<string, unknown>>()
    for (const payload of payloads) {
      if (typeof payload.mint === "string") byMint.set(payload.mint, payload as Record<string, unknown>)
    }

    let singleFallbackUsed = false
    let verifiedCount = 0
    for (const check of checks) {
      let payload = byMint.get(check.token.mintAddress)
      if (!payload && check.attempts >= 2 && !singleFallbackUsed) {
        singleFallbackUsed = true
        const single = await fetchPumpLifecycleSingle(check.token.mintAddress)
        if (single) payload = single as Record<string, unknown>
      }
      if (!payload) {
        await rescheduleLifecycleCheck(
          check.tokenId,
          check.attempts + 1,
          "mint missing from Pump lifecycle response",
        )
        continue
      }
      if (await applyVerifiedLifecycle(check, payload)) verifiedCount += 1
    }
    console.log(
      `[lifecycle] event=batch checked=${checks.length} verified=${verifiedCount} missing=${checks.length - verifiedCount}`,
    )
  } catch (error) {
    const message = (error as Error).message
    const retryAfterMs = error instanceof PumpLifecycleRequestError ? error.retryAfterMs : null
    console.warn(`[lifecycle] event=batch_failed checked=${checks.length} message=${JSON.stringify(message)}`)
    await Promise.all(
      checks.map((check) =>
        rescheduleLifecycleCheck(check.tokenId, check.attempts + 1, message, retryAfterMs).catch(() => undefined),
      ),
    )
  } finally {
    lifecycleWorkerRunning = false
  }
}

async function flushTokenRevision(): Promise<void> {
  if (!tokenRevisionDirty) return
  tokenRevisionDirty = false
  try {
    await prisma.tokenDataRevision.upsert({
      where: { key: "tokens" },
      create: { key: "tokens", revision: BigInt(1) },
      update: { revision: { increment: BigInt(1) } },
    })
  } catch (error) {
    tokenRevisionDirty = true
    console.warn("[revision] Failed to advance token revision:", (error as Error).message)
  }
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
  program: string
  isBondingCurve: boolean | null
  poolAddress: string | null
  kingOfTheHillTimestamp: number | null
  raw: PumpUnifiedTrade | null // Store full raw payload including marketCap
}

interface MetadataRetryState {
  mint: string
  attempts: number
  firstSeenAt: number
  lastAttemptAt: number
  lastSuccessAt: number
  lastTradeAt: number
  nextEligibleAt: number
  missingCritical: boolean
}

type MetadataRefreshResult = "success" | "retry" | "cooldown"

interface MetadataProcessingResult {
  mint: string
  result: MetadataRefreshResult
  timeout: boolean
  elapsed: number
  error?: string
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
  latestTradeSeenTimestampMs = Math.max(latestTradeSeenTimestampMs, timestampMs)

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
  
  // KOTH is a milestone during bonding (about halfway), not graduation
  // We'll determine KOTH separately - for now, we don't set it from trade data
  // KOTH timestamp should come from metadata or be calculated separately
  const kingOfTheHillTimestamp: number | null = null

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
    program,
    isBondingCurve: typeof trade.isBondingCurve === "boolean" ? trade.isBondingCurve : null,
    poolAddress: firstString(trade.poolAddress) ?? null,
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
          return `(${escapeSQL(id)},${escapeSQL(t.mint)},${escapeSQL(t.symbol.slice(0, 50))},${escapeSQL(t.name.slice(0, 200))},${escapeSQL(t.imageUri)},${escapeSQL(t.metadataUri)},${escapeSQL(t.twitter)},${escapeSQL(t.telegram)},${escapeSQL(t.website)},${escapeSQL(t.description?.slice(0, 1000) ?? null)},${escapeSQL(t.creatorAddress)},${t.createdTs},${t.kingOfTheHillTimestamp ? t.kingOfTheHillTimestamp : "NULL"},false,'UNKNOWN',${escapeSQL(t.bondingCurve)},${escapeSQL(t.associatedBondingCurve)},NOW())`
        })
        .join(",")

      // INSERT new tokens, update existing if bonding status changed (only if we have values)
      if (tokenValues.length > 0) {
        try {
          await prisma.$executeRawUnsafe(`
            INSERT INTO tokens (id,mint_address,symbol,name,image_uri,metadata_uri,twitter,telegram,website,description,creator_address,created_timestamp,king_of_the_hill_timestamp,completed,lifecycle_status,bonding_curve,associated_bonding_curve,updated_at)
            VALUES ${tokenValues}
            ON CONFLICT (mint_address) DO UPDATE SET
              bonding_curve = EXCLUDED.bonding_curve,
              associated_bonding_curve = EXCLUDED.associated_bonding_curve,
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

      // Warm the ID cache for newly inserted tokens.
      const insertedMints = uncachedTokens.map((t) => t.mint)
      const insertedRows = await prisma.token.findMany({
        where: { mintAddress: { in: insertedMints } },
        select: { id: true, mintAddress: true },
      })
      for (const row of insertedRows) {
        mintToId.set(row.mintAddress, row.id)
        tokenIdCache.set(row.mintAddress, row.id)
      }
    }

    // Query token metadata state for all unique mints in this batch so active
    // tokens that are still missing metadata keep getting re-prioritized.
    const batchMints = uniqueTokens.map((t) => t.mint)
    const tokenRows = await prisma.token.findMany({
      where: { mintAddress: { in: batchMints } },
      select: { id: true, mintAddress: true, metadataUri: true, imageUri: true },
    })

    const tokenRowsByMint = new Map(tokenRows.map((row) => [row.mintAddress, row]))
    for (const row of tokenRows) {
      mintToId.set(row.mintAddress, row.id)
      tokenIdCache.set(row.mintAddress, row.id)
    }

    for (const t of uniqueTokens) {
      const token = tokenRowsByMint.get(t.mint)
      if (!token || !token.metadataUri || !token.imageUri) {
        scheduleMetadataRetry(t.mint, {
          lastTradeAt: t.timestampMs,
          missingCritical: !token || (!token.metadataUri && !token.imageUri),
        })
      }
    }

    // Step 2: Run price and trade inserts in PARALLEL for speed
    const priceTokens = uniqueTokens.filter((t) => mintToId.has(t.mint))
    const validTrades = trades.filter((t) => mintToId.has(t.mint))

    const parallelOps: Promise<unknown>[] = []
    const enableMarketCapHistory =
      process.env.ENABLE_MARKET_CAP_HISTORY === "true" ||
      process.env.ENABLE_MARKET_CAP_HISTORY === "1"

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
            WHERE token_prices.last_trade_timestamp <= EXCLUDED.last_trade_timestamp
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

    // Optional market cap history insert (store time series of market cap per trade)
    if (enableMarketCapHistory && validTrades.length > 0) {
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

    if (LIFECYCLE_VERIFIER_ENABLED) {
      const newMintSet = new Set(uncachedTokens.map((token) => token.mint))
      const lifecycleRequests = uniqueTokens
        .map((token) => {
          const tokenId = mintToId.get(token.mint)
          if (!tokenId) return null
          const highPriority =
            token.program === "pump_amm" || token.isBondingCurve === false || Boolean(token.poolAddress)
          if (!newMintSet.has(token.mint) && !highPriority) return null
          return {
            tokenId,
            reason: highPriority ? "trade_graduation_hint" : "new_token",
            priority: highPriority ? 100 : 20,
          }
        })
        .filter((request): request is { tokenId: string; reason: string; priority: number } => request !== null)
      await enqueueLifecycleChecks(lifecycleRequests)
    }

    tokenRevisionDirty = true

    const duration = Date.now() - startTime
    const rate = trades.length / (duration / 1000)
    latestTradePersistedTimestampMs = Math.max(
      latestTradePersistedTimestampMs,
      ...trades.map((trade) => trade.timestampMs),
    )
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

function getMetadataQueueMode(): "normal" | "elevated" | "overload" {
  const size = metadataRetryQueue.size
  if (size >= INGEST_METADATA_OVERLOAD_QUEUE_THRESHOLD) return "overload"
  if (size >= INGEST_METADATA_ELEVATED_QUEUE_THRESHOLD) return "elevated"
  return "normal"
}

function getMetadataBatchSize(): number {
  const mode = getMetadataQueueMode()
  if (mode === "normal") return INGEST_METADATA_BATCH_SIZE_NORMAL
  return INGEST_METADATA_BATCH_SIZE_ELEVATED
}

function isMetadataEntryActive(entry: MetadataRetryState, now = Date.now()): boolean {
  return now - entry.lastTradeAt <= INGEST_METADATA_ACTIVE_WINDOW_MS
}

function computeMetadataRetryDelayMs(attempts: number, isActive: boolean): number {
  const base = isActive ? 5_000 : 30_000
  const cap = isActive ? 5 * 60 * 1000 : 15 * 60 * 1000
  return Math.min(cap, base * Math.pow(2, Math.max(0, attempts - 1)))
}

function scheduleMetadataRetry(
  mint: string,
  options: { lastTradeAt?: number; missingCritical?: boolean; forceAt?: number } = {},
): void {
  if (!mint || !isValidSolanaAddress(mint)) return

  const now = Date.now()
  const existing = metadataRetryQueue.get(mint)
  const hadNewTrade =
    options.lastTradeAt !== undefined && options.lastTradeAt > (existing?.lastTradeAt ?? 0)
  const nextEligibleAt =
    options.forceAt ??
    (existing
      ? hadNewTrade
        ? Math.min(existing.nextEligibleAt, now + 1_000)
        : existing.nextEligibleAt
      : now)

  metadataRetryQueue.set(mint, {
    mint,
    attempts: existing?.attempts ?? 0,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastAttemptAt: existing?.lastAttemptAt ?? 0,
    lastSuccessAt: existing?.lastSuccessAt ?? 0,
    lastTradeAt: Math.max(existing?.lastTradeAt ?? 0, options.lastTradeAt ?? now),
    nextEligibleAt,
    missingCritical: existing?.missingCritical || options.missingCritical || false,
  })
}

function getMetadataQueueSnapshot(): MetadataRetryState[] {
  const now = Date.now()
  const mode = getMetadataQueueMode()
  const eligible = Array.from(metadataRetryQueue.values()).filter((entry) => entry.nextEligibleAt <= now)
  const activeOnly = eligible.filter((entry) => isMetadataEntryActive(entry, now))
  const candidates = mode === "overload" && activeOnly.length > 0 ? activeOnly : eligible

  candidates.sort((a, b) => {
    if (a.missingCritical !== b.missingCritical) return a.missingCritical ? -1 : 1
    const aActive = isMetadataEntryActive(a, now)
    const bActive = isMetadataEntryActive(b, now)
    if (aActive !== bActive) return aActive ? -1 : 1
    if (a.lastTradeAt !== b.lastTradeAt) return b.lastTradeAt - a.lastTradeAt
    if (a.attempts !== b.attempts) return a.attempts - b.attempts
    return a.firstSeenAt - b.firstSeenAt
  })

  return candidates.slice(0, getMetadataBatchSize())
}

function getMetadataQueueMetrics() {
  const now = Date.now()
  const entries = Array.from(metadataRetryQueue.values())
  const activeEntries = entries.filter((entry) => isMetadataEntryActive(entry, now))
  const oldestWaitMs =
    entries.length > 0 ? now - Math.min(...entries.map((entry) => entry.firstSeenAt)) : 0

  return {
    queueSize: entries.length,
    oldestWaitMs,
    activeRecentMissingCount: activeEntries.length,
    successRate:
      metadataStats.success + metadataStats.failed + metadataStats.timeout > 0
        ? metadataStats.success /
          (metadataStats.success + metadataStats.failed + metadataStats.timeout)
        : 1,
    timeoutRate:
      metadataStats.success + metadataStats.failed + metadataStats.timeout > 0
        ? metadataStats.timeout /
          (metadataStats.success + metadataStats.failed + metadataStats.timeout)
        : 0,
    cooldownSkips: metadataStats.cooldownSkips,
  }
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

function mergeMetadata(base: TokenMetadata, next: TokenMetadata): TokenMetadata {
  const merged = { ...base }
  for (const [key, value] of Object.entries(next) as [keyof TokenMetadata, TokenMetadata[keyof TokenMetadata]][]) {
    if (value !== null && value !== undefined && value !== "") {
      Object.assign(merged, { [key]: value })
    }
  }
  return merged
}

async function refreshTokenMetadata(mint: string): Promise<MetadataRefreshResult> {
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
        lifecycleStatus: true,
        createdTimestamp: true,
      },
    })

    if (!token) return "success"

    const shouldFetchMetadata = !token.metadataUri || !token.imageUri

    if (!shouldFetchMetadata) {
      return "success"
    }

    let metadataUri = token.metadataUri
    let metadata = normalizeTokenMetadata({})

    // Most trade events already provide a metadata URI. Resolve it directly
    // before spending another Pump API request on the same token.
    if (metadataUri) {
      const storedRemoteData = await fetchMetadataFromUri(metadataUri)
      if (storedRemoteData && typeof storedRemoteData === "object") {
        metadata = normalizeTokenMetadata(storedRemoteData as Record<string, unknown>)
      }
    }

    if (!metadata.image) {
      if (shouldSkipPumpCoinFetch(mint)) {
        return "cooldown"
      }

      const coinInfo = await fetchPumpCoin(mint)
      if (!coinInfo) {
        return "retry"
      }

      const coinRecord = coinInfo as Record<string, unknown>
      const rawUri = firstString(coinRecord.metadataUri, coinRecord.metadata_uri, coinRecord.uri)
      metadataUri = metadataUri ?? (rawUri ? normalizeIpfsUri(rawUri) : null)
      metadata = mergeMetadata(
        metadata,
        normalizeTokenMetadata((coinRecord.metadata as Record<string, unknown>) ?? coinRecord),
      )

      if (rawUri) {
        const remoteData = await fetchMetadataFromUri(rawUri)
        if (remoteData && typeof remoteData === "object") {
          metadata = mergeMetadata(
            metadata,
            normalizeTokenMetadata(remoteData as Record<string, unknown>),
          )
        }
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

    if (isCompletedLifecycle(token.lifecycleStatus)) {
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
      tokenRevisionDirty = true
    }

    // Only return true if we now have both metadataUri and imageUri (or already had both)
    // This prevents re-seeding tokens that legitimately don't have metadata available
    const updatedToken = await prisma.token.findUnique({
      where: { id: token.id },
      select: { metadataUri: true, imageUri: true },
    })
    if (updatedToken && updatedToken.metadataUri && updatedToken.imageUri) {
      return "success"
    }

    return "retry"
  } catch (error) {
    console.warn(`[metadata] Failed ${mint}:`, (error as Error).message)
    return "retry"
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
    const batch = getMetadataQueueSnapshot()
    if (batch.length === 0) {
      return
    }

    const promises = batch.map(async (entry): Promise<MetadataProcessingResult> => {
      const tokenStartTime = Date.now()
      entry.lastAttemptAt = tokenStartTime
      entry.attempts += 1
      
      try {
        const timeoutPromise = new Promise<MetadataRefreshResult>((resolve) => {
          setTimeout(() => {
            resolve("retry")
          }, METADATA_RETRY_TIMEOUT_MS)
        })

        const metadataPromise = refreshTokenMetadata(entry.mint).catch(() => "retry" as const)
        const result = await Promise.race([metadataPromise, timeoutPromise])

        const tokenElapsed = Date.now() - tokenStartTime

        if (tokenElapsed >= METADATA_RETRY_TIMEOUT_MS) {
          return { mint: entry.mint, result: "retry", timeout: true, elapsed: tokenElapsed }
        }

        return { mint: entry.mint, result, timeout: false, elapsed: tokenElapsed }
      } catch (error) {
        const tokenElapsed = Date.now() - tokenStartTime
        return { mint: entry.mint, result: "retry", timeout: false, elapsed: tokenElapsed, error: (error as Error).message }
      }
    })

    const results = await Promise.all(promises)

    let successCount = 0
    let timeoutCount = 0
    let failedCount = 0
    let cooldownCount = 0
    const now = Date.now()

    for (const result of results) {
      const entry = metadataRetryQueue.get(result.mint)
      if (!entry) {
        continue
      }

      if (result.result === "success") {
        successCount++
        metadataStats.success++
        entry.lastSuccessAt = now
        metadataRetryQueue.delete(result.mint)
      } else if (result.timeout) {
        timeoutCount++
        metadataStats.timeout++
        const active = isMetadataEntryActive(entry, now)
        entry.nextEligibleAt = now + computeMetadataRetryDelayMs(entry.attempts, active)
      } else if (result.result === "cooldown") {
        cooldownCount++
        metadataStats.cooldownSkips++
        entry.nextEligibleAt = now + Math.min(INGEST_METADATA_TRANSIENT_COOLDOWN_MS, 60_000)
      } else {
        failedCount++
        metadataStats.failed++
        if (result.error) {
          console.warn(`[metadata] ❌ Error processing ${result.mint.slice(0, 8)}...:`, result.error)
        }
        const active = isMetadataEntryActive(entry, now)
        const isExpired =
          !active &&
          now - entry.firstSeenAt >= INGEST_METADATA_INACTIVE_EXPIRY_MS &&
          now - entry.lastTradeAt >= INGEST_METADATA_ACTIVE_WINDOW_MS

        if (isExpired) {
          metadataRetryQueue.delete(result.mint)
        } else {
          entry.nextEligibleAt = now + computeMetadataRetryDelayMs(entry.attempts, active)
        }
      }
    }

    const batchElapsed = Date.now() - batchStartTime
    console.log(
      `[metadata] Batch complete: ${batch.length} processed (${successCount} ok, ${timeoutCount} timeout, ${failedCount} failed, ${cooldownCount} cooldown) | Queue: ${metadataRetryQueue.size} | Time: ${batchElapsed}ms | Mode: ${getMetadataQueueMode()}`
    )

  } catch (error) {
    console.error(`[metadata] ❌ Error in processMetadataRetryQueue:`, (error as Error).message)
  } finally {
    isProcessingMetadataQueue = false
    if (metadataRetryQueue.size >= INGEST_METADATA_ELEVATED_QUEUE_THRESHOLD) {
      setTimeout(() => void processMetadataRetryQueue(), 250)
    }
  }
}

function logMetadataQueueHealth(): void {
  const metrics = getMetadataQueueMetrics()
  console.log(
    `[metadata] event=health queue_size=${metrics.queueSize} oldest_wait_ms=${metrics.oldestWaitMs} active_recent_missing=${metrics.activeRecentMissingCount} success_rate=${metrics.successRate.toFixed(2)} timeout_rate=${metrics.timeoutRate.toFixed(2)} cooldown_skips=${metrics.cooldownSkips} newest_trade_seen_ms=${latestTradeSeenTimestampMs} newest_trade_persisted_ms=${latestTradePersistedTimestampMs}`
  )

  if (
    metrics.queueSize >= INGEST_METADATA_OVERLOAD_QUEUE_THRESHOLD ||
    metrics.oldestWaitMs >= INGEST_METADATA_ACTIVE_WINDOW_MS ||
    metrics.successRate < 0.5
  ) {
    console.warn(
      `[metadata] event=overload_warning queue_size=${metrics.queueSize} oldest_wait_ms=${metrics.oldestWaitMs} success_rate=${metrics.successRate.toFixed(2)}`
    )
  }
}

setInterval(() => {
  if (metadataRetryQueue.size > 0 && !isProcessingMetadataQueue) {
    void processMetadataRetryQueue()
  }
}, METADATA_RETRY_INTERVAL_MS)

setInterval(() => {
  if (metadataRetryQueue.size > 0) {
    logMetadataQueueHealth()
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

setInterval(() => void flushTokenRevision(), 1_000)

if (LIFECYCLE_VERIFIER_ENABLED) {
  setTimeout(() => {
    void enqueueLifecycleChecksByQuery("all")
      .then(() => processLifecycleChecks())
      .catch((error) => console.warn("[lifecycle] Initial backfill enqueue failed:", (error as Error).message))
  }, 2_000)
  setInterval(() => void processLifecycleChecks(), 2_200)
  setInterval(
    () =>
      void enqueueLifecycleChecksByQuery("active").catch((error) =>
        console.warn("[lifecycle] Active reconciliation enqueue failed:", (error as Error).message),
      ),
    LIFECYCLE_ACTIVE_RECHECK_MS,
  )
  setInterval(
    () =>
      void enqueueLifecycleChecksByQuery("all").catch((error) =>
        console.warn("[lifecycle] Full reconciliation enqueue failed:", (error as Error).message),
      ),
    LIFECYCLE_FULL_RECHECK_MS,
  )
}

// =============================================================================
// Seed Metadata Queue on Startup
// =============================================================================

async function seedMetadataRetryQueue(): Promise<void> {
  try {
    const activeCutoff = BigInt(Date.now() - INGEST_METADATA_ACTIVE_WINDOW_MS)

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

    // Count tokens traded during the configured active window that are missing metadata.
    const activeMissing = await prisma.token.count({
      where: {
        OR: [
          { metadataUri: null, imageUri: null },
          { metadataUri: null },
          { imageUri: null },
        ],
        price: {
          lastTradeTimestamp: {
            gte: activeCutoff,
          },
        },
      },
    })

    // Seed active tokens from before and after this process start. Using the
    // service start timestamp here leaves the entire existing backlog stranded.
    // Process in batches to avoid memory issues and stop if queue gets too large
    const batchSize = 5000
    let totalSeeded = 0
    let totalInvalid = 0
    let offset = 0
    let hasMore = true

    while (hasMore && metadataRetryQueue.size < INGEST_METADATA_OVERLOAD_QUEUE_THRESHOLD * 2) {
      const candidates = await prisma.token.findMany({
        where: {
          OR: [
            { metadataUri: null, imageUri: null },
            { metadataUri: null },
            { imageUri: null },
          ],
          price: {
            lastTradeTimestamp: {
              gte: activeCutoff,
            },
          },
        },
        select: { mintAddress: true, price: { select: { lastTradeTimestamp: true } } },
        orderBy: {
          price: {
            lastTradeTimestamp: "desc",
          },
        },
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
          scheduleMetadataRetry(token.mintAddress, {
            lastTradeAt: Number(token.price?.lastTradeTimestamp ?? Date.now()),
            missingCritical: true,
          })
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

function isActiveConnection(connectionId: number): boolean {
  return activeConnectionId === connectionId
}

function clearReconnectTimer(log = false): void {
  if (!reconnectTimer) return
  reconnectTimer = clearTimer(reconnectTimer)
  if (log) {
    console.log("[ingest] event=reconnect_cancelled")
  }
}

function clearConnectionTimers(): void {
  connectTimeoutTimer = clearTimer(connectTimeoutTimer)
  heartbeatTimer = clearTimer(heartbeatTimer)
  backoffResetTimer = clearTimer(backoffResetTimer)
}

function disposeCurrentSocket(reason: string, connectionId?: number): void {
  if (connectionId !== undefined && !isActiveConnection(connectionId)) return

  clearConnectionTimers()

  const socket = ws
  if (socket) {
    ws = null
    socket.removeAllListeners()

    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      try {
        socket.close()
      } catch {
        // Ignore close errors during forced teardown.
      }
    }
  }

  messageBuffer = ""
  console.log(`[ingest] event=socket_disposed reason=${JSON.stringify(reason)}`)
}

function scheduleBackoffReset(connectionId: number): void {
  backoffResetTimer = clearTimer(backoffResetTimer)
  backoffResetTimer = setTimeout(() => {
    if (!isActiveConnection(connectionId) || connectionState !== "connected") return
    reconnectAttemptCount = 0
    console.log("[ingest] event=backoff_reset")
  }, INGEST_BACKOFF_RESET_AFTER_MS)
}

function getReconnectDelayMs(attemptNumber: number): number {
  const baseDelay = Math.min(
    INGEST_RECONNECT_MAX_MS,
    INGEST_RECONNECT_MIN_MS * Math.pow(2, Math.max(0, attemptNumber - 1))
  )
  const jitterMultiplier = 1 + (Math.random() * 0.4 - 0.2)
  return Math.max(INGEST_RECONNECT_MIN_MS, Math.round(baseDelay * jitterMultiplier))
}

function scheduleReconnect(reason: string): void {
  if (connectionState === "shutting_down") return
  if (reconnectTimer) return

  disposeCurrentSocket(reason)
  connectionState = "reconnect_wait"
  reconnectAttemptCount += 1
  const delayMs = getReconnectDelayMs(reconnectAttemptCount)

  console.warn(
    `[ingest] event=reconnect_scheduled reason=${JSON.stringify(reason)} attempt=${reconnectAttemptCount} delay_ms=${delayMs}`
  )

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    startConnectionAttempt("reconnect", delayMs)
  }, delayMs)
}

function handleStaleConnection(reason: string, connectionId: number): void {
  if (!isActiveConnection(connectionId) || connectionState === "shutting_down") return
  console.warn(`[ingest] event=heartbeat_stale reason=${JSON.stringify(reason)} connection_id=${connectionId}`)
  scheduleReconnect(reason)
}

function checkConnectionHealth(connectionId: number): void {
  if (!isActiveConnection(connectionId) || connectionState !== "connected") return

  const socket = ws
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    handleStaleConnection("socket_not_open", connectionId)
    return
  }

  const now = Date.now()
  if (lastMessageAt > 0 && now - lastMessageAt >= INGEST_STALE_AFTER_MS) {
    handleStaleConnection("inbound_idle_timeout", connectionId)
    return
  }

  if (lastPingSentAt > lastMessageAt && now - lastPingSentAt >= INGEST_PING_TIMEOUT_MS) {
    handleStaleConnection("ping_timeout", connectionId)
    return
  }

  const lastActivityAt = Math.max(lastConnectedAt, lastMessageAt, lastPingSentAt)
  if (now - lastActivityAt >= INGEST_PING_INTERVAL_MS) {
    try {
      socket.send("PING\r\n")
      lastPingSentAt = now
      console.log(`[ingest] event=heartbeat_ping connection_id=${connectionId}`)
    } catch (error) {
      handleStaleConnection(`ping_send_failed:${(error as Error).message}`, connectionId)
    }
  }
}

function startHeartbeat(connectionId: number): void {
  heartbeatTimer = clearTimer(heartbeatTimer)
  heartbeatTimer = setInterval(() => {
    checkConnectionHealth(connectionId)
  }, INGEST_HEALTH_CHECK_INTERVAL_MS)
}

function handleMessageChunk(chunk: string, connectionId: number, socket: WebSocket): void {
  if (!isActiveConnection(connectionId) || socket !== ws) return

  messageBuffer += chunk
  lastMessageAt = Date.now()

  while (messageBuffer.length > 0) {
    if (messageBuffer.startsWith("PING")) {
      try {
        socket.send("PONG\r\n")
      } catch (error) {
        handleStaleConnection(`pong_send_failed:${(error as Error).message}`, connectionId)
        return
      }
      const newline = messageBuffer.indexOf("\r\n")
      messageBuffer = newline === -1 ? "" : messageBuffer.slice(newline + 2)
      continue
    }

    if (messageBuffer.startsWith("PONG")) {
      lastPongAt = Date.now()
      const newline = messageBuffer.indexOf("\r\n")
      if (newline === -1) return
      messageBuffer = messageBuffer.slice(newline + 2)
      continue
    }

    if (messageBuffer.startsWith("+OK") || messageBuffer.startsWith("INFO")) {
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

function startConnectionAttempt(trigger: string, scheduledDelayMs = 0): void {
  if (connectionState === "shutting_down") return

  clearReconnectTimer(scheduledDelayMs > 0)
  disposeCurrentSocket(`before_connect:${trigger}`)

  connectionAttempt += 1
  activeConnectionId += 1
  connectionState = "connecting"
  lastConnectStartedAt = Date.now()
  messageBuffer = ""

  const connectionId = activeConnectionId
  const socket = new WebSocket(NATS_URL, { headers: NATS_HEADERS })
  ws = socket

  console.log(
    `[ingest] event=connect_start trigger=${trigger} connection_id=${connectionId} attempt=${connectionAttempt} reconnect_attempt=${reconnectAttemptCount} delay_ms=${scheduledDelayMs}`
  )

  connectTimeoutTimer = clearTimer(connectTimeoutTimer)
  connectTimeoutTimer = setTimeout(() => {
    if (!isActiveConnection(connectionId) || connectionState !== "connecting") return
    console.warn(
      `[ingest] event=connect_timeout connection_id=${connectionId} timeout_ms=${INGEST_CONNECT_TIMEOUT_MS}`
    )
    scheduleReconnect("connect_timeout")
  }, INGEST_CONNECT_TIMEOUT_MS)

  socket.once("open", () => {
    if (!isActiveConnection(connectionId) || socket !== ws) return

    connectTimeoutTimer = clearTimer(connectTimeoutTimer)
    connectionState = "connected"
    lastConnectedAt = Date.now()
    lastMessageAt = lastConnectedAt
    lastPingSentAt = 0
    lastPongAt = lastConnectedAt
    messageBuffer = ""
    clearReconnectTimer(true)
    scheduleBackoffReset(connectionId)
    startHeartbeat(connectionId)

    console.log(`[ingest] event=connect_open connection_id=${connectionId}`)

    try {
      socket.send(`CONNECT ${JSON.stringify(NATS_CONNECT_PAYLOAD)}\r\n`)
      socket.send("PING\r\n")
      lastPingSentAt = Date.now()
      socket.send("SUB unifiedTradeEvent.processed sub0\r\n")
      console.log(`[ingest] event=subscription_sent connection_id=${connectionId} subject=unifiedTradeEvent.processed`)
    } catch (error) {
      console.error(
        `[ingest] event=socket_error connection_id=${connectionId} stage=handshake message=${JSON.stringify((error as Error).message)}`
      )
      scheduleReconnect(`handshake_failed:${(error as Error).message}`)
    }
  })

  socket.on("message", (data: WebSocket.Data) => {
    if (!isActiveConnection(connectionId) || socket !== ws) return
    handleMessageChunk(data.toString(), connectionId, socket)
  })

  socket.on("close", (code: number, reasonBuffer: Buffer) => {
    if (!isActiveConnection(connectionId) || socket !== ws) return

    const reason = reasonBuffer.toString() || "no_reason"
    lastDisconnectAt = Date.now()
    console.warn(
      `[ingest] event=socket_close connection_id=${connectionId} code=${code} reason=${JSON.stringify(reason)}`
    )
    scheduleReconnect(`socket_close:${code}`)
  })

  socket.on("error", (error: Error) => {
    if (!isActiveConnection(connectionId) || socket !== ws) return

    console.error(
      `[ingest] event=socket_error connection_id=${connectionId} message=${JSON.stringify(error.message)}`
    )
    scheduleReconnect(`socket_error:${error.message}`)
  })
}

function logConnectionHealth(): void {
  const now = Date.now()
  const secondsSinceLastMessage = lastMessageAt > 0 ? Math.floor((now - lastMessageAt) / 1000) : -1
  console.log(
    `[ingest] event=health state=${connectionState} connection_id=${activeConnectionId} reconnect_attempt=${reconnectAttemptCount} queue=${tradeQueue.length} processors=${activeProcessors} since_last_message_s=${secondsSinceLastMessage}`
  )
}

async function shutdown(reason: string): Promise<void> {
  if (connectionState === "shutting_down") return

  connectionState = "shutting_down"
  clearReconnectTimer(true)
  disposeCurrentSocket(`shutdown:${reason}`)
  await prisma.$disconnect()
}

// =============================================================================
// Startup
// =============================================================================

console.log("🚀 Trade ingestion (optimized)")
console.log(`   Batch: ${QUEUE_BATCH_SIZE} | Flush: ${QUEUE_FLUSH_INTERVAL_MS}ms | Pool: ${CONNECTION_LIMIT}`)

setInterval(() => {
  logConnectionHealth()
}, INGEST_HEALTH_LOG_INTERVAL_MS)

startConnectionAttempt("startup")

// Auto-restart every 24 hours
setTimeout(async () => {
  console.log("🔄 24h restart...")
  await shutdown("24h_restart")
  process.exit(0)
}, 24 * 60 * 60 * 1000)

process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down...")
  await shutdown("sigint")
  process.exit(0)
})

process.on("SIGTERM", async () => {
  console.log("\n🛑 Shutting down...")
  await shutdown("sigterm")
  process.exit(0)
})
