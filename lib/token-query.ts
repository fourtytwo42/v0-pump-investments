import { Prisma, type TokenLifecycleStatus } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { toPublicLifecycle } from "@/lib/token-lifecycle"
import type {
  TokenData,
  TokenQueryFilters,
  TokenQueryRequest,
  TokenSortBy,
} from "@/types/token-data"

const MIN_TIME_RANGE_MINUTES = 1
const FALLBACK_TIME_RANGE_MINUTES = 30
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
  bonding_curve: string | null
  associated_bonding_curve: string | null
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
  tokens: TokenData[]
}

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
  Pick<TokenQueryFilters, "hideExternal" | "hideKOTH" | "graduationFilter" | "favoritesOnly">
> &
  TokenQueryFilters {
  return {
    ...filters,
    hideExternal: filters?.hideExternal ?? false,
    hideKOTH: filters?.hideKOTH ?? false,
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
    is_completed: completed,
    is_bonding_curve: lifecycle === "unknown" ? null : lifecycle === "bonding",
    bonding_curve: row.bonding_curve,
    associated_bonding_curve: row.associated_bonding_curve,
    trades: [],
  }
}

async function resolveEffectiveRange(requestedMinutes: number): Promise<number> {
  if (requestedMinutes >= FALLBACK_TIME_RANGE_MINUTES) return requestedMinutes
  const cutoff = BigInt(Date.now() - requestedMinutes * 60_000)
  const recentCount = await prisma.trade.count({ where: { timestamp: { gte: cutoff } } })
  return recentCount === 0 ? FALLBACK_TIME_RANGE_MINUTES : requestedMinutes
}

export async function queryTokenSnapshot(rawBody: Partial<TokenQueryRequest>): Promise<TokenSnapshot> {
  const request = normalizeTokenQuery(rawBody)
  const effectiveTimeRangeMinutes = await resolveEffectiveRange(request.timeRangeMinutes)
  const cutoff = BigInt(Date.now() - effectiveTimeRangeMinutes * 60_000)
  const now = BigInt(Date.now())
  const filters = request.filters
  const favorites = request.favoriteMints
  const minTradeAmount = nullableFinite(filters.minTradeAmount) ?? 0
  const maxTradeAmount = nullableFinite(filters.maxTradeAmount)
  const offset = (request.page - 1) * request.pageSize
  const direction = request.sortOrder === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`

  const rows = await prisma.$queryRaw<TokenQueryRow[]>(Prisma.sql`
    WITH trade_stats AS (
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
    ),
    buyer_totals AS (
      SELECT token_id, user_address, SUM(amount_usd) AS buyer_total_usd
      FROM trades
      WHERE timestamp >= ${cutoff} AND is_buy
      GROUP BY token_id, user_address
    ),
    buyer_stats AS (
      SELECT token_id, COUNT(*)::bigint AS unique_trader_count
      FROM buyer_totals
      WHERE buyer_total_usd >= ${minTradeAmount}
        AND (${maxTradeAmount}::double precision IS NULL OR buyer_total_usd <= ${maxTradeAmount})
      GROUP BY token_id
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
        t.king_of_the_hill_timestamp,
        t.lifecycle_status,
        t.lifecycle_verified_at,
        t.pump_swap_pool,
        t.bonding_curve,
        t.associated_bonding_curve,
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
        AND (${filters.hideKOTH} = false OR t.king_of_the_hill_timestamp IS NULL)
        AND (${filters.graduationFilter} <> 'bonding' OR t.lifecycle_status = 'BONDING'::"TokenLifecycleStatus")
        AND (${filters.graduationFilter} <> 'graduated' OR t.lifecycle_status IN ('CURVE_COMPLETE'::"TokenLifecycleStatus", 'PUMPSWAP'::"TokenLifecycleStatus"))
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
  return {
    page: request.page,
    pageSize: request.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / request.pageSize)),
    effectiveTimeRangeMinutes,
    tokens: rows.map(rowToToken),
  }
}

export async function getTokenDataRevision(): Promise<bigint> {
  const revision = await prisma.tokenDataRevision.findUnique({ where: { key: "tokens" } })
  return revision?.revision ?? BigInt(0)
}
