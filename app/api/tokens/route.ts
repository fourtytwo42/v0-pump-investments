import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { type TokenData, type TokenQueryOptions } from "@/types/token-data"
import { Decimal } from "@prisma/client/runtime/library"
import { fetchPumpCoin, PUMP_HEADERS } from "@/lib/pump-coin"
import { normalizeTokenMetadata } from "@/lib/token-metadata"
import { normalizeIpfsUri } from "@/lib/pump-trades"

const metadataCache = new Map<
  string,
  {
    image?: string | null
    description?: string | null
    twitter?: string | null
    telegram?: string | null
    website?: string | null
    name?: string | null
    symbol?: string | null
  }
>()


function looksLikeMintPrefix(value: string | null | undefined, mint: string): boolean {
  if (!value) return true
  const cleaned = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase()
  if (!cleaned) return true
  if (cleaned.length < 3) return false
  return mint.toUpperCase().startsWith(cleaned)
}

async function fetchMetadata(uri: string): Promise<{
  image?: string | null
  description?: string | null
  twitter?: string | null
  telegram?: string | null
  website?: string | null
  name?: string | null
  symbol?: string | null
}> {
  if (!uri) {
    return {}
  }

  if (metadataCache.has(uri)) {
    return metadataCache.get(uri) ?? {}
  }

  const normalizedUri = normalizeIpfsUri(uri) ?? uri

  try {
    const response = await fetch(normalizedUri, {
      cache: "no-store",
      headers: {
        ...PUMP_HEADERS,
        accept: "application/json",
      },
    })
    if (!response.ok) {
      throw new Error(`metadata fetch ${response.status}`)
    }

    const json = await response.json()
    const image = typeof json?.image === "string" ? json.image : null
    const description = typeof json?.description === "string" ? json.description : null
    const twitter = typeof json?.twitter === "string" ? json.twitter : null
    const telegram = typeof json?.telegram === "string" ? json.telegram : null
    const website = typeof json?.website === "string" ? json.website : null

    const name = typeof json?.name === "string" ? json.name : null
      const symbol = typeof json?.symbol === "string" ? json.symbol : null

      const normalized = { image, description, twitter, telegram, website, name, symbol }
    metadataCache.set(uri, normalized)
    return normalized
  } catch (error) {
    console.warn("[api/tokens] metadata fetch failed", normalizedUri, (error as Error).message)
    metadataCache.set(uri, {})
    return {}
  }
}

export const dynamic = "force-dynamic"

function normalizeNumber(value: Decimal | number | bigint | null | undefined): number {
  if (value === null || value === undefined) {
    return 0
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0
  }

  if (typeof value === "bigint") {
    return Number(value)
  }

  try {
    return Number((value as Decimal).toString())
  } catch {
    return 0
  }
}

function passesFilters(
  token: AggregatedToken,
  filters: TokenQueryFilters,
  favorites: Set<string>,
): boolean {
  if (filters.favoritesOnly && !favorites.has(token.mint)) {
    return false
  }

  if (filters.hideKOTH && token.king_of_the_hill_timestamp) {
    return false
  }

  if (filters.hideExternal && !token.mint.endsWith("pump")) {
    return false
  }

  if (filters.graduationFilter === "bonding" && token.is_completed) {
    return false
  }

  if (filters.graduationFilter === "graduated" && !token.is_completed) {
    return false
  }

  const withinRange = (
    value: number,
    min?: number,
    max?: number,
    options: { inclusiveMin?: boolean; inclusiveMax?: boolean } = {},
  ) => {
    const { inclusiveMin = true, inclusiveMax = true } = options
    if (min !== undefined && min !== null) {
      if (inclusiveMin ? value < min : value <= min) return false
    }
    if (max !== undefined && max !== null) {
      if (inclusiveMax ? value > max : value >= max) return false
    }
    return true
  }

  if (!withinRange(token.usd_market_cap, filters.minMarketCap, filters.maxMarketCap)) {
    return false
  }

  if (!withinRange(token.total_volume_usd, filters.minTotalVolume, filters.maxTotalVolume)) {
    return false
  }

  if (!withinRange(token.buy_volume_usd, filters.minBuyVolume, filters.maxBuyVolume)) {
    return false
  }

  if (!withinRange(token.sell_volume_usd, filters.minSellVolume, filters.maxSellVolume)) {
    return false
  }

  if (!withinRange(token.unique_trader_count, filters.minUniqueTraders, filters.maxUniqueTraders)) {
    return false
  }

  return true
}

interface AggregatedMetrics {
  totalVolumeSol: number
  totalVolumeUsd: number
  buyVolumeSol: number
  buyVolumeUsd: number
  sellVolumeSol: number
  sellVolumeUsd: number
  lastTradeTimestamp: number
  userTotals: Map<string, number>
}

interface AggregatedToken {
  mint: string
  name: string
  symbol: string
  image_uri: string
  image_metadata_uri: string | null
  metadata_uri: string | null
  description: string | null
  usd_market_cap: number
  market_cap: number
  price_sol: number
  price_usd: number
  creator: string
  creator_username: string
  total_supply: number
  virtual_sol_reserves: number
  virtual_token_reserves: number
  buy_sell_ratio: number
  total_volume: number
  total_volume_usd: number
  buy_volume: number
  buy_volume_usd: number
  sell_volume: number
  sell_volume_usd: number
  unique_trader_count: number
  last_trade_time: number
  last_trade_timestamp?: number
  created_timestamp?: number
  website?: string | null
  twitter?: string | null
  telegram?: string | null
  king_of_the_hill_timestamp?: number | null
  is_completed: boolean
  is_bonding_curve: boolean
  bonding_curve?: string | null
  associated_bonding_curve?: string | null
  trades: []
}

function sortTokens(tokens: AggregatedToken[], sortBy: string, sortOrder: "asc" | "desc") {
  const direction = sortOrder === "asc" ? 1 : -1

  const getSortableValue = (token: AggregatedToken) => {
    switch (sortBy) {
      case "marketCap":
        return token.usd_market_cap
      case "totalVolume":
        return token.total_volume_usd
      case "buyVolume":
        return token.buy_volume_usd
      case "sellVolume":
        return token.sell_volume_usd
      case "uniqueTraders":
        return token.unique_trader_count
      case "tokenAge":
        return token.created_timestamp ?? 0
      case "lastTrade":
        return token.last_trade_time
      default:
        return token.usd_market_cap
    }
  }

  return [...tokens].sort((a, b) => {
    const aValue = getSortableValue(a)
    const bValue = getSortableValue(b)

    if (aValue === bValue) {
      return a.mint.localeCompare(b.mint) * direction
    }

    return aValue > bValue ? direction : -direction
  })
}

const MIN_REQUESTED_TIME_RANGE_MINUTES = 1
const FALLBACK_MIN_TIME_RANGE_MINUTES = 30
const MAX_LOOKBACK_MINUTES = 60

async function fetchTradesSince(minutes: number) {
  const cutoffMs = Date.now() - minutes * 60 * 1000
  const cutoffBigInt = BigInt(cutoffMs)

  const trades = await prisma.trade.findMany({
    where: {
      timestamp: {
        gte: cutoffBigInt,
      },
    },
    select: {
      tokenId: true,
      timestamp: true,
      isBuy: true,
      amountSol: true,
      amountUsd: true,
      baseAmount: true,
      userAddress: true,
    },
  })

  return { trades, cutoffBigInt }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<TokenQueryRequest>

    const page = Number(body.page ?? 1)
    const pageSize = Number(body.pageSize ?? 12)
    const sortBy = body.sortBy ?? "marketCap"
    const sortOrder = (body.sortOrder ?? "desc") as "asc" | "desc"
    const requestedTimeRangeMinutes = Number(body.timeRangeMinutes ?? 10)
    let effectiveTimeRangeMinutes = Number.isFinite(requestedTimeRangeMinutes)
      ? Math.min(Math.max(requestedTimeRangeMinutes, MIN_REQUESTED_TIME_RANGE_MINUTES), MAX_LOOKBACK_MINUTES)
      : FALLBACK_MIN_TIME_RANGE_MINUTES
    const filters: TokenQueryFilters = {
      hideExternal: body.filters?.hideExternal ?? false,
      hideKOTH: body.filters?.hideKOTH ?? false,
      graduationFilter: body.filters?.graduationFilter ?? "all",
      minMarketCap: body.filters?.minMarketCap,
      maxMarketCap: body.filters?.maxMarketCap,
      minTotalVolume: body.filters?.minTotalVolume,
      maxTotalVolume: body.filters?.maxTotalVolume,
      minBuyVolume: body.filters?.minBuyVolume,
      maxBuyVolume: body.filters?.maxBuyVolume,
      minSellVolume: body.filters?.minSellVolume,
      maxSellVolume: body.filters?.maxSellVolume,
      minUniqueTraders: body.filters?.minUniqueTraders,
      maxUniqueTraders: body.filters?.maxUniqueTraders,
      minTradeAmount: body.filters?.minTradeAmount ?? 0,
      maxTradeAmount: body.filters?.maxTradeAmount,
      favoritesOnly: body.filters?.favoritesOnly ?? false,
    }
    const favoriteMints = new Set((body.favoriteMints ?? []).filter(Boolean))

    let { trades, cutoffBigInt } = await fetchTradesSince(effectiveTimeRangeMinutes)

    if (
      trades.length === 0 &&
      requestedTimeRangeMinutes < FALLBACK_MIN_TIME_RANGE_MINUTES &&
      effectiveTimeRangeMinutes < FALLBACK_MIN_TIME_RANGE_MINUTES
    ) {
      effectiveTimeRangeMinutes = Math.min(FALLBACK_MIN_TIME_RANGE_MINUTES, MAX_LOOKBACK_MINUTES)
      const fallback = await fetchTradesSince(effectiveTimeRangeMinutes)
      trades = fallback.trades
      cutoffBigInt = fallback.cutoffBigInt
    }

    const tokenIds = new Set(trades.map((trade) => trade.tokenId))

    if (filters.favoritesOnly && favoriteMints.size > 0) {
      const favoriteTokens = await prisma.token.findMany({
        where: {
          mintAddress: { in: Array.from(favoriteMints) },
        },
        select: { id: true },
      })
      favoriteTokens.forEach((token) => tokenIds.add(token.id))
    }

    if (tokenIds.size === 0) {
      return NextResponse.json({
        page,
        pageSize,
        totalPages: 1,
        total: 0,
        tokens: [],
        effectiveTimeRangeMinutes,
      })
    }

    const tokenRecords = await prisma.token.findMany({
      where: {
        id: {
          in: Array.from(tokenIds),
        },
      },
      include: {
        price: true,
      },
    })

    const tokensById = new Map(tokenRecords.map((token) => [token.id, token]))

    const metricsByToken = new Map<string, AggregatedMetrics>()

    for (const trade of trades) {
      const tokenId = trade.tokenId
      if (!metricsByToken.has(tokenId)) {
        metricsByToken.set(tokenId, {
          totalVolumeSol: 0,
          totalVolumeUsd: 0,
          buyVolumeSol: 0,
          buyVolumeUsd: 0,
          sellVolumeSol: 0,
          sellVolumeUsd: 0,
          lastTradeTimestamp: 0,
          userTotals: new Map<string, number>(),
        })
      }

      const metrics = metricsByToken.get(tokenId)!

      const amountSol = normalizeNumber(trade.amountSol)
      const amountUsd = normalizeNumber(trade.amountUsd)

      metrics.totalVolumeSol += amountSol
      metrics.totalVolumeUsd += amountUsd

      if (trade.isBuy) {
        metrics.buyVolumeSol += amountSol
        metrics.buyVolumeUsd += amountUsd
      } else {
        metrics.sellVolumeSol += amountSol
        metrics.sellVolumeUsd += amountUsd
      }

      metrics.lastTradeTimestamp = Math.max(metrics.lastTradeTimestamp, normalizeNumber(trade.timestamp))

      if (trade.userAddress) {
        const previous = metrics.userTotals.get(trade.userAddress) ?? 0
        metrics.userTotals.set(trade.userAddress, previous + amountUsd)
      }
    }

    const aggregatedTokens: AggregatedToken[] = []

    const buildTokenRecord = (token: (typeof tokenRecords)[number], metrics?: AggregatedMetrics) => {
      const priceSol = normalizeNumber(token.price?.priceSol)
      const priceUsd = normalizeNumber(token.price?.priceUsd)
      const marketCapUsd = normalizeNumber(token.price?.marketCapUsd)
      const marketCapSol = priceSol * 1_000_000_000
      const createdTs = token.createdTimestamp ? normalizeNumber(token.createdTimestamp) : undefined
      const kothTs = token.kingOfTheHillTimestamp ? normalizeNumber(token.kingOfTheHillTimestamp) : null

      const minTradeAmountThreshold = filters.minTradeAmount ?? 0
      const maxTradeAmountThreshold = filters.maxTradeAmount ?? Number.POSITIVE_INFINITY

      let uniqueTraderCount = 0

      if (metrics?.userTotals) {
        for (const totalUsd of metrics.userTotals.values()) {
          if (totalUsd >= minTradeAmountThreshold && totalUsd <= maxTradeAmountThreshold) {
            uniqueTraderCount += 1
          }
        }
      }

      const totalVolumeSol = metrics?.totalVolumeSol ?? 0
      const totalVolumeUsd = metrics?.totalVolumeUsd ?? 0
      const buyVolumeSol = metrics?.buyVolumeSol ?? 0
      const buyVolumeUsd = metrics?.buyVolumeUsd ?? 0
      const sellVolumeSol = metrics?.sellVolumeSol ?? 0
      const sellVolumeUsd = metrics?.sellVolumeUsd ?? 0
      const lastTradeTimestamp = metrics?.lastTradeTimestamp ?? 0
      const buySellRatio = totalVolumeSol > 0 ? buyVolumeSol / totalVolumeSol : 0

      const normalizedImageUri = normalizeIpfsUri(token.imageUri ?? null) ?? ""
      const normalizedMetadataUri = normalizeIpfsUri(token.metadataUri ?? null) ?? null

      aggregatedTokens.push({
        mint: token.mintAddress,
        name: token.name,
        symbol: token.symbol,
        image_uri: normalizedImageUri,
        image_metadata_uri: normalizedMetadataUri,
        metadata_uri: normalizedMetadataUri,
        description: token.description ?? null,
        usd_market_cap: marketCapUsd,
        market_cap: marketCapSol,
        price_sol: priceSol,
        price_usd: priceUsd,
        creator: token.creatorAddress,
        creator_username: "",
        total_supply: 1_000_000_000,
        virtual_sol_reserves: 0,
        virtual_token_reserves: 0,
        buy_sell_ratio: buySellRatio,
        total_volume: totalVolumeSol,
        total_volume_usd: totalVolumeUsd,
        buy_volume: buyVolumeSol,
        buy_volume_usd: buyVolumeUsd,
        sell_volume: sellVolumeSol,
        sell_volume_usd: sellVolumeUsd,
        unique_trader_count: uniqueTraderCount,
        last_trade_time: Math.floor(lastTradeTimestamp / 1000),
        last_trade_timestamp: lastTradeTimestamp,
        created_timestamp: createdTs,
        website: token.website ?? null,
        twitter: token.twitter ?? null,
        telegram: token.telegram ?? null,
        king_of_the_hill_timestamp: kothTs,
        is_completed: token.completed,
        is_bonding_curve: token.completed ? false : true,
        bonding_curve: token.bondingCurve ?? null,
        associated_bonding_curve: token.associatedBondingCurve ?? null,
        trades: [],
      })
    }

    metricsByToken.forEach((metrics, tokenId) => {
      const token = tokensById.get(tokenId)
      if (!token) {
        return
      }
      buildTokenRecord(token, metrics)
    })

    if (filters.favoritesOnly && favoriteMints.size > 0) {
      tokenRecords.forEach((token) => {
        if (!metricsByToken.has(token.id) && favoriteMints.has(token.mintAddress)) {
          buildTokenRecord(token)
        }
      })
    }

    await Promise.all(
      aggregatedTokens.map(async (token) => {
        let metadataWasHydrated = false

        if (token.metadata_uri) {
          const remoteMetadata = await fetchMetadata(token.metadata_uri)
          if (remoteMetadata) {
            if (remoteMetadata.image && (!token.image_uri || token.image_uri === token.metadata_uri)) {
              token.image_uri = normalizeIpfsUri(remoteMetadata.image) ?? token.image_uri
            }
            if (remoteMetadata.name && looksLikeMintPrefix(token.name, token.mint)) {
              token.name = remoteMetadata.name
            }
            if (remoteMetadata.symbol && looksLikeMintPrefix(token.symbol, token.mint)) {
              token.symbol = remoteMetadata.symbol
            }
            token.description = token.description ?? remoteMetadata.description ?? null
            token.twitter = token.twitter ?? remoteMetadata.twitter ?? null
            token.telegram = token.telegram ?? remoteMetadata.telegram ?? null
            token.website = token.website ?? remoteMetadata.website ?? null
            metadataWasHydrated = true
          }
        }

        if (
          !metadataWasHydrated ||
          !token.metadata_uri ||
          !token.image_uri ||
          token.image_uri === token.metadata_uri ||
          (!token.description && !token.twitter && !token.telegram)
        ) {
          const coinInfo = await fetchPumpCoin(token.mint)
          if (coinInfo && typeof coinInfo === "object") {
            const coinMetadataUri =
              coinInfo.metadataUri ?? coinInfo.metadata_uri ?? coinInfo.uri ?? token.metadata_uri ?? null

            if (!token.metadata_uri && typeof coinMetadataUri === "string") {
              const normalizedUri = normalizeIpfsUri(coinMetadataUri)
              if (normalizedUri) {
                token.metadata_uri = normalizedUri
                token.image_metadata_uri = normalizedUri

                const remoteMetadata = await fetchMetadata(normalizedUri)
                if (remoteMetadata) {
                  if (remoteMetadata.image && (!token.image_uri || token.image_uri === normalizedUri)) {
                    token.image_uri = normalizeIpfsUri(remoteMetadata.image) ?? token.image_uri
                  }
                  if (remoteMetadata.name && looksLikeMintPrefix(token.name, token.mint)) {
                    token.name = remoteMetadata.name
                  }
                  if (remoteMetadata.symbol && looksLikeMintPrefix(token.symbol, token.mint)) {
                    token.symbol = remoteMetadata.symbol
                  }
                  token.description = token.description ?? remoteMetadata.description ?? null
                  token.twitter = token.twitter ?? remoteMetadata.twitter ?? null
                  token.telegram = token.telegram ?? remoteMetadata.telegram ?? null
                  token.website = token.website ?? remoteMetadata.website ?? null
                  metadataWasHydrated = true
                }
              }
            }

            const normalizedCoinMetadata = normalizeTokenMetadata(
              (coinInfo as Record<string, unknown>).metadata ?? (coinInfo as Record<string, unknown>),
            )
            if (normalizedCoinMetadata.image && !token.image_uri) {
              token.image_uri = normalizeIpfsUri(normalizedCoinMetadata.image) ?? token.image_uri
            }
            if (normalizedCoinMetadata.name && looksLikeMintPrefix(token.name, token.mint)) {
              token.name = normalizedCoinMetadata.name
            }
            if (normalizedCoinMetadata.symbol && looksLikeMintPrefix(token.symbol, token.mint)) {
              token.symbol = normalizedCoinMetadata.symbol
            }
            token.description = token.description ?? normalizedCoinMetadata.description ?? null
            token.twitter = token.twitter ?? normalizedCoinMetadata.twitter ?? null
            token.telegram = token.telegram ?? normalizedCoinMetadata.telegram ?? null
            token.website = token.website ?? normalizedCoinMetadata.website ?? null
          }
        }

        token.image_uri = token.image_uri ?? ""
      }),
    )

    const filteredTokens = aggregatedTokens.filter((token) => passesFilters(token, filters, favoriteMints))
    const sortedTokens = sortTokens(filteredTokens, sortBy, sortOrder)

    const total = sortedTokens.length
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const startIndex = (page - 1) * pageSize
    const pageItems = sortedTokens.slice(startIndex, startIndex + pageSize)

    return NextResponse.json({
      page,
      pageSize,
      total,
      totalPages,
      tokens: pageItems,
      effectiveTimeRangeMinutes,
    })
  } catch (error) {
    console.error("[api/tokens] Failed to fetch tokens:", error)
    return NextResponse.json({ error: "Failed to fetch tokens" }, { status: 500 })
  }
}