import "dotenv/config"
import { Prisma, type TokenLifecycleStatus } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma-ingest"
import {
  markRevisionPending,
  publishPendingRevision,
  recordDirtyMints as recordRevisionDirtyMints,
  recordDirtyMintsInTransaction,
  revisionCoalescingEnabled,
} from "@/server/ingest/revisions"
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import WebSocket from "ws"
import { getFeedStaleReason, isFeedFatallyStale } from "@/lib/ingest-feed-health"
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
import { isValidSolanaAddress } from "@/lib/solana-address"
import {
  DEFAULT_LIFECYCLE_BATCH_SIZE,
  fetchPumpLifecycleBatch,
  fetchPumpLifecycleSingle,
  PumpLifecycleRequestError,
} from "@/lib/pump-lifecycle"
import {
  classifyLegacyRaydiumMigrationEvidence,
  classifyPumpLifecycle,
  classifyPumpSwapTradeEvidence,
  isCompletedLifecycle,
  lifecycleRetrySchedule,
  reduceLifecycle,
} from "@/lib/token-lifecycle"
import { reduceTokenProvenance } from "@/lib/token-provenance"
import { ingestRetryDelayMs } from "@/lib/ingest-retry"
import { startRuntimeHealthPublisher } from "@/server/ingest/runtime-health"
import { retentionConfig, startRetention } from "@/server/ingest/retention"

// =============================================================================
// Configuration
// =============================================================================

const QUEUE_BATCH_SIZE = 800 // Larger batches with token ID caching
const QUEUE_FLUSH_INTERVAL_MS = parseEnvNumber("INGEST_QUEUE_FLUSH_INTERVAL_MS", 250)
const CONNECTION_LIMIT = 15 // Increased for 10 parallel processors
const ATOMIC_PIPELINE_ENABLED = process.env.INGEST_ATOMIC_PIPELINE_ENABLED !== "false"
const AGGREGATES_ENABLED = process.env.TOKEN_AGGREGATES_ENABLED !== "false"
const CHANGED_JOURNAL_ENABLED = process.env.TOKEN_CHANGED_JOURNAL_ENABLED !== "false"
const MAX_MEMORY_QUEUE = parseEnvNumber("INGEST_MAX_MEMORY_QUEUE", 20_000)
const SPOOL_ROOT = process.env.INGEST_SPOOL_DIR ?? path.join(process.cwd(), "server", "data", "spool")
const SPOOL_PENDING_DIR = path.join(SPOOL_ROOT, "pending")
const SPOOL_DEAD_DIR = path.join(SPOOL_ROOT, "dead-letter")
const SPOOL_MAX_ATTEMPTS = parseEnvNumber("INGEST_SPOOL_MAX_ATTEMPTS", 10)

// Metadata retry configuration
const METADATA_RETRY_INTERVAL_MS = 1_000 // Check queue every second
const METADATA_RETRY_TIMEOUT_MS = 6_000 // 6 second timeout per token
const METADATA_RETRY_BATCH_SIZE = 25 // Process 25 tokens in parallel per batch
const METADATA_FETCH_MAX_ATTEMPTS = 3
const METADATA_MIN_INTERVAL_MS = 150

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
const NATS_URL = process.env.PUMP_NATS_URL ?? "wss://unified-prod.nats.realtime.pump.fun/"
// The unsuffixed processed subject is a sampled market-wide ticker. Pump publishes the
// complete processed stream on one subject per mint, which NATS exposes through `*`.
const NATS_SUBJECT = process.env.PUMP_NATS_SUBJECT ?? "unifiedTradeEvent.processed.*"
const NATS_HEADERS = {
  Origin: "https://pump.fun",
  "User-Agent": "pump-investments-ingester/1.0",
}
const NATS_CONNECT_PAYLOAD = {
  no_responders: true,
  protocol: 1,
  verbose: false,
  pedantic: false,
  user: process.env.PUMP_NATS_USER ?? "",
  pass: process.env.PUMP_NATS_PASSWORD ?? "",
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
const INGEST_TRADE_STALE_AFTER_MS = parseEnvNumber("INGEST_TRADE_STALE_AFTER_MS", 60_000)
const INGEST_FATAL_TRADE_STALE_AFTER_MS = parseEnvNumber("INGEST_FATAL_TRADE_STALE_AFTER_MS", 5 * 60_000)
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
const LIFECYCLE_RECHECK_WINDOW_MS = parseEnvNumber("LIFECYCLE_RECHECK_WINDOW_MS", 2 * 60 * 60 * 1000)
const LIFECYCLE_MAX_ATTEMPTS = parseEnvNumber("LIFECYCLE_MAX_ATTEMPTS", 10)
const LIFECYCLE_UNRESOLVED_COOLDOWN_MS = parseEnvNumber(
  "LIFECYCLE_UNRESOLVED_COOLDOWN_MS",
  6 * 60 * 60 * 1000,
)

// =============================================================================
// Database Setup
// =============================================================================


// =============================================================================
// Constants
// =============================================================================

type Decimal = Prisma.Decimal
const Decimal = Prisma.Decimal
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
let lastTradeMessageAt = 0
let lastTradeMessageAtForConnection = 0
let lastPingSentAt = 0
let lastPongAt = 0
let lastDisconnectAt = 0
const serviceStartedAt = Date.now()
let fatalFeedRestartRequested = false

// SOL price cache
let solPriceCache = { value: 0, updatedAt: 0 }

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
let lastRetentionRunAt: number | null = null
let lastRetentionDurationMs: number | null = null
let lastRetentionDeletedRows = 0
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
      next_attempt_at = CASE
        WHEN EXCLUDED.priority >= 90 OR token_lifecycle_checks.attempts < ${LIFECYCLE_MAX_ATTEMPTS}
          THEN LEAST(token_lifecycle_checks.next_attempt_at, NOW())
        ELSE token_lifecycle_checks.next_attempt_at
      END,
      priority = GREATEST(token_lifecycle_checks.priority, EXCLUDED.priority),
      reason = EXCLUDED.reason,
      updated_at = NOW()
  `)
}

async function enqueueLifecycleChecksByQuery(mode: "all" | "active"): Promise<void> {
  if (!LIFECYCLE_VERIFIER_ENABLED) return
  const activeCutoff = BigInt(Date.now() - LIFECYCLE_RECHECK_WINDOW_MS)
  if (mode === "active") {
    await prisma.$executeRawUnsafe(`
      INSERT INTO token_lifecycle_checks
        (token_id,requested_at,next_attempt_at,attempts,priority,reason,updated_at)
      SELECT t.id,NOW(),NOW(),0,40,'active_recheck',NOW()
      FROM tokens t
      JOIN token_prices tp ON tp.token_id=t.id AND tp.last_trade_timestamp >= ${activeCutoff}
      WHERE t.lifecycle_status IN ('UNKNOWN','BONDING')
      ON CONFLICT (token_id) DO UPDATE SET
        requested_at=NOW(),
        next_attempt_at=CASE WHEN token_lifecycle_checks.attempts < ${LIFECYCLE_MAX_ATTEMPTS}
          THEN LEAST(token_lifecycle_checks.next_attempt_at,NOW())
          ELSE token_lifecycle_checks.next_attempt_at END,
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
    JOIN token_prices tp ON tp.token_id=t.id AND tp.last_trade_timestamp >= ${activeCutoff}
    WHERE t.lifecycle_status IN ('UNKNOWN','BONDING','CURVE_COMPLETE')
    ON CONFLICT (token_id) DO UPDATE SET
      requested_at=NOW(),
      next_attempt_at=CASE WHEN token_lifecycle_checks.attempts < ${LIFECYCLE_MAX_ATTEMPTS}
        THEN LEAST(token_lifecycle_checks.next_attempt_at,NOW())
        ELSE token_lifecycle_checks.next_attempt_at END,
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
  const schedule = lifecycleRetrySchedule(
    attempts,
    LIFECYCLE_MAX_ATTEMPTS,
    LIFECYCLE_UNRESOLVED_COOLDOWN_MS,
    explicitDelayMs,
  )
  await prisma.tokenLifecycleCheck.update({
    where: { tokenId },
    data: {
      attempts,
      lastError: error.slice(0, 500),
      nextAttemptAt: new Date(Date.now() + schedule.delayMs),
      priority: schedule.priority,
    },
  })
}

async function reconcileStoredRaydiumMigrations(): Promise<void> {
  const migrated = await prisma.$queryRawUnsafe<Array<{ mint_address: string }>>(`
    UPDATE tokens
    SET lifecycle_status='CURVE_COMPLETE', lifecycle_verified_at=NOW(), bonding_progress=100,
        completed=TRUE, graduated_at=COALESCE(graduated_at,trade_venue_updated_at,NOW()), updated_at=NOW()
    WHERE launch_source='PUMP'
      AND trade_venue='RAYDIUM_V4'
      AND lifecycle_status IN ('UNKNOWN','BONDING')
    RETURNING mint_address
  `)
  if (migrated.length === 0) return
  await recordDirtyMints(migrated.map((row) => row.mint_address), ["lifecycle"])
  console.log(`[lifecycle] Reconciled ${migrated.length} Pump-to-Raydium migrations`)
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

  const nextPool = verified.pumpSwapPool ?? check.token.pumpSwapPool
  const nextBondingCurve = verified.bondingCurve ?? check.token.bondingCurve
  const nextAssociatedCurve =
    verified.associatedBondingCurve ?? check.token.associatedBondingCurve
  const nextBondingProgress = isCompletedLifecycle(transition.next)
    ? 100
    : verified.bondingProgress ?? check.token.bondingProgress
  const nextLaunchSource = verified.status === "NON_LAUNCHPAD" ? "EXTERNAL" : "PUMP"
  const nextTradeVenue =
    verified.status === "PUMPSWAP"
      ? "PUMPSWAP"
      : verified.status === "BONDING"
        ? "PUMP_BONDING"
        : check.token.tradeVenue
  const lifecycleChanged =
    transition.next !== check.token.lifecycleStatus ||
    nextPool !== check.token.pumpSwapPool ||
    nextBondingCurve !== check.token.bondingCurve ||
    nextAssociatedCurve !== check.token.associatedBondingCurve ||
    nextBondingProgress !== check.token.bondingProgress ||
    nextLaunchSource !== check.token.launchSource ||
    nextTradeVenue !== check.token.tradeVenue ||
    (isCompletedLifecycle(transition.next) && !check.token.graduatedAt)

  if (!lifecycleChanged) {
    await prisma.$transaction([
      prisma.tokenLifecycleCheck.deleteMany({ where: { tokenId: check.tokenId } }),
      prisma.tokenDataRevision.upsert({
        where: { key: "lifecycle-verifier" },
        create: { key: "lifecycle-verifier", revision: BigInt(1) },
        update: { revision: { increment: BigInt(1) } },
      }),
    ])
    return true
  }

  await prisma.$transaction([
    prisma.token.update({
      where: { id: check.tokenId },
      data: {
        lifecycleStatus: transition.next,
        lifecycleVerifiedAt: now,
        bondingProgress: nextBondingProgress,
        completed: isCompletedLifecycle(transition.next),
        pumpSwapPool: nextPool,
        graduatedAt:
          isCompletedLifecycle(transition.next) && !check.token.graduatedAt
            ? now
            : check.token.graduatedAt,
        bondingCurve: nextBondingCurve,
        associatedBondingCurve: nextAssociatedCurve,
        launchSource: nextLaunchSource,
        sourceVerifiedAt: now,
        tradeVenue: nextTradeVenue,
        tradeVenueUpdatedAt:
          nextTradeVenue !== check.token.tradeVenue ? now : check.token.tradeVenueUpdatedAt,
      },
    }),
    prisma.tokenLifecycleCheck.deleteMany({ where: { tokenId: check.tokenId } }),
  ])
  await recordDirtyMints([check.token.mintAddress], ["lifecycle"])
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
          bondingProgress: true,
          pumpSwapPool: true,
          graduatedAt: true,
          bondingCurve: true,
          associatedBondingCurve: true,
          launchSource: true,
          tradeVenue: true,
          tradeVenueUpdatedAt: true,
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
  if (revisionCoalescingEnabled()) {
    try {
      await publishPendingRevision()
    } catch (error) {
      console.warn("[revision] Failed to publish pending token revision:", (error as Error).message)
    }
    return
  }
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

async function recordDirtyMints(mints: string[], changeKinds: string[]): Promise<void> {
  if (!CHANGED_JOURNAL_ENABLED || mints.length === 0 || changeKinds.length === 0) {
    if (revisionCoalescingEnabled()) await markRevisionPending()
    else tokenRevisionDirty = true
    return
  }
  await recordRevisionDirtyMints(mints, changeKinds, CHANGED_JOURNAL_ENABLED)
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
        await prisma.solPriceState.upsert({
          where: { key: "sol-usd" },
          create: { key: "sol-usd", priceUsd: price, source: "coingecko", updatedAt: new Date(now) },
          update: { priceUsd: price, source: "coingecko", updatedAt: new Date(now) },
        })
        return price
      }
    }
  } catch (error) {
    console.warn("[ingest] Failed to fetch SOL price:", (error as Error).message)
  }

  if (solPriceCache.value <= 0) {
    const persisted = await prisma.solPriceState.findUnique({ where: { key: "sol-usd" } }).catch(() => null)
    if (persisted) {
      solPriceCache = { value: Number(persisted.priceUsd), updatedAt: persisted.updatedAt.getTime() }
    }
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
  platform: string
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
    platform: typeof trade.platform === "string" ? trade.platform.toLowerCase() : "",
    isBondingCurve: typeof trade.isBondingCurve === "boolean" ? trade.isBondingCurve : null,
    poolAddress: firstString(trade.poolAddress) ?? null,
    kingOfTheHillTimestamp,
    raw: process.env.INGEST_STORE_RAW_TRADES === "true" ? trade : null,
  }
}

interface InsertedTradeRow {
  token_id: string
  tx_signature: string
  timestamp: bigint
}

function sourceAndVenue(trade: PreparedTrade): {
  source: "UNKNOWN" | "PUMP" | "MOONSHOT" | "EXTERNAL"
  venue: "UNKNOWN" | "PUMP_BONDING" | "PUMPSWAP" | "RAYDIUM_V4" | "METEORA_DBC"
} {
  const result = reduceTokenProvenance(trade.program, trade.platform)
  return {
    source: result.launchSource.toUpperCase() as "UNKNOWN" | "PUMP" | "MOONSHOT" | "EXTERNAL",
    venue: result.tradeVenue.toUpperCase() as
      | "UNKNOWN"
      | "PUMP_BONDING"
      | "PUMPSWAP"
      | "RAYDIUM_V4"
      | "METEORA_DBC",
  }
}

async function persistTradesAtomic(trades: PreparedTrade[]): Promise<void> {
  if (trades.length === 0) return
  const latestByMint = new Map<string, PreparedTrade>()
  for (const trade of trades) {
    const current = latestByMint.get(trade.mint)
    if (!current || trade.timestampMs > current.timestampMs) latestByMint.set(trade.mint, trade)
  }
  const uniqueTokens = [...latestByMint.values()]

  const result = await prisma.$transaction(async (tx) => {
    const lifecycleChangedMints: string[] = []
    const tokenValues = uniqueTokens.map((trade) => {
      const { source, venue } = sourceAndVenue(trade)
      return `(${escapeSQL(generateCuid())},${escapeSQL(trade.mint)},${escapeSQL(trade.symbol.slice(0, 50))},${escapeSQL(trade.name.slice(0, 200))},${escapeSQL(trade.imageUri)},${escapeSQL(trade.metadataUri)},${escapeSQL(trade.twitter)},${escapeSQL(trade.telegram)},${escapeSQL(trade.website)},${escapeSQL(trade.description?.slice(0, 1000) ?? null)},${escapeSQL(trade.creatorAddress)},${trade.createdTs},false,'UNKNOWN',${escapeSQL(trade.bondingCurve)},${escapeSQL(trade.associatedBondingCurve)},'${source}','${venue}',${source === "UNKNOWN" ? "NULL" : "NOW()"},NOW(),'first_observed',NOW())`
    }).join(",")

    await tx.$executeRawUnsafe(`
      INSERT INTO tokens (
        id,mint_address,symbol,name,image_uri,metadata_uri,twitter,telegram,website,description,
        creator_address,created_timestamp,completed,lifecycle_status,bonding_curve,
        associated_bonding_curve,launch_source,trade_venue,source_verified_at,
        trade_venue_updated_at,created_timestamp_source,updated_at
      )
      VALUES ${tokenValues}
      ON CONFLICT (mint_address) DO UPDATE SET
        image_uri = COALESCE(tokens.image_uri, EXCLUDED.image_uri),
        metadata_uri = COALESCE(tokens.metadata_uri, EXCLUDED.metadata_uri),
        bonding_curve = COALESCE(tokens.bonding_curve, EXCLUDED.bonding_curve),
        associated_bonding_curve = COALESCE(tokens.associated_bonding_curve, EXCLUDED.associated_bonding_curve),
        launch_source = CASE WHEN tokens.launch_source = 'UNKNOWN' THEN EXCLUDED.launch_source ELSE tokens.launch_source END,
        source_verified_at = CASE WHEN tokens.launch_source = 'UNKNOWN' AND EXCLUDED.launch_source <> 'UNKNOWN' THEN NOW() ELSE tokens.source_verified_at END,
        trade_venue = EXCLUDED.trade_venue,
        trade_venue_updated_at = CASE WHEN tokens.trade_venue IS DISTINCT FROM EXCLUDED.trade_venue THEN NOW() ELSE tokens.trade_venue_updated_at END,
        updated_at = CASE WHEN
          tokens.image_uri IS DISTINCT FROM COALESCE(tokens.image_uri, EXCLUDED.image_uri)
          OR tokens.metadata_uri IS DISTINCT FROM COALESCE(tokens.metadata_uri, EXCLUDED.metadata_uri)
          OR tokens.trade_venue IS DISTINCT FROM EXCLUDED.trade_venue
          OR (tokens.launch_source = 'UNKNOWN' AND EXCLUDED.launch_source <> 'UNKNOWN')
          THEN NOW() ELSE tokens.updated_at END
    `)

    const pumpSwapEvidenceByMint = new Map<
      string,
      {
        trade: PreparedTrade
        verified: NonNullable<ReturnType<typeof classifyPumpSwapTradeEvidence>>
      }
    >()
    for (const trade of trades) {
      const verified = classifyPumpSwapTradeEvidence({
          program: trade.program,
          poolAddress: trade.poolAddress,
          isBondingCurve: trade.isBondingCurve,
      })
      if (!verified) continue
      const existing = pumpSwapEvidenceByMint.get(trade.mint)
      if (!existing || trade.timestampMs > existing.trade.timestampMs) {
        pumpSwapEvidenceByMint.set(trade.mint, { trade, verified })
      }
    }
    const pumpSwapEvidence = [...pumpSwapEvidenceByMint.values()]

    if (pumpSwapEvidence.length > 0) {
      const evidenceValues = pumpSwapEvidence
        .map(
          ({ trade, verified }) =>
            `(${escapeSQL(trade.mint)},${escapeSQL(verified.pumpSwapPool)},${trade.timestampMs})`,
        )
        .join(",")
      const changed = await tx.$queryRawUnsafe<Array<{ mint_address: string }>>(`
        UPDATE tokens AS token
        SET lifecycle_status = 'PUMPSWAP',
            lifecycle_verified_at = NOW(),
            bonding_progress = 100,
            completed = TRUE,
            pump_swap_pool = COALESCE(token.pump_swap_pool, evidence.pool_address),
            graduated_at = COALESCE(token.graduated_at, to_timestamp(evidence.trade_timestamp_ms / 1000.0)),
            updated_at = NOW()
        FROM (VALUES ${evidenceValues}) AS evidence(mint_address,pool_address,trade_timestamp_ms)
        WHERE token.mint_address = evidence.mint_address
          AND (
            token.lifecycle_status <> 'PUMPSWAP'
            OR token.completed = FALSE
            OR token.pump_swap_pool IS NULL
            OR token.bonding_progress IS DISTINCT FROM 100
          )
        RETURNING token.mint_address
      `)
      lifecycleChangedMints.push(...changed.map((row) => row.mint_address))
      await tx.$executeRawUnsafe(`
        DELETE FROM token_lifecycle_checks
        WHERE token_id IN (
          SELECT id FROM tokens
          WHERE mint_address IN (${pumpSwapEvidence.map(({ trade }) => escapeSQL(trade.mint)).join(",")})
        )
      `)
    }

    const raydiumEvidenceByMint = new Map<string, PreparedTrade>()
    for (const trade of trades) {
      const verified = classifyLegacyRaydiumMigrationEvidence({
        program: trade.program,
        poolAddress: trade.poolAddress,
        isBondingCurve: trade.isBondingCurve,
      })
      if (!verified) continue
      const existing = raydiumEvidenceByMint.get(trade.mint)
      if (!existing || trade.timestampMs > existing.timestampMs) raydiumEvidenceByMint.set(trade.mint, trade)
    }
    const raydiumEvidence = [...raydiumEvidenceByMint.values()]
    if (raydiumEvidence.length > 0) {
      const evidenceValues = raydiumEvidence
        .map((trade) => `(${escapeSQL(trade.mint)},${trade.timestampMs})`)
        .join(",")
      const changed = await tx.$queryRawUnsafe<Array<{ mint_address: string }>>(`
        UPDATE tokens AS token
        SET lifecycle_status = 'CURVE_COMPLETE',
            lifecycle_verified_at = NOW(),
            bonding_progress = 100,
            completed = TRUE,
            graduated_at = COALESCE(token.graduated_at, to_timestamp(evidence.trade_timestamp_ms / 1000.0)),
            updated_at = NOW()
        FROM (VALUES ${evidenceValues}) AS evidence(mint_address,trade_timestamp_ms)
        WHERE token.mint_address = evidence.mint_address
          AND token.launch_source = 'PUMP'
          AND token.lifecycle_status IN ('UNKNOWN','BONDING')
        RETURNING token.mint_address
      `)
      lifecycleChangedMints.push(...changed.map((row) => row.mint_address))
      await tx.$executeRawUnsafe(`
        DELETE FROM token_lifecycle_checks
        WHERE token_id IN (
          SELECT id FROM tokens
          WHERE launch_source = 'PUMP'
            AND lifecycle_status = 'CURVE_COMPLETE'
            AND mint_address IN (${raydiumEvidence.map((trade) => escapeSQL(trade.mint)).join(",")})
        )
      `)
    }

    const tokenRows = await tx.token.findMany({
      where: { mintAddress: { in: uniqueTokens.map((trade) => trade.mint) } },
      select: { id: true, mintAddress: true, metadataUri: true, imageUri: true, name: true, symbol: true },
    })
    const ids = new Map(tokenRows.map((row) => [row.mintAddress, row.id]))
    const validTrades = trades.filter((trade) => ids.has(trade.mint))
    const tradeValues = validTrades.map((trade) =>
      `(${escapeSQL(ids.get(trade.mint)!)},${escapeSQL(trade.tx)},${escapeSQL(trade.userAddress)},${trade.isBuy},${trade.amountSol},${trade.amountUsd},${trade.baseAmount},${trade.priceSol},${trade.priceUsd},${trade.timestampMs},NULL,NOW())`,
    ).join(",")
    const inserted = tradeValues
      ? await tx.$queryRawUnsafe<InsertedTradeRow[]>(`
          INSERT INTO trades (
            token_id,tx_signature,user_address,is_buy,amount_sol,amount_usd,base_amount,
            price_sol,price_usd,timestamp,raw,created_at
          )
          VALUES ${tradeValues}
          ON CONFLICT (tx_signature) DO NOTHING
          RETURNING token_id, tx_signature, timestamp
        `)
      : []

    if (inserted.length > 0) {
      const insertedSignatures = inserted.map((row) => escapeSQL(row.tx_signature)).join(",")
      await tx.$executeRawUnsafe(`
        INSERT INTO token_prices (token_id,price_sol,price_usd,market_cap_usd,last_trade_timestamp,updated_at)
        SELECT DISTINCT ON (tr.token_id)
          tr.token_id,tr.price_sol,tr.price_usd,tr.price_usd * 1000000000,tr.timestamp,NOW()
        FROM trades tr
        WHERE tr.tx_signature IN (${insertedSignatures})
        ORDER BY tr.token_id, tr.timestamp DESC
        ON CONFLICT (token_id) DO UPDATE SET
          price_sol=EXCLUDED.price_sol,price_usd=EXCLUDED.price_usd,
          market_cap_usd=EXCLUDED.market_cap_usd,
          last_trade_timestamp=EXCLUDED.last_trade_timestamp,updated_at=NOW()
        WHERE EXCLUDED.last_trade_timestamp >= token_prices.last_trade_timestamp
      `)

      if (AGGREGATES_ENABLED) {
        await tx.$executeRawUnsafe(`
          INSERT INTO token_minute_aggregates (
            token_id,minute,volume_usd,volume_sol,buy_volume_usd,buy_volume_sol,
            sell_volume_usd,sell_volume_sol,buy_count,sell_count,
            last_trade_timestamp,updated_at
          )
          SELECT token_id, to_timestamp(timestamp / 1000)::timestamp(0) -
            (EXTRACT(second FROM to_timestamp(timestamp / 1000))::int * interval '1 second'),
            SUM(amount_usd),SUM(amount_sol),
            SUM(CASE WHEN is_buy THEN amount_usd ELSE 0 END),
            SUM(CASE WHEN is_buy THEN amount_sol ELSE 0 END),
            SUM(CASE WHEN NOT is_buy THEN amount_usd ELSE 0 END),
            SUM(CASE WHEN NOT is_buy THEN amount_sol ELSE 0 END),
            COUNT(*) FILTER (WHERE is_buy), COUNT(*) FILTER (WHERE NOT is_buy), MAX(timestamp), NOW()
          FROM trades WHERE tx_signature IN (${insertedSignatures})
          GROUP BY token_id, 2
          ON CONFLICT (token_id,minute) DO UPDATE SET
            volume_usd=token_minute_aggregates.volume_usd+EXCLUDED.volume_usd,
            volume_sol=token_minute_aggregates.volume_sol+EXCLUDED.volume_sol,
            buy_volume_usd=token_minute_aggregates.buy_volume_usd+EXCLUDED.buy_volume_usd,
            buy_volume_sol=token_minute_aggregates.buy_volume_sol+EXCLUDED.buy_volume_sol,
            sell_volume_usd=token_minute_aggregates.sell_volume_usd+EXCLUDED.sell_volume_usd,
            sell_volume_sol=token_minute_aggregates.sell_volume_sol+EXCLUDED.sell_volume_sol,
            buy_count=token_minute_aggregates.buy_count+EXCLUDED.buy_count,
            sell_count=token_minute_aggregates.sell_count+EXCLUDED.sell_count,
            last_trade_timestamp=GREATEST(token_minute_aggregates.last_trade_timestamp,EXCLUDED.last_trade_timestamp),
            updated_at=NOW()
        `)
        await tx.$executeRawUnsafe(`
          INSERT INTO token_buyer_minute_aggregates (
            token_id,minute,buyer_address,buy_total_usd,buy_count,updated_at
          )
          SELECT token_id, to_timestamp(timestamp / 1000)::timestamp(0) -
            (EXTRACT(second FROM to_timestamp(timestamp / 1000))::int * interval '1 second'),
            user_address,SUM(amount_usd),COUNT(*),NOW()
          FROM trades WHERE tx_signature IN (${insertedSignatures}) AND is_buy
          GROUP BY token_id,2,user_address
          ON CONFLICT (token_id,minute,buyer_address) DO UPDATE SET
            buy_total_usd=token_buyer_minute_aggregates.buy_total_usd+EXCLUDED.buy_total_usd,
            buy_count=token_buyer_minute_aggregates.buy_count+EXCLUDED.buy_count,updated_at=NOW()
        `)
      }

      const changedMints = [...new Set(validTrades
        .filter((trade) => inserted.some((row) => row.tx_signature === trade.tx))
        .map((trade) => trade.mint))]
      await recordDirtyMintsInTransaction(
        tx,
        changedMints,
        ["price", "trade"],
        CHANGED_JOURNAL_ENABLED,
      )
    }

    if (lifecycleChangedMints.length > 0) {
      await recordDirtyMintsInTransaction(
        tx,
        lifecycleChangedMints,
        ["lifecycle"],
        CHANGED_JOURNAL_ENABLED,
      )
    }

    return { inserted, tokenRows }
  }, { timeout: 30_000, maxWait: 10_000 })

  for (const row of result.tokenRows) {
    tokenIdCache.set(row.mintAddress, row.id)
    if (!row.metadataUri || !row.imageUri || !row.name?.trim() || !row.symbol?.trim()) {
      scheduleMetadataRetry(row.mintAddress)
    }
  }
  if (result.inserted.length > 0) {
    latestTradePersistedTimestampMs = Math.max(
      latestTradePersistedTimestampMs,
      ...result.inserted.map((row) => Number(row.timestamp)),
    )
  }
}

// =============================================================================
// High-Performance Bulk Insert (Raw SQL)
// =============================================================================

async function persistTradesBulkLegacy(trades: PreparedTrade[]): Promise<void> {
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

    if (revisionCoalescingEnabled()) await markRevisionPending()
    else tokenRevisionDirty = true

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
  let durableBatchPath: string | null = null

  try {
    durableBatchPath = await spoolBatch(batch)
    const solPrice = await getSolPriceUsd()
    const prepared = batch
      .map((trade) => prepareTrade(trade, solPrice))
      .filter((t): t is PreparedTrade => t !== null)

    if (prepared.length > 0) {
      // Sort by mint to ensure consistent lock order (prevents deadlocks)
      prepared.sort((a, b) => a.mint.localeCompare(b.mint))
      await persistTradesBulk(prepared)
    }
    await rm(durableBatchPath, { force: true })
    activeSpoolFiles.delete(durableBatchPath)
    durableBatchPath = null

    // Only log queue size every 30 seconds
    const now = Date.now()
    if (tradeQueue.length > 0 && (now - lastLogTime >= LOG_INTERVAL_MS)) {
      console.log(`[ingest] Queue: ${tradeQueue.length}`)
    }
  } catch (error) {
    const errMsg = (error as Error).message
    if (durableBatchPath) {
      console.error(`[ingest] database batch deferred to durable spool: ${errMsg}`)
      return
    }
    // Retry on deadlock
    if (errMsg.includes("deadlock") || errMsg.includes("40P01")) {
      console.warn(`[ingest] ⚠️ Deadlock, retrying ${batch.length} trades...`)
      tradeQueue.unshift(...batch)
    } else {
      console.error("[ingest] ❌ Error:", errMsg)
      tradeQueue.unshift(...batch)
    }
  } finally {
    if (durableBatchPath) activeSpoolFiles.delete(durableBatchPath)
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
}, Math.max(50, QUEUE_FLUSH_INTERVAL_MS / 2))

// =============================================================================
// Metadata Retry System
// =============================================================================

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

async function persistTradesBulk(trades: PreparedTrade[]): Promise<void> {
  if (ATOMIC_PIPELINE_ENABLED) {
    await persistTradesAtomic(trades)
    return
  }
  await persistTradesBulkLegacy(trades)
}

interface SpoolEnvelope {
  version: 1
  attempts: number
  createdAt: string
  nextAttemptAt?: number
  trades: PumpUnifiedTrade[]
}

const activeSpoolFiles = new Set<string>()

async function ensureSpoolDirectories(): Promise<void> {
  await Promise.all([
    mkdir(SPOOL_PENDING_DIR, { recursive: true }),
    mkdir(SPOOL_DEAD_DIR, { recursive: true }),
  ])
}

async function spoolBatch(trades: PumpUnifiedTrade[], attempts = 0): Promise<string> {
  await ensureSpoolDirectories()
  const destination = path.join(SPOOL_PENDING_DIR, `${Date.now()}-${randomUUID()}.json`)
  const temporary = `${destination}.tmp`
  const envelope: SpoolEnvelope = {
    version: 1,
    attempts,
    createdAt: new Date().toISOString(),
    trades,
  }
  await writeFile(temporary, JSON.stringify(envelope), { encoding: "utf8", flag: "wx" })
  activeSpoolFiles.add(destination)
  try {
    await rename(temporary, destination)
  } catch (error) {
    activeSpoolFiles.delete(destination)
    throw error
  }
  return destination
}

async function replaySpoolFile(filePath: string): Promise<void> {
  const envelope = JSON.parse(await readFile(filePath, "utf8")) as SpoolEnvelope
  if (envelope.nextAttemptAt && envelope.nextAttemptAt > Date.now()) return
  const solPrice = await getSolPriceUsd()
  const prepared = envelope.trades
    .map((trade) => prepareTrade(trade, solPrice))
    .filter((trade): trade is PreparedTrade => trade !== null)
    .sort((a, b) => a.mint.localeCompare(b.mint))
  try {
    await persistTradesBulk(prepared)
    await rm(filePath, { force: true })
  } catch (error) {
    envelope.attempts += 1
    if (envelope.attempts >= SPOOL_MAX_ATTEMPTS) {
      await rename(filePath, path.join(SPOOL_DEAD_DIR, path.basename(filePath)))
      console.error(`[spool] moved batch to dead-letter after ${envelope.attempts} attempts`)
      return
    }
    envelope.nextAttemptAt = Date.now() + ingestRetryDelayMs(envelope.attempts)
    const temporary = `${filePath}.tmp`
    await writeFile(temporary, JSON.stringify(envelope), "utf8")
    await rename(temporary, filePath)
    console.warn(
      `[spool] replay failed attempts=${envelope.attempts} message=${JSON.stringify((error as Error).message)}`,
    )
  }
}

let spoolReplayRunning = false
async function replayPendingSpool(): Promise<void> {
  if (spoolReplayRunning) return
  spoolReplayRunning = true
  try {
    await ensureSpoolDirectories()
    const files = (await readdir(SPOOL_PENDING_DIR))
      .filter((name) => name.endsWith(".json"))
      .filter((name) => !activeSpoolFiles.has(path.join(SPOOL_PENDING_DIR, name)))
      .sort()
    for (const name of files.slice(0, 10)) {
      await replaySpoolFile(path.join(SPOOL_PENDING_DIR, name))
    }
  } catch (error) {
    console.warn(`[spool] replay scan failed: ${(error as Error).message}`)
  } finally {
    spoolReplayRunning = false
  }
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

    const shouldFetchMetadata =
      !token.metadataUri || !token.imageUri || !token.name?.trim() || !token.symbol?.trim()

    if (!shouldFetchMetadata) {
      return "success"
    }

    let metadataUri = token.metadataUri
    let metadata = normalizeTokenMetadata({})
    let authoritativeCreatedAt: number | null = null

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
      const pumpCreatedAt = Number(
        coinRecord.created_timestamp ?? coinRecord.createdTimestamp ?? coinRecord.createdTs,
      )
      if (Number.isFinite(pumpCreatedAt) && pumpCreatedAt > 0) {
        authoritativeCreatedAt = pumpCreatedAt < 10_000_000_000 ? pumpCreatedAt * 1000 : pumpCreatedAt
      }
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

    if (metadata.name && (!token.name?.trim() || token.name.match(/^[A-Z0-9]{1,6}$/))) {
      updates.name = metadata.name
    }
    if (metadata.symbol && (!token.symbol?.trim() || token.symbol.match(/^[A-Z0-9]{1,6}$/))) {
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
    if (
      authoritativeCreatedAt &&
      (!token.createdTimestamp || authoritativeCreatedAt < Number(token.createdTimestamp))
    ) {
      updates.createdTimestamp = BigInt(authoritativeCreatedAt)
      updates.createdTimestampSource = "pump_frontend_api"
      updates.createdTimestampVerifiedAt = new Date()
    }

    if (isCompletedLifecycle(token.lifecycleStatus)) {
      const dexCreatedAt = await getDexPairCreatedAt(mint)
      if (dexCreatedAt && (!token.createdTimestamp || dexCreatedAt < Number(token.createdTimestamp))) {
        updates.createdTimestamp = BigInt(dexCreatedAt)
        updates.createdTimestampSource = "dexscreener"
        updates.createdTimestampVerifiedAt = new Date()
      }
    }

    if (Object.keys(updates).length > 0) {
      await prisma.token.update({
        where: { id: token.id },
        data: updates,
      })
      await recordDirtyMints([mint], ["metadata"])
    }

    // Only return true if we now have both metadataUri and imageUri (or already had both)
    // This prevents re-seeding tokens that legitimately don't have metadata available
    const updatedToken = await prisma.token.findUnique({
      where: { id: token.id },
      select: { metadataUri: true, imageUri: true, name: true, symbol: true },
    })
    if (
      updatedToken?.metadataUri &&
      updatedToken.imageUri &&
      updatedToken.name?.trim() &&
      updatedToken.symbol?.trim()
    ) {
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

console.log(
  `[cleanup] Retention: trades=${retentionConfig.tradeHours}h aggregates=${retentionConfig.aggregateHours}h realtime=${retentionConfig.revisionMinutes}m`,
)
startRetention((result) => {
  lastRetentionRunAt = result.runAt
  lastRetentionDurationMs = result.durationMs
  lastRetentionDeletedRows = result.deletedRows
})

setInterval(() => void flushTokenRevision(), 1_000)

if (LIFECYCLE_VERIFIER_ENABLED) {
  setTimeout(() => {
    void reconcileStoredRaydiumMigrations()
      .then(() => enqueueLifecycleChecksByQuery("all"))
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
          { name: "" },
          { symbol: "" },
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
          { name: "" },
          { symbol: "" },
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
            { name: "" },
            { symbol: "" },
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

function triggerFatalFeedRestart(now: number): void {
  if (fatalFeedRestartRequested || connectionState === "shutting_down") return
  fatalFeedRestartRequested = true
  const reference = lastTradeMessageAt || serviceStartedAt
  console.error(
    `[ingest] event=fatal_feed_stale since_last_trade_s=${Math.floor((now - reference) / 1000)} action=pm2_restart`,
  )
  void shutdown("fatal_feed_stale").finally(() => process.exit(1))
  setTimeout(() => process.exit(1), 5_000)
}

function checkConnectionHealth(connectionId: number): void {
  if (!isActiveConnection(connectionId) || connectionState !== "connected") return

  const socket = ws
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    handleStaleConnection("socket_not_open", connectionId)
    return
  }

  const now = Date.now()
  if (isFeedFatallyStale(now, serviceStartedAt, lastTradeMessageAt, INGEST_FATAL_TRADE_STALE_AFTER_MS)) {
    triggerFatalFeedRestart(now)
    return
  }

  const staleReason = getFeedStaleReason({
    nowMs: now,
    connectedAtMs: lastConnectedAt,
    lastProtocolMessageAtMs: lastMessageAt,
    lastTradeMessageAtMs: lastTradeMessageAtForConnection,
    protocolStaleAfterMs: INGEST_STALE_AFTER_MS,
    tradeStaleAfterMs: INGEST_TRADE_STALE_AFTER_MS,
  })
  if (staleReason) {
    handleStaleConnection(staleReason, connectionId)
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
      lastTradeMessageAt = Date.now()
      lastTradeMessageAtForConnection = lastTradeMessageAt
      if (tradeQueue.length >= MAX_MEMORY_QUEUE) {
        void spoolBatch([trade as PumpUnifiedTrade]).catch((error) => {
          console.error(`[spool] overflow write failed: ${(error as Error).message}`)
        })
      } else {
        tradeQueue.push(trade as PumpUnifiedTrade)
      }

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
    lastTradeMessageAtForConnection = 0
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
      socket.send(`SUB ${NATS_SUBJECT} sub0\r\n`)
      console.log(`[ingest] event=subscription_sent connection_id=${connectionId} subject=${NATS_SUBJECT}`)
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
  const secondsSinceLastTrade = lastTradeMessageAt > 0 ? Math.floor((now - lastTradeMessageAt) / 1000) : -1
  console.log(
    `[ingest] event=health state=${connectionState} connection_id=${activeConnectionId} reconnect_attempt=${reconnectAttemptCount} queue=${tradeQueue.length} processors=${activeProcessors} since_last_message_s=${secondsSinceLastMessage} since_last_trade_s=${secondsSinceLastTrade}`
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
console.log(`   Atomic: ${ATOMIC_PIPELINE_ENABLED} | Spool: ${SPOOL_ROOT}`)

setInterval(() => {
  logConnectionHealth()
}, INGEST_HEALTH_LOG_INTERVAL_MS)

startRuntimeHealthPublisher(SPOOL_ROOT, () => ({
  connection_state: connectionState,
  queue_depth: tradeQueue.length,
  active_processors: activeProcessors,
  latest_trade_seen_ms: latestTradeSeenTimestampMs,
  latest_trade_persisted_ms: latestTradePersistedTimestampMs,
  last_trade_message_at: lastTradeMessageAt,
  metadata: getMetadataQueueMetrics(),
  retention: {
    trade_hours: retentionConfig.tradeHours,
    aggregate_hours: retentionConfig.aggregateHours,
    last_run_at: lastRetentionRunAt,
    last_duration_ms: lastRetentionDurationMs,
    last_deleted_rows: lastRetentionDeletedRows,
  },
}))

setInterval(() => void replayPendingSpool(), 2_000)
void replayPendingSpool().finally(() => startConnectionAttempt("startup"))

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
