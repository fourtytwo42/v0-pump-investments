"use client"

import type React from "react"

import { useEffect } from "react"
import type { Trade } from "./use-websocket-trades"
import { db } from "@/lib/db"

export interface TokenData {
  mint: string
  name: string
  symbol: string
  image_uri: string
  usd_market_cap: number
  market_cap: number
  total_volume: number
  total_volume_usd: number
  buy_volume: number
  buy_volume_usd: number
  sell_volume: number
  sell_volume_usd: number
  unique_traders: string[]
  unique_trader_count: number
  trades: Trade[]
  last_trade_time: number
  creator: string
  creator_username: string
  total_supply: number
  virtual_sol_reserves: number
  virtual_token_reserves: number
  buy_sell_ratio: number
  created_timestamp?: number
  website?: string | null
  twitter?: string | null
  telegram?: string | null
  king_of_the_hill_timestamp?: number | null
  description?: string | null
  image_metadata_uri?: string | null
}

interface UseTokenProcessingProps {
  allTrades: Trade[]
  timeRange: string
  solPrice: number
  minTradeAmountFilter: number
  setTokens: React.Dispatch<React.SetStateAction<Map<string, TokenData>>>
  setRenderKey: React.Dispatch<React.SetStateAction<number>>
}

export function useTokenProcessing({
  allTrades,
  timeRange,
  solPrice,
  minTradeAmountFilter,
  setTokens,
  setRenderKey,
}: UseTokenProcessingProps) {
  useEffect(() => {
    if (allTrades.length === 0) return

    const cutoff = Date.now() - Number.parseInt(timeRange) * 60 * 1000

    const normalizeSolAndUsd = (solAmount: number, usdAmount: number): { sol: number; usd: number } => {
      let safeSol = Number.isFinite(solAmount) && solAmount >= 0 ? solAmount : 0
      const safeUsd = Number.isFinite(usdAmount) && usdAmount > 0 ? usdAmount : 0

      if (safeSol > 1_000_000) {
        safeSol = safeSol / 1_000_000_000
      }

      if (safeSol === 0 && safeUsd > 0 && solPrice > 0) {
        safeSol = safeUsd / solPrice
      }

      const finalUsd = safeUsd > 0 ? safeUsd : safeSol * solPrice
      return { sol: safeSol, usd: finalUsd }
    }

    const loadFavoritesAndProcessTokens = async () => {
      try {
        const favoritesList = await db.getFavorites()
        const relevantTrades = allTrades.filter((trade) => (trade.received_time || trade.timestamp * 1000) >= cutoff)

        const tokenTradesMap = new Map<string, Trade[]>()
        const uniqueTradersMap = new Map<string, Set<string>>()
        const traderTradeAmountsMap = new Map<string, Map<string, number>>()

        relevantTrades.forEach((trade) => {
          const mint = trade.mint
          const trader = trade.user
          const { usd: tradeAmountUSD } = normalizeSolAndUsd(trade.sol_amount, trade.usd_amount)

          if (!tokenTradesMap.has(mint)) {
            tokenTradesMap.set(mint, [])
          }
          tokenTradesMap.get(mint)!.push(trade)

          if (!traderTradeAmountsMap.has(mint)) {
            traderTradeAmountsMap.set(mint, new Map<string, number>())
          }
          const traderAmounts = traderTradeAmountsMap.get(mint)!
          traderAmounts.set(trader, (traderAmounts.get(trader) || 0) + tradeAmountUSD)

          if (tradeAmountUSD >= minTradeAmountFilter) {
            if (!uniqueTradersMap.has(mint)) {
              uniqueTradersMap.set(mint, new Set<string>())
            }
            uniqueTradersMap.get(mint)!.add(trader)
          }
        })

        if (favoritesList.length > 0) {
          for (const favoriteMint of favoritesList) {
            if (!tokenTradesMap.has(favoriteMint)) {
              const favoriteTrades = allTrades.filter((trade) => trade.mint === favoriteMint)
              if (favoriteTrades.length > 0) {
                tokenTradesMap.set(favoriteMint, favoriteTrades)

                const uniqueTraders = new Set<string>()
                const traderAmounts = new Map<string, number>()

                favoriteTrades.forEach((trade) => {
                  const { usd: tradeAmountUSD } = normalizeSolAndUsd(trade.sol_amount, trade.usd_amount)
                  traderAmounts.set(trade.user, (traderAmounts.get(trade.user) || 0) + tradeAmountUSD)
                  if (tradeAmountUSD >= minTradeAmountFilter) {
                    uniqueTraders.add(trade.user)
                  }
                })

                uniqueTradersMap.set(favoriteMint, uniqueTraders)
                traderTradeAmountsMap.set(favoriteMint, traderAmounts)
              }
            }
          }
        }

        const tokenMap = new Map<string, TokenData>()

        tokenTradesMap.forEach((trades, mint) => {
          if (trades.length === 0) return

          const latestTrade = trades.reduce(
            (latest, trade) => (trade.timestamp > latest.timestamp ? trade : latest),
            trades[0],
          )

          const isInFavorites = favoritesList.includes(mint)
          const tradesForVolumeCalc = isInFavorites
            ? trades.filter((trade) => (trade.received_time || trade.timestamp * 1000) >= cutoff)
            : trades

          let totalVolumeSOL = 0
          let buyVolumeSOL = 0
          let sellVolumeSOL = 0
          let totalVolumeUSD = 0
          let buyVolumeUSD = 0
          let sellVolumeUSD = 0

          tradesForVolumeCalc.forEach((trade) => {
            const { sol: tradeVolumeSOL, usd: tradeVolumeUSD } = normalizeSolAndUsd(
              trade.sol_amount,
              trade.usd_amount,
            )
            totalVolumeSOL += tradeVolumeSOL
            totalVolumeUSD += tradeVolumeUSD
            if (trade.is_buy) {
              buyVolumeSOL += tradeVolumeSOL
              buyVolumeUSD += tradeVolumeUSD
            } else {
              sellVolumeSOL += tradeVolumeSOL
              sellVolumeUSD += tradeVolumeUSD
            }
          })

          const lastTradeTime = trades.reduce((latest, trade) => Math.max(latest, trade.timestamp), 0)
          const buyRatio = totalVolumeSOL > 0 ? buyVolumeSOL / totalVolumeSOL : 0
          const uniqueTraders = Array.from(uniqueTradersMap.get(mint) || new Set<string>())
          const uniqueTraderCount = uniqueTraders.length

          const createdTimestamp = (() => {
            if (latestTrade.created_timestamp) {
              return latestTrade.created_timestamp
            }
            const earliest = trades.reduce((earliestValue, trade) => {
              const candidate = trade.created_timestamp ?? trade.timestamp * 1000
              return Math.min(earliestValue, candidate)
            }, Number.POSITIVE_INFINITY)
            return Number.isFinite(earliest) ? earliest : undefined
          })()

          tokenMap.set(mint, {
            mint: latestTrade.mint,
            name: latestTrade.name,
            symbol: latestTrade.symbol,
            image_uri: latestTrade.image_uri,
            usd_market_cap: latestTrade.usd_market_cap,
            market_cap: latestTrade.market_cap,
            total_volume: totalVolumeSOL,
            total_volume_usd: totalVolumeUSD,
            buy_volume: buyVolumeSOL,
            buy_volume_usd: buyVolumeUSD,
            sell_volume: sellVolumeSOL,
            sell_volume_usd: sellVolumeUSD,
            unique_traders: uniqueTraders,
            unique_trader_count: uniqueTraderCount,
            trades,
            last_trade_time: lastTradeTime,
            creator: latestTrade.creator,
            creator_username: latestTrade.creator_username,
            total_supply: latestTrade.total_supply,
            virtual_sol_reserves: latestTrade.virtual_sol_reserves,
            virtual_token_reserves: latestTrade.virtual_token_reserves,
            buy_sell_ratio: buyRatio,
            created_timestamp: createdTimestamp,
            website: latestTrade.website,
            twitter: latestTrade.twitter,
            telegram: latestTrade.telegram,
            king_of_the_hill_timestamp: latestTrade.king_of_the_hill_timestamp,
            description: latestTrade.description,
            image_metadata_uri: latestTrade.metadata_uri ?? null,
          })
        })

        setTokens(tokenMap)
        setRenderKey((prev) => prev + 1)
      } catch (error) {
        console.error("Error processing tokens:", error)
      }
    }

    loadFavoritesAndProcessTokens()
  }, [allTrades, timeRange, solPrice, minTradeAmountFilter, setTokens, setRenderKey])
}
