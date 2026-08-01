import { Prisma, type TokenLifecycleStatus } from "@/generated/prisma/client"

import { prisma } from "@/lib/prisma"
import { toPublicLifecycle } from "@/lib/token-lifecycle"
import type {
  TokenData,
  TokenQueryFilters,
  TokenQueryRequest,
  TokenSortBy,
} from "@/types/token-data"

const MIN_TIME_RANGE_MINUTES = 1
const MAX_TIME_RANGE_MINUTES = 60
const MAX_PAGE_SIZE = 100

interface TokenQueryRow {
  mint: string
  name: string
  symbol: string
  image_uri: string | null
  metadata_uri: string | null
  description: string | null
  creator: string
  created_timestamp: bigint
  website: string | null
  twitter: string | null
  telegram: string | null
  king_of_the_hill_timestamp: bigint | null
  lifecycle_status: TokenLifecycleStatus
  lifecycle_verified_at: Date | null
  pump_swap_pool: string | null
  bonding_progress: number | null
  bonding_curve: string | null
  associated_bonding_curve: string | null
  launch_source: string
  trade_venue: string
  source_verified_at: Date | null
  trade_venue_updated_at: Date | null
  price_sol: Prisma.Decimal | null
  price_usd: Prisma.Decimal | null
  usd_market_cap: Prisma.Decimal | null
  total_volume: Prisma.Decimal | null
  total_volume_usd: Prisma.Decimal | null
  buy_volume: Prisma.Decimal | null
  buy_volume_usd: Prisma.Decimal | null
  sell_volume: Prisma.Decimal | null
  sell_volume_usd: Prisma.Decimal | null
  unique_trader_count: bigint
  last_trade_timestamp: bigint | null
  total_count: bigint
}

export interface TokenSnapshot {
  page: number
  pageSize: number
  total: number
  totalPages: number
  effectiveTimeRangeMinutes: number
  sol_price_usd: number
  sol_price_updated_at: string | null
  tokens: TokenData[]
}

export interface ConsistentTokenSnapshot extends TokenSnapshot {
  revision: bigint
}

interface TokenQueryMetrics {
  hits: number
  misses: number
  computations: number
  failures: number
  totalLatencyMs: number
  lastLatencyMs: number
}

const queryMetrics: TokenQueryMetrics = {
  hits: 0,
  misses: 0,
  computations: 0,
  failures: 0,
  totalLatencyMs: 0,
  lastLatencyMs: 0,
}
const snapshotCache = new Map<string, { expiresAt: number; promise: Promise<ConsistentTokenSnapshot> }>()
const SNAPSHOT_CACHE_MAX = 100
const SNAPSHOT_CACHE_TTL_MS = 1_000
let revisionReadCache: { expiresAt: number; promise: Promise<bigint> } | null = null

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function nullableFinite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeFilters(filters?: TokenQueryFilters): Required<
  Pick<TokenQueryFilters, "hideExternal" | "graduationFilter" | "favoritesOnly">
> &
  TokenQueryFilters {
  return {
    ...filters,
    hideExternal: filters?.hideExternal ?? false,
    graduationFilter: filters?.graduationFilter ?? "all",
    favoritesOnly: filters?.favoritesOnly ?? false,
  }
}

export function normalizeTokenQuery(body: Partial<TokenQueryRequest>): TokenQueryRequest {
  const sortValues: TokenSortBy[] = [
    "marketCap",
    "totalVolume",
    "buyVolume",
    "sellVolume",
    "uniqueTraders",
    "tokenAge",
    "lastTrade",
  ]
  const requestedSort = body.sortBy as TokenSortBy
  return {
    page: Math.max(1, Math.floor(finiteNumber(body.page, 1))),
    pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(finiteNumber(body.pageSize, 12)))),
    sortBy: sortValues.includes(requestedSort) ? requestedSort : "marketCap",
    sortOrder: body.sortOrder === "asc" ? "asc" : "desc",
    timeRangeMinutes: Math.min(
      MAX_TIME_RANGE_MINUTES,
      Math.max(MIN_TIME_RANGE_MINUTES, finiteNumber(body.timeRangeMinutes, 10)),
    ),
    filters: normalizeFilters(body.filters),
    favoriteMints: Array.from(
      new Set((body.favoriteMints ?? []).filter((mint): mint is string => typeof mint === "string" && mint.length > 0)),
    ),
  }
}

export function normalizedTokenQueryKey(body: Partial<TokenQueryRequest>): string {
  const query = normalizeTokenQuery(body)
  return JSON.stringify({
    ...query,
    favoriteMints: [...query.favoriteMints].sort(),
    filters: Object.fromEntries(Object.entries(query.filters).sort(([a], [b]) => a.localeCompare(b))),
  })
}

const SORT_SQL: Record<TokenSortBy, Prisma.Sql> = {
  marketCap: Prisma.sql`usd_market_cap`,
  totalVolume: Prisma.sql`total_volume_usd`,
  buyVolume: Prisma.sql`buy_volume_usd`,
  sellVolume: Prisma.sql`sell_volume_usd`,
  uniqueTraders: Prisma.sql`unique_trader_count`,
  tokenAge: Prisma.sql`created_timestamp`,
  lastTrade: Prisma.sql`last_trade_timestamp`,
}

function numberOf(value: Prisma.Decimal | bigint | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  return Number(value)
}

function rowToToken(row: TokenQueryRow): TokenData {
  const lifecycle = toPublicLifecycle(row.lifecycle_status)
  const completed = lifecycle === "curve_complete" || lifecycle === "pumpswap"
  const priceSol = numberOf(row.price_sol)
  const lastTradeTimestamp = numberOf(row.last_trade_timestamp)

  return {
    mint: row.mint,
    name: row.name,
    symbol: row.symbol,
    image_uri: row.image_uri ?? "",
    image_metadata_uri: row.metadata_uri,
    metadata_uri: row.metadata_uri,
    description: row.description,
    usd_market_cap: numberOf(row.usd_market_cap),
    market_cap: priceSol * 1_000_000_000,
    price_sol: priceSol,
    price_usd: numberOf(row.price_usd),
    creator: row.creator,
    creator_username: "",
    total_supply: 1_000_000_000,
    virtual_sol_reserves: 0,
    virtual_token_reserves: 0,
    buy_sell_ratio:
      numberOf(row.total_volume) > 0 ? numberOf(row.buy_volume) / numberOf(row.total_volume) : 0,
    total_volume: numberOf(row.total_volume),
    total_volume_usd: numberOf(row.total_volume_usd),
    buy_volume: numberOf(row.buy_volume),
    buy_volume_usd: numberOf(row.buy_volume_usd),
    sell_volume: numberOf(row.sell_volume),
    sell_volume_usd: numberOf(row.sell_volume_usd),
    unique_trader_count: numberOf(row.unique_trader_count),
    last_trade_time: Math.floor(lastTradeTimestamp / 1000),
    last_trade_timestamp: lastTradeTimestamp,
    created_timestamp: numberOf(row.created_timestamp),
    website: row.website,
    twitter: row.twitter,
    telegram: row.telegram,
    king_of_the_hill_timestamp: row.king_of_the_hill_timestamp
      ? numberOf(row.king_of_the_hill_timestamp)
      : null,
    lifecycle_status: lifecycle,
    lifecycle_verified_at: row.lifecycle_verified_at?.toISOString() ?? null,
    pump_swap_pool: row.pump_swap_pool,
    bonding_progress: row.bonding_progress,
    is_completed: completed,
    is_bonding_curve: lifecycle === "unknown" ? null : lifecycle === "bonding",
    bonding_curve: row.bonding_curve,
    associated_bonding_curve: row.associated_bonding_curve,
    launch_source: row.launch_source.toLowerCase() as TokenData["launch_source"],
    trade_venue: row.trade_venue.toLowerCase() as TokenData["trade_venue"],
    source_verified_at: row.source_verified_at?.toISOString() ?? null,
    trade_venue_updated_at: row.trade_venue_updated_at?.toISOString() ?? null,
    trades: [],
  }
}

export async function queryTokenSnapshot(
  rawBody: Partial<TokenQueryRequest>,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<TokenSnapshot> {
  const request = normalizeTokenQuery(rawBody)
  const effectiveTimeRangeMinutes = request.timeRangeMinutes
  const cutoff = BigInt(Date.now() - effectiveTimeRangeMinutes * 60_000)
  const aggregateBoundary = BigInt(Math.ceil(Number(cutoff) / 60_000) * 60_000)
  const now = BigInt(Date.now())
  const filters = request.filters
  const favorites = request.favoriteMints
  const minTradeAmount = nullableFinite(filters.minTradeAmount) ?? 0
  const maxTradeAmount = nullableFinite(filters.maxTradeAmount)
  const hasTradeAmountFilter =
    (nullableFinite(filters.minTradeAmount) ?? 0) > 0 || nullableFinite(filters.maxTradeAmount) !== null
  const offset = (request.page - 1) * request.pageSize
  const direction = request.sortOrder === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`
  const tradeStatsSql =
    process.env.TOKEN_AGGREGATES_ENABLED === "true"
      ? Prisma.sql`
          SELECT
            token_id,
            SUM(total_volume) AS total_volume,
            SUM(total_volume_usd) AS total_volume_usd,
            SUM(buy_volume) AS buy_volume,
            SUM(buy_volume_usd) AS buy_volume_usd,
            SUM(sell_volume) AS sell_volume,
            SUM(sell_volume_usd) AS sell_volume_usd,
            MAX(last_trade_timestamp) AS last_trade_timestamp
          FROM (
            SELECT
              token_id,
              volume_sol AS total_volume,
              volume_usd AS total_volume_usd,
              buy_volume_sol AS buy_volume,
              buy_volume_usd,
              sell_volume_sol AS sell_volume,
              sell_volume_usd,
              last_trade_timestamp
            FROM token_minute_aggregates
            WHERE minute >= to_timestamp(${aggregateBoundary} / 1000.0)
            UNION ALL
            SELECT
              token_id,
              SUM(amount_sol),
              SUM(amount_usd),
              SUM(amount_sol) FILTER (WHERE is_buy),
              SUM(amount_usd) FILTER (WHERE is_buy),
              SUM(amount_sol) FILTER (WHERE NOT is_buy),
              SUM(amount_usd) FILTER (WHERE NOT is_buy),
              MAX(timestamp)
            FROM trades
            WHERE timestamp >= ${cutoff} AND timestamp < ${aggregateBoundary}
            GROUP BY token_id
          ) exact_stats
          GROUP BY token_id
        `
      : Prisma.sql`
          SELECT
            token_id,
            SUM(amount_sol) AS total_volume,
            SUM(amount_usd) AS total_volume_usd,
            SUM(amount_sol) FILTER (WHERE is_buy) AS buy_volume,
            SUM(amount_usd) FILTER (WHERE is_buy) AS buy_volume_usd,
            SUM(amount_sol) FILTER (WHERE NOT is_buy) AS sell_volume,
            SUM(amount_usd) FILTER (WHERE NOT is_buy) AS sell_volume_usd,
            MAX(timestamp) AS last_trade_timestamp
          FROM trades
          WHERE timestamp >= ${cutoff}
          GROUP BY token_id
        `

  const buyerStatsSql =
    process.env.TOKEN_BUYER_AGGREGATES_ENABLED !== "false" && !hasTradeAmountFilter
      ? Prisma.sql`
          SELECT token_id, COUNT(DISTINCT buyer_address)::bigint AS unique_trader_count
          FROM (
            SELECT token_id, buyer_address
            FROM token_buyer_minute_aggregates
            WHERE minute >= to_timestamp(${aggregateBoundary} / 1000.0)
            UNION
            SELECT token_id, user_address AS buyer_address
            FROM trades
            WHERE timestamp >= ${cutoff} AND timestamp < ${aggregateBoundary} AND is_buy
          ) exact_buyers
          GROUP BY token_id
        `
      : Prisma.sql`
          SELECT token_id, COUNT(DISTINCT user_address)::bigint AS unique_trader_count
          FROM trades
          WHERE timestamp >= ${cutoff} AND is_buy
            AND amount_usd >= ${minTradeAmount}
            AND (${maxTradeAmount}::double precision IS NULL OR amount_usd <= ${maxTradeAmount})
          GROUP BY token_id
        `

  const rows = await client.$queryRaw<TokenQueryRow[]>(Prisma.sql`
    WITH trade_stats AS (
      ${tradeStatsSql}
    ),
    buyer_stats AS (
      ${buyerStatsSql}
    ),
    filtered AS (
      SELECT
        t.mint_address AS mint,
        t.name,
        t.symbol,
        t.image_uri,
        t.metadata_uri,
        t.description,
        t.creator_address AS creator,
        t.created_timestamp,
        t.website,
        t.twitter,
        t.telegram,
        NULL::bigint AS king_of_the_hill_timestamp,
        t.lifecycle_status,
        t.lifecycle_verified_at,
        t.pump_swap_pool,
        t.bonding_progress,
        t.bonding_curve,
        t.associated_bonding_curve,
        t.launch_source,
        t.trade_venue,
        t.source_verified_at,
        t.trade_venue_updated_at,
        p.price_sol,
        p.price_usd,
        p.market_cap_usd AS usd_market_cap,
        COALESCE(s.total_volume, 0) AS total_volume,
        COALESCE(s.total_volume_usd, 0) AS total_volume_usd,
        COALESCE(s.buy_volume, 0) AS buy_volume,
        COALESCE(s.buy_volume_usd, 0) AS buy_volume_usd,
        COALESCE(s.sell_volume, 0) AS sell_volume,
        COALESCE(s.sell_volume_usd, 0) AS sell_volume_usd,
        COALESCE(b.unique_trader_count, 0)::bigint AS unique_trader_count,
        s.last_trade_timestamp
      FROM tokens t
      LEFT JOIN trade_stats s ON s.token_id = t.id
      LEFT JOIN buyer_stats b ON b.token_id = t.id
      LEFT JOIN token_prices p ON p.token_id = t.id
      WHERE
        (${filters.favoritesOnly} = false AND s.token_id IS NOT NULL
          OR ${filters.favoritesOnly} = true AND t.mint_address IN (${Prisma.join(favorites.length ? favorites : ["__none__"])}))
        AND (${filters.hideExternal} = false OR t.lifecycle_status <> 'NON_LAUNCHPAD'::"TokenLifecycleStatus")
        AND (${filters.graduationFilter} <> 'bonding' OR t.lifecycle_status = 'BONDING'::"TokenLifecycleStatus")
        AND (${filters.graduationFilter} <> 'graduated' OR t.lifecycle_status IN ('CURVE_COMPLETE'::"TokenLifecycleStatus", 'PUMPSWAP'::"TokenLifecycleStatus", 'NON_LAUNCHPAD'::"TokenLifecycleStatus"))
        AND (${nullableFinite(filters.minMarketCap)}::double precision IS NULL OR p.market_cap_usd >= ${nullableFinite(filters.minMarketCap)})
        AND (${nullableFinite(filters.maxMarketCap)}::double precision IS NULL OR p.market_cap_usd <= ${nullableFinite(filters.maxMarketCap)})
        AND (${nullableFinite(filters.minTotalVolume)}::double precision IS NULL OR COALESCE(s.total_volume_usd, 0) >= ${nullableFinite(filters.minTotalVolume)})
        AND (${nullableFinite(filters.maxTotalVolume)}::double precision IS NULL OR COALESCE(s.total_volume_usd, 0) <= ${nullableFinite(filters.maxTotalVolume)})
        AND (${nullableFinite(filters.minBuyVolume)}::double precision IS NULL OR COALESCE(s.buy_volume_usd, 0) >= ${nullableFinite(filters.minBuyVolume)})
        AND (${nullableFinite(filters.maxBuyVolume)}::double precision IS NULL OR COALESCE(s.buy_volume_usd, 0) <= ${nullableFinite(filters.maxBuyVolume)})
        AND (${nullableFinite(filters.minSellVolume)}::double precision IS NULL OR COALESCE(s.sell_volume_usd, 0) >= ${nullableFinite(filters.minSellVolume)})
        AND (${nullableFinite(filters.maxSellVolume)}::double precision IS NULL OR COALESCE(s.sell_volume_usd, 0) <= ${nullableFinite(filters.maxSellVolume)})
        AND (${nullableFinite(filters.minUniqueTraders)}::integer IS NULL OR COALESCE(b.unique_trader_count, 0) >= ${nullableFinite(filters.minUniqueTraders)})
        AND (${nullableFinite(filters.maxUniqueTraders)}::integer IS NULL OR COALESCE(b.unique_trader_count, 0) <= ${nullableFinite(filters.maxUniqueTraders)})
        AND (${nullableFinite(filters.minTokenAgeMinutes)}::double precision IS NULL OR (${now} - t.created_timestamp) >= ${nullableFinite(filters.minTokenAgeMinutes)} * 60000)
        AND (${nullableFinite(filters.maxTokenAgeMinutes)}::double precision IS NULL OR (${now} - t.created_timestamp) <= ${nullableFinite(filters.maxTokenAgeMinutes)} * 60000)
    )
    SELECT *, COUNT(*) OVER()::bigint AS total_count
    FROM filtered
    ORDER BY ${SORT_SQL[request.sortBy]} ${direction} NULLS LAST, mint ${direction}
    LIMIT ${request.pageSize}
    OFFSET ${offset}
  `)

  const total = rows.length ? Number(rows[0].total_count) : 0
  const solPrice = await client.solPriceState.findUnique({ where: { key: "sol-usd" } })
  return {
    page: request.page,
    pageSize: request.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / request.pageSize)),
    effectiveTimeRangeMinutes,
    sol_price_usd: solPrice ? Number(solPrice.priceUsd) : 0,
    sol_price_updated_at: solPrice?.updatedAt.toISOString() ?? null,
    tokens: rows.map(rowToToken),
  }
}

async function computeConsistentTokenSnapshot(
  rawBody: Partial<TokenQueryRequest>,
): Promise<ConsistentTokenSnapshot> {
  const startedAt = Date.now()
  queryMetrics.computations += 1
  try {
    return await prisma.$transaction(async (tx) => {
      const revisionRow = await tx.tokenDataRevision.findUnique({ where: { key: "tokens" } })
      const snapshot = await queryTokenSnapshot(rawBody, tx)
      return { ...snapshot, revision: revisionRow?.revision ?? BigInt(0) }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 5_000, maxWait: 5_000 })
  } catch (error) {
    queryMetrics.failures += 1
    throw error
  } finally {
    const latency = Date.now() - startedAt
    queryMetrics.lastLatencyMs = latency
    queryMetrics.totalLatencyMs += latency
  }
}

export async function getConsistentTokenSnapshot(
  rawBody: Partial<TokenQueryRequest>,
): Promise<ConsistentTokenSnapshot> {
  if (process.env.TOKEN_QUERY_CACHE_ENABLED === "false") {
    queryMetrics.misses += 1
    return computeConsistentTokenSnapshot(rawBody)
  }
  const now = Date.now()
  const observedRevision = await getTokenDataRevision()
  const key = `${observedRevision}:${normalizedTokenQueryKey(rawBody)}`
  const cached = snapshotCache.get(key)
  if (cached && cached.expiresAt > now) {
    queryMetrics.hits += 1
    return cached.promise
  }
  if (cached) snapshotCache.delete(key)
  queryMetrics.misses += 1
  const promise = computeConsistentTokenSnapshot(rawBody).catch((error) => {
    if (snapshotCache.get(key)?.promise === promise) snapshotCache.delete(key)
    throw error
  })
  snapshotCache.set(key, { expiresAt: now + SNAPSHOT_CACHE_TTL_MS, promise })
  while (snapshotCache.size > SNAPSHOT_CACHE_MAX) {
    const oldest = snapshotCache.keys().next().value as string | undefined
    if (!oldest) break
    snapshotCache.delete(oldest)
  }
  return promise
}

export function getTokenQueryMetrics() {
  const requests = queryMetrics.hits + queryMetrics.misses
  return {
    ...queryMetrics,
    cacheEntries: snapshotCache.size,
    hitRate: requests > 0 ? queryMetrics.hits / requests : 0,
    averageLatencyMs: queryMetrics.computations > 0
      ? queryMetrics.totalLatencyMs / queryMetrics.computations
      : 0,
  }
}

export function getTokenDataRevision(): Promise<bigint> {
  const now = Date.now()
  if (revisionReadCache && revisionReadCache.expiresAt > now) return revisionReadCache.promise
  const promise = prisma.tokenDataRevision.findUnique({ where: { key: "tokens" } })
    .then((revision) => revision?.revision ?? BigInt(0))
    .catch((error) => {
      if (revisionReadCache?.promise === promise) revisionReadCache = null
      throw error
    })
  revisionReadCache = { expiresAt: now + 1_000, promise }
  return promise
}

export async function getTokenRevisionChanges(
  afterRevision: bigint,
  throughRevision: bigint,
): Promise<{ changes: Array<{ mintAddress: string; changeKind: string }>; hasGap: boolean }> {
  const [oldest, rows] = await Promise.all([
    prisma.tokenDirtyMint.findFirst({ orderBy: { revision: "asc" }, select: { revision: true } }),
    prisma.tokenDirtyMint.findMany({
    where: {
      revision: { gt: afterRevision, lte: throughRevision },
    },
      select: { mintAddress: true, changeKinds: true },
    }),
  ])
  return {
    changes: rows.flatMap((row) =>
      row.changeKinds.map((changeKind) => ({ mintAddress: row.mintAddress, changeKind })),
    ),
    hasGap: oldest === null || afterRevision < oldest.revision - BigInt(1),
  }
}
