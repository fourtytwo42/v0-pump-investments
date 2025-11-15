import { Prisma, PrismaClient } from "@prisma/client"
import { Decimal } from "@prisma/client/runtime/library"
import WebSocket from "ws"
import {
  decodePumpPayload,
  type PumpUnifiedTrade,
  getIpfsGatewayUrls,
  normalizeIpfsUri,
} from "@/lib/pump-trades"
import { normalizeTokenMetadata, isMetadataEmpty } from "@/lib/token-metadata"
import { fetchPumpCoin, PUMP_HEADERS } from "@/lib/pump-coin"
import { getDexPairCreatedAt } from "@/lib/dexscreener"

function enforceConnectionLimit(url?: string): string | undefined {
  if (!url) return url

  try {
    const parsed = new URL(url)
    parsed.searchParams.set("connection_limit", parsed.searchParams.get("connection_limit") ?? "1")
    parsed.searchParams.set("pool_timeout", parsed.searchParams.get("pool_timeout") ?? "0")
    return parsed.toString()
  } catch {
    const separator = url.includes("?") ? "&" : "?"
    return `${url}${separator}connection_limit=1&pool_timeout=0`
  }
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: enforceConnectionLimit(process.env.DATABASE_URL),
    },
  },
})

const TOKEN_DECIMALS = new Decimal(1_000_000)
const TOTAL_SUPPLY_TOKENS = new Decimal("1000000000")
const TOTAL_SUPPLY_RAW = TOTAL_SUPPLY_TOKENS.mul(TOKEN_DECIMALS)

const NATS_URL = "wss://unified-prod.nats.realtime.pump.fun/"
const NATS_HEADERS = {
  Origin: "https://pump.fun",
  "User-Agent": "pump-investments-ingester/1.0",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
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
const SUBJECTS = ["unifiedTradeEvent.processed"]

const TRADE_RETENTION_MS = 60 * 60 * 1000
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000

const tradeQueue: PumpUnifiedTrade[] = []
let isProcessingQueue = false

let ws: WebSocket | null = null
let reconnectTimer: NodeJS.Timeout | null = null
let messageBuffer = ""

let solPriceCache = {
  value: 160,
  updatedAt: 0,
}

const metadataCache = new Map<string, any>()
const metadataFetchPromises = new Map<string, Promise<any>>()
const metadataRetryQueue = new Set<string>()
const metadataRetryAttempts = new Map<string, number>()
let isProcessingMetadataQueue = false

interface MetadataRequestJob {
  target: string
  init: RequestInit
  resolve: (response: Response) => void
  reject: (error: Error) => void
}

const metadataRequestQueue: MetadataRequestJob[] = []
let metadataActiveRequests = 0
let lastMetadataRequestAt = 0
let metadataDynamicDelayMs = 0

const METADATA_MAX_CONCURRENCY = 2
const METADATA_MIN_INTERVAL_MS = 150
const METADATA_BACKOFF_STEP_MS = 100
const METADATA_BACKOFF_DECAY_MS = 25
const METADATA_BACKOFF_MAX_MS = 2000
function adjustMetadataDelay(onError: boolean) {
  if (onError) {
    metadataDynamicDelayMs = Math.min(metadataDynamicDelayMs + METADATA_BACKOFF_STEP_MS, METADATA_BACKOFF_MAX_MS)
  } else {
    metadataDynamicDelayMs = Math.max(0, metadataDynamicDelayMs - METADATA_BACKOFF_DECAY_MS)
  }
}

async function processMetadataRequest(job: MetadataRequestJob) {
  metadataActiveRequests += 1
  try {
    const now = Date.now()
    const elapsed = now - lastMetadataRequestAt
    const requiredSpacing = METADATA_MIN_INTERVAL_MS + metadataDynamicDelayMs
    if (elapsed < requiredSpacing) {
      await delay(requiredSpacing - elapsed)
    }

    lastMetadataRequestAt = Date.now()

    const response = await fetch(job.target, job.init)
    if (response.status >= 500 || response.status === 429 || response.status === 403) {
      adjustMetadataDelay(true)
    } else {
      adjustMetadataDelay(false)
    }
    job.resolve(response)
  } catch (error) {
    adjustMetadataDelay(true)
    job.reject(error as Error)
  } finally {
    metadataActiveRequests -= 1
    void drainMetadataRequestQueue()
  }
}

async function drainMetadataRequestQueue() {
  while (metadataActiveRequests < METADATA_MAX_CONCURRENCY && metadataRequestQueue.length > 0) {
    const job = metadataRequestQueue.shift()
    if (!job) break
    void processMetadataRequest(job)
  }
}

function enqueueMetadataRequest(target: string, init: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    metadataRequestQueue.push({ target, init, resolve, reject })
    void drainMetadataRequestQueue()
  })
}


const METADATA_FETCH_MAX_ATTEMPTS = 3
const METADATA_RETRY_MAX_ATTEMPTS = 5
const METADATA_RETRY_INTERVAL_MS = 15_000
const METADATA_RETRY_BATCH_SIZE = 10
const METADATA_RETRY_BASE_DELAY_MS = 250
const CREATION_TIMESTAMP_FALLBACK_WINDOW_MS = 24 * 60 * 60 * 1000
const DEX_CREATION_REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function looksLikeMintPrefix(value: string | null | undefined, mint: string): boolean {
  if (!value) return true
  const cleaned = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase()
  if (!cleaned) return true
  if (cleaned.length < 3) return false
  return mint.toUpperCase().startsWith(cleaned)
}

function scheduleMetadataRetry(mint: string) {
  if (!mint) return
  if (metadataRetryQueue.has(mint)) return
  const attempts = metadataRetryAttempts.get(mint) ?? 0
  if (attempts >= METADATA_RETRY_MAX_ATTEMPTS) return
  metadataRetryAttempts.set(mint, attempts + 1)
  metadataRetryQueue.add(mint)
}

function toDecimal(value: unknown, fallback = "0"): Decimal {
  if (value === null || value === undefined) {
    return new Decimal(fallback)
  }

  try {
    return new Decimal(value.toString())
  } catch {
    return new Decimal(fallback)
  }
}

function firstString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim()
      if (trimmed.length > 0) {
        return trimmed
      }
    }
  }
  return undefined
}

async function getSolPriceUsd(): Promise<number> {
  const now = Date.now()
  if (now - solPriceCache.updatedAt < 60_000) {
    return solPriceCache.value
  }

  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { headers: { accept: "application/json" } },
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

async function fetchMetadataFromUri(uri: string): Promise<any | null> {
  if (!uri) {
    return null
  }

  if (metadataCache.has(uri)) {
    return metadataCache.get(uri)
  }

  if (metadataFetchPromises.has(uri)) {
    return metadataFetchPromises.get(uri)!
  }

  const candidates = getIpfsGatewayUrls(uri)
  const targets = candidates.length > 0 ? candidates : [normalizeIpfsUri(uri) ?? uri]
  const controller = new AbortController()
  const promise = (async () => {
    let lastError: Error | null = null

    for (const target of targets) {
      for (let attempt = 0; attempt < METADATA_FETCH_MAX_ATTEMPTS; attempt += 1) {
        try {
          const response = await enqueueMetadataRequest(target, {
            cache: "no-store",
            headers: {
              ...PUMP_HEADERS,
              accept: "application/json",
            },
            signal: controller.signal,
          })

          if (!response.ok) {
            throw new Error(`metadata fetch failed with status ${response.status}`)
          }

          const json = await response.json()
          metadataCache.set(uri, json)
          return json
        } catch (error) {
          lastError = error as Error
          const delayMs = METADATA_RETRY_BASE_DELAY_MS * 2 ** attempt
          if (attempt < METADATA_FETCH_MAX_ATTEMPTS - 1) {
            await delay(delayMs)
          } else {
            break
          }
        }
      }
    }

    if (lastError) {
      console.warn(`[ingest] Failed to fetch metadata from ${uri}:`, lastError.message)
    }

    return null
  })().finally(() => {
    metadataFetchPromises.delete(uri)
    controller.abort()
  })

  metadataFetchPromises.set(uri, promise)
  return promise
}

async function fetchCoinInfoWithRetry(mint: string, attempts = METADATA_FETCH_MAX_ATTEMPTS): Promise<any | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const coin = await fetchPumpCoin(mint)
    if (coin) {
      return coin
    }
    const delayMs = METADATA_RETRY_BASE_DELAY_MS * 2 ** attempt
    await delay(delayMs)
  }
  return null
}

async function refreshTokenMetadata(mint: string): Promise<boolean> {
  try {
    const tokenRecord = await prisma.token.findUnique({
      where: { mintAddress: mint },
    })

    if (!tokenRecord) {
      return true
    }

    const coinInfo = await fetchCoinInfoWithRetry(mint)
    if (!coinInfo) {
      return false
    }

    const coinRecord = coinInfo as Record<string, unknown>

    const rawMetadataUri = firstString(coinRecord.metadataUri, coinRecord.metadata_uri, coinRecord.uri) ?? null
    let normalizedMetadataUri = rawMetadataUri ? normalizeIpfsUri(rawMetadataUri) : null

    const coinMetadata = normalizeTokenMetadata(
      (coinRecord.metadata as Record<string, unknown> | undefined) ?? coinRecord,
    )

    let combinedMetadata = {
      ...coinMetadata,
    }

    const metadataFetchUri = rawMetadataUri ?? normalizedMetadataUri
    if (metadataFetchUri) {
      const remoteMetadataRaw = await fetchMetadataFromUri(metadataFetchUri)
      if (remoteMetadataRaw && typeof remoteMetadataRaw === "object") {
        const remoteMetadata = normalizeTokenMetadata(remoteMetadataRaw)
        combinedMetadata = {
          ...combinedMetadata,
          ...remoteMetadata,
        }
      }
    } else if (tokenRecord.metadataUri) {
      normalizedMetadataUri = normalizeIpfsUri(tokenRecord.metadataUri) ?? tokenRecord.metadataUri
    }

    const normalizedImage = combinedMetadata.image ? normalizeIpfsUri(combinedMetadata.image) : null

    const updates: Prisma.TokenUpdateInput = {}

    const existingCreatedTimestamp = tokenRecord.createdTimestamp ? Number(tokenRecord.createdTimestamp) : null
    const creationLooksRecent =
      !existingCreatedTimestamp ||
      Date.now() - existingCreatedTimestamp < DEX_CREATION_REFRESH_WINDOW_MS

    let createdTimestampCandidate =
      typeof combinedMetadata.createdTimestamp === "number" ? combinedMetadata.createdTimestamp : null

    if (
      (tokenRecord.completed || coinRecord.complete === true) &&
      creationLooksRecent
    ) {
      const dexCreatedAt = await getDexPairCreatedAt(mint)
      if (dexCreatedAt && (!createdTimestampCandidate || dexCreatedAt < createdTimestampCandidate)) {
        createdTimestampCandidate = dexCreatedAt
      }
    }

    if (
      typeof createdTimestampCandidate === "number" &&
      Number.isFinite(createdTimestampCandidate) &&
      createdTimestampCandidate > 0
    ) {
      const candidateBigInt = BigInt(Math.round(createdTimestampCandidate))
      if (
        !tokenRecord.createdTimestamp ||
        candidateBigInt < tokenRecord.createdTimestamp
      ) {
        updates.createdTimestamp = candidateBigInt
      }
    }

    const nameCandidate = combinedMetadata.name ?? null
    const symbolCandidate = combinedMetadata.symbol ?? null

    if (nameCandidate && looksLikeMintPrefix(tokenRecord.name, mint)) {
      updates.name = nameCandidate
    }

    if (symbolCandidate && looksLikeMintPrefix(tokenRecord.symbol, mint)) {
      updates.symbol = symbolCandidate
    }

    if (normalizedMetadataUri && tokenRecord.metadataUri !== normalizedMetadataUri) {
      updates.metadataUri = normalizedMetadataUri
    }

    if (
      normalizedImage &&
      (!tokenRecord.imageUri || tokenRecord.imageUri === tokenRecord.metadataUri || tokenRecord.imageUri === normalizedMetadataUri)
    ) {
      updates.imageUri = normalizedImage
    }

    if (combinedMetadata.description && !tokenRecord.description) {
      updates.description = combinedMetadata.description
    }

    if (combinedMetadata.website && !tokenRecord.website) {
      updates.website = combinedMetadata.website
    }

    if (combinedMetadata.twitter && !tokenRecord.twitter) {
      updates.twitter = combinedMetadata.twitter
    }

    if (combinedMetadata.telegram && !tokenRecord.telegram) {
      updates.telegram = combinedMetadata.telegram
    }

    if (Object.keys(updates).length === 0) {
      return false
    }

    await prisma.token.update({
      where: { mintAddress: mint },
      data: updates,
    })

    return true
  } catch (error) {
    console.warn(`[ingest] Metadata refresh failed for ${mint}:`, (error as Error).message)
    return false
  }
}

async function processMetadataRetryQueue() {
  if (isProcessingMetadataQueue || metadataRetryQueue.size === 0) {
    return
  }

  isProcessingMetadataQueue = true
  try {
    const batch = Array.from(metadataRetryQueue).slice(0, METADATA_RETRY_BATCH_SIZE)
    for (const mint of batch) {
      metadataRetryQueue.delete(mint)
      const success = await refreshTokenMetadata(mint)
      if (success) {
        metadataRetryAttempts.delete(mint)
      } else {
        scheduleMetadataRetry(mint)
      }
    }
  } finally {
    isProcessingMetadataQueue = false
  }
}

setInterval(() => {
  void processMetadataRetryQueue()
}, METADATA_RETRY_INTERVAL_MS)

async function seedMetadataRetryQueue(): Promise<void> {
  try {
    const creationCutoff = BigInt(Date.now() - DEX_CREATION_REFRESH_WINDOW_MS)
    const candidates = await prisma.token.findMany({
      where: {
        OR: [
          { imageUri: null },
          { metadataUri: null },
          { description: null },
          { twitter: null },
          { telegram: null },
          { createdTimestamp: null },
          {
            completed: true,
            createdTimestamp: {
              gte: creationCutoff,
            },
          },
        ],
      },
      select: {
        mintAddress: true,
        name: true,
        symbol: true,
        imageUri: true,
        metadataUri: true,
      },
      take: 5000,
    })

    for (const token of candidates) {
      if (!token.mintAddress) continue

      const likelyMintName = looksLikeMintPrefix(token.name, token.mintAddress)
      const likelyMintSymbol = looksLikeMintPrefix(token.symbol, token.mintAddress)
      const missingMetadata = !token.metadataUri || !token.imageUri

      if (missingMetadata || likelyMintName || likelyMintSymbol) {
        scheduleMetadataRetry(token.mintAddress)
      }
    }
  } catch (error) {
    console.warn("[ingest] Failed to seed metadata retry queue:", (error as Error).message)
  }
}

void seedMetadataRetryQueue()

interface PreparedTradeContext {
  trade: PumpUnifiedTrade
  isBuy: boolean
  amountSol: Decimal
  amountUsd: Decimal
  baseAmountTokens: Decimal
  baseAmountRaw: Decimal
  timestampMs: number
  priceSol: Decimal
  priceUsd: Decimal
  fallbackSymbol: string
  fallbackName: string
  creatorAddress: string
  createdTs: number
  hasFeedCreatedTimestamp: boolean
  logSymbol: string
  marketCapUsd: Decimal
  metadataUri?: string | null
  imageUri?: string | null
  twitter?: string | null
  telegram?: string | null
  website?: string | null
  description?: string | null
}

async function prepareTradeContext(
  trade: PumpUnifiedTrade,
  solPriceUsd: number,
): Promise<PreparedTradeContext | null> {
  if (!trade.mintAddress || !trade.tx) {
    return null
  }

  const isBuy = trade.type?.toLowerCase() === "buy"

  const amountSol = toDecimal(trade.amountSol ?? trade.quoteAmount ?? "0").toDecimalPlaces(9)
  const baseAmountTokens = toDecimal(trade.baseAmount ?? "0").toDecimalPlaces(9)
  const baseAmountRaw = baseAmountTokens.mul(TOKEN_DECIMALS).toDecimalPlaces(0)

  if (amountSol.lte(0) || baseAmountTokens.lte(0)) {
    return null
  }

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

  let amountUsd = trade.amountUsd ? toDecimal(trade.amountUsd) : amountSol.mul(priceUsd)
  amountUsd = amountUsd.toDecimalPlaces(2)

  const creatorAddress = trade.creatorAddress ?? trade.coinMeta?.creator ?? "unknown"
  const feedCreatedTsRaw = trade.coinMeta?.createdTs
  const hasFeedCreatedTimestamp =
    typeof feedCreatedTsRaw === "number" && Number.isFinite(feedCreatedTsRaw) && feedCreatedTsRaw > 0
  const createdTs = hasFeedCreatedTimestamp ? Number(feedCreatedTsRaw) : timestampMs

  const coinMetaRecord = (trade.coinMeta as Record<string, unknown> | undefined) ?? {}
  const rawMetadataUri = firstString(
    coinMetaRecord.uri,
    coinMetaRecord.metadata_uri,
    coinMetaRecord.metadataUri,
  ) ?? null

  let normalizedMetadataUri = rawMetadataUri ? normalizeIpfsUri(rawMetadataUri) : null
  let metadata = normalizeTokenMetadata(coinMetaRecord)

  let imageUri = metadata.image ? normalizeIpfsUri(metadata.image) : null

  const imageMatchesMetadataUri =
    Boolean(normalizedMetadataUri) && Boolean(imageUri) && normalizedMetadataUri === imageUri

  const shouldFetchCoinInfo =
    Boolean(trade.mintAddress) &&
    (!normalizedMetadataUri || isMetadataEmpty(metadata) || !imageUri || imageMatchesMetadataUri)

  if (shouldFetchCoinInfo && trade.mintAddress) {
    const coinInfo = await fetchPumpCoin(trade.mintAddress)

    if (coinInfo && typeof coinInfo === "object") {
      const coinRecord = coinInfo as Record<string, unknown>

      const coinMetadataUri = firstString(
        coinRecord.metadataUri,
        coinRecord.metadata_uri,
        coinRecord.uri,
      )

      if (!normalizedMetadataUri && typeof coinMetadataUri === "string") {
        normalizedMetadataUri = normalizeIpfsUri(coinMetadataUri)
      }

      const normalizedCoinMetadata = normalizeTokenMetadata(
        (coinRecord.metadata as Record<string, unknown> | undefined) ?? coinRecord,
      )

      metadata = {
        ...normalizedCoinMetadata,
        ...metadata,
      }

      const coinImageCandidate = firstString(
        coinRecord.imageUri,
        coinRecord.image_uri,
        coinRecord.image,
        normalizedCoinMetadata.image ?? undefined,
      )

      if (
        coinImageCandidate &&
        (!imageUri || imageMatchesMetadataUri)
      ) {
        imageUri = normalizeIpfsUri(coinImageCandidate) ?? imageUri
      }
    }
  }

  const symbolFromName = (name?: string | null) =>
    name ? name.replace(/[^A-Za-z0-9]/g, "").slice(0, 10).toUpperCase() : undefined

  const fallbackSymbol =
    metadata.symbol ??
    trade.coinMeta?.symbol ??
    symbolFromName(metadata.name ?? trade.coinMeta?.name) ??
    (trade.mintAddress ? trade.mintAddress.slice(0, 6).toUpperCase() : "TOKEN")

  const fallbackName = metadata.name ?? trade.coinMeta?.name ?? fallbackSymbol ?? trade.mintAddress ?? "Unknown Token"

  const logSymbol = fallbackSymbol ?? fallbackName ?? trade.mintAddress ?? "UNKNOWN"

  const marketCapUsd = trade.marketCap
    ? toDecimal(trade.marketCap)
    : priceUsd.mul(TOTAL_SUPPLY_TOKENS).toDecimalPlaces(2)

  return {
    trade,
    isBuy,
    amountSol,
    amountUsd,
    baseAmountTokens,
    baseAmountRaw,
    timestampMs,
    priceSol,
    priceUsd,
    fallbackSymbol,
    fallbackName,
    creatorAddress,
    createdTs,
    hasFeedCreatedTimestamp,
    logSymbol,
    marketCapUsd,
    metadataUri: normalizedMetadataUri,
    imageUri,
    twitter: metadata.twitter ?? undefined,
    telegram: metadata.telegram ?? undefined,
    website: metadata.website ?? undefined,
    description: metadata.description ?? undefined,
  }
}

async function persistPreparedTrade(ctx: PreparedTradeContext): Promise<void> {
  const { trade } = ctx
  const program = typeof trade.program === "string" ? trade.program.toLowerCase() : ""
  const coinMeta = (trade.coinMeta as Record<string, unknown> | undefined) ?? {}

  const bondingCurveAddress = firstString(coinMeta.bondingCurve, coinMeta.bonding_curve)
  const associatedBondingCurve = firstString(
    coinMeta.associatedBondingCurve,
    coinMeta.associated_bonding_curve,
  )

  const isBondingFlag = trade.isBondingCurve
  const explicitlyBonding =
    isBondingFlag === true ||
    (isBondingFlag === undefined && typeof bondingCurveAddress === "string" && bondingCurveAddress.length > 0)

  const reachedKoth =
    isBondingFlag === false || (!bondingCurveAddress && program.includes("amm"))

  const kothTimestamp = BigInt(ctx.timestampMs)

  const token = await prisma.token.upsert({
    where: { mintAddress: trade.mintAddress },
    update: {
      symbol: ctx.fallbackSymbol,
      name: ctx.fallbackName,
      imageUri: ctx.imageUri ?? undefined,
      metadataUri: ctx.metadataUri ?? undefined,
      twitter: ctx.twitter ?? undefined,
      telegram: ctx.telegram ?? undefined,
      website: ctx.website ?? undefined,
      description: ctx.description ?? undefined,
      creatorAddress: ctx.creatorAddress,
      bondingCurve: bondingCurveAddress ?? undefined,
      associatedBondingCurve: associatedBondingCurve ?? undefined,
    },
    create: {
      mintAddress: trade.mintAddress,
      symbol: ctx.fallbackSymbol,
      name: ctx.fallbackName,
      imageUri: ctx.imageUri ?? null,
      metadataUri: ctx.metadataUri ?? null,
      twitter: ctx.twitter ?? null,
      telegram: ctx.telegram ?? null,
      website: ctx.website ?? null,
      description: ctx.description ?? null,
      creatorAddress: ctx.creatorAddress,
      createdTimestamp: BigInt(ctx.createdTs),
      kingOfTheHillTimestamp: reachedKoth ? kothTimestamp : null,
      completed: reachedKoth,
      bondingCurve: bondingCurveAddress ?? null,
      associatedBondingCurve: associatedBondingCurve ?? null,
    },
    select: {
      id: true,
      completed: true,
      kingOfTheHillTimestamp: true,
      createdTimestamp: true,
    },
  })

  if (reachedKoth && (!token.completed || !token.kingOfTheHillTimestamp)) {
    await prisma.token.update({
      where: { id: token.id },
      data: {
        completed: true,
        kingOfTheHillTimestamp: token.kingOfTheHillTimestamp ?? kothTimestamp,
      },
    })
  } else if (explicitlyBonding && (token.completed || token.kingOfTheHillTimestamp !== null)) {
    await prisma.token.update({
      where: { id: token.id },
      data: {
        completed: false,
        kingOfTheHillTimestamp: null,
      },
    })
  }

  const storedCreatedTimestampMs =
    typeof token.createdTimestamp === "bigint" ? Number(token.createdTimestamp) : null
  const creationLikelyFallback =
    !ctx.hasFeedCreatedTimestamp &&
    (!storedCreatedTimestampMs ||
      ctx.timestampMs - storedCreatedTimestampMs < CREATION_TIMESTAMP_FALLBACK_WINDOW_MS)

  const needsMetadataRetry =
    !ctx.metadataUri ||
    !ctx.imageUri ||
    looksLikeMintPrefix(ctx.fallbackName, trade.mintAddress) ||
    looksLikeMintPrefix(ctx.fallbackSymbol, trade.mintAddress) ||
    creationLikelyFallback

  if (needsMetadataRetry) {
    scheduleMetadataRetry(trade.mintAddress)
  }

  await prisma.tokenPrice.upsert({
    where: { tokenId: token.id },
    update: {
      priceSol: ctx.priceSol,
      priceUsd: ctx.priceUsd,
      marketCapUsd: ctx.marketCapUsd,
      lastTradeTimestamp: BigInt(ctx.timestampMs),
    },
    create: {
      tokenId: token.id,
      priceSol: ctx.priceSol,
      priceUsd: ctx.priceUsd,
      marketCapUsd: ctx.marketCapUsd,
      lastTradeTimestamp: BigInt(ctx.timestampMs),
    },
  })

  try {
    await prisma.trade.upsert({
      where: { txSignature: trade.tx },
      update: {},
      create: {
        tokenId: token.id,
        txSignature: trade.tx,
        userAddress: trade.userAddress ?? "unknown",
        isBuy: ctx.isBuy,
        amountSol: ctx.amountSol,
        amountUsd: ctx.amountUsd,
        baseAmount: ctx.baseAmountRaw,
        priceSol: ctx.priceSol,
        priceUsd: ctx.priceUsd,
        timestamp: BigInt(ctx.timestampMs),
        raw: trade as Prisma.InputJsonValue,
      },
    })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      trade.tx
    ) {
      // Duplicate trade already recorded; treat as success.
    } else {
      throw error
    }
  }
}

async function processTradeBatch(batch: PumpUnifiedTrade[]): Promise<void> {
  if (batch.length === 0) return

  const solPriceUsd = await getSolPriceUsd()
  const prepared = (
    await Promise.all(batch.map((trade) => prepareTradeContext(trade, solPriceUsd)))
  ).filter(Boolean) as PreparedTradeContext[]

  if (prepared.length === 0) return

  for (const ctx of prepared) {
    try {
      await persistPreparedTrade(ctx)
      console.log(
        `📊 [${ctx.logSymbol}] ${ctx.isBuy ? "BUY" : "SELL"} | ${ctx.amountSol.toString()} SOL @ ${ctx.priceSol.toString()}`,
      )
    } catch (error) {
      console.error(`[ingest] Failed to persist trade ${ctx.trade.tx}:`, (error as Error).message)
    }
  }
}

async function scheduleQueueProcessing() {
  if (isProcessingQueue) return
  isProcessingQueue = true

  try {
    while (tradeQueue.length > 0) {
      const batch = tradeQueue.splice(0, 50)
      try {
        await processTradeBatch(batch)
      } catch (error) {
        console.error("❌ Error processing batch:", (error as Error).message)
        tradeQueue.unshift(...batch)
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
  } finally {
    isProcessingQueue = false
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    console.log("[ingest] Reconnecting to feed…")
    connectToFeed()
  }, 2000)
}

function handleMessageChunk(chunk: string) {
  messageBuffer += chunk

  while (messageBuffer.length > 0) {
    if (messageBuffer.startsWith("PING")) {
      ws?.send("PONG\r\n")
      const newline = messageBuffer.indexOf("\r\n")
      messageBuffer = newline === -1 ? "" : messageBuffer.slice(newline + 2)
      continue
    }

    if (messageBuffer.startsWith("PONG") || messageBuffer.startsWith("+OK")) {
      const newline = messageBuffer.indexOf("\r\n")
      messageBuffer = newline === -1 ? "" : messageBuffer.slice(newline + 2)
      continue
    }

    if (messageBuffer.startsWith("INFO")) {
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
      void scheduleQueueProcessing()
    }
  }
}

function connectToFeed() {
  ws = new WebSocket(NATS_URL, { headers: NATS_HEADERS })

  ws.once("open", () => {
    console.log("✅ Connected to Pump.fun unified trade feed")
    messageBuffer = ""
    ws?.send(`CONNECT ${JSON.stringify(NATS_CONNECT_PAYLOAD)}\r\n`)
    ws?.send("PING\r\n")
    SUBJECTS.forEach((subject, idx) => {
      const sid = `sub${idx}`
      ws?.send(`SUB ${subject} ${sid}\r\n`)
    })
  })

  ws.on("message", (data) => {
    handleMessageChunk(data.toString())
  })

  ws.on("close", (code) => {
    console.warn(`[ingest] Connection closed (${code})`)
    scheduleReconnect()
  })

  ws.on("error", (error) => {
    console.error("[ingest] websocket error:", (error as Error).message)
    ws?.close()
  })
}

async function cleanupOldTrades() {
  const cutoffMs = Date.now() - TRADE_RETENTION_MS
  const cutoffBigInt = BigInt(cutoffMs)

  try {
    await prisma.trade.deleteMany({
      where: {
        timestamp: {
          lt: cutoffBigInt,
        },
      },
    })
  } catch (error) {
    console.error("[ingest] Failed to cleanup old trades:", (error as Error).message)
  }
}

console.log("🚀 Starting trade ingestion service…")
connectToFeed()
void cleanupOldTrades()
setInterval(() => {
  void cleanupOldTrades()
}, CLEANUP_INTERVAL_MS)

process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down…")
  ws?.close()
  await prisma.$disconnect()
  process.exit(0)
})

process.on("SIGTERM", async () => {
  console.log("\n🛑 Shutting down…")
  ws?.close()
  await prisma.$disconnect()
  process.exit(0)
})
