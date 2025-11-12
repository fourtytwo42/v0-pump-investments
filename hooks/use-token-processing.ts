"use client"

import type React from "react"

import { useEffect } from "react"
import type { Trade } from "./use-websocket-trades"
import { db } from "@/lib/db"

// Define the TokenData type for aggregated token information
export interface TokenData {
  mint: string
  name: string
  symbol: string
  image_uri: string
  usd_market_cap: number
  market_cap: number
  total_volume: number
  buy_volume: number
  sell_volume: number
  unique_traders: string[] // Changed from Set to array
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
  // Calculate metrics when allTrades or timeRange changes
  useEffect(() => {
    // Skip if no trades
    if (allTrades.length === 0) return

    // Calculate time threshold based on selected time range
    const cutoff = Date.now() - Number.parseInt(timeRange) * 60 * 1000

    // Get favorites from the database
    const loadFavoritesAndProcessTokens = async () => {
      try {
        // Get favorites list
        const favoritesList = await db.getFavorites()

        // Filter trades based on time range
        const relevantTrades = allTrades.filter((trade) => (trade.received_time || trade.timestamp * 1000) >= cutoff)

        // Group trades by token mint and track unique traders per token
        const tokenTradesMap = new Map<string, Trade[]>()
        const uniqueTradersMap = new Map<string, Set<string>>()
        const traderTradeAmountsMap = new Map<string, Map<string, number>>() // Map of token mint -> (trader -> total trade amount)

        // First pass: group trades and collect unique traders
        relevantTrades.forEach((trade) => {
          const mint = trade.mint
          const trader = trade.user
          const tradeAmountUSD = (trade.sol_amount / 1e9) * solPrice // Convert lamports to SOL and then to USD

          // Group trades by token
          if (!tokenTradesMap.has(mint)) {
            tokenTradesMap.set(mint, [])
          }
          tokenTradesMap.get(mint)?.push(trade)

          // Track trader trade amounts per token
          if (!traderTradeAmountsMap.has(mint)) {
            traderTradeAmountsMap.set(mint, new Map<string, number>())
          }
          const traderAmounts = traderTradeAmountsMap.get(mint)!
          traderAmounts.set(trader, (traderAmounts.get(trader) || 0) + tradeAmountUSD)

          // Only count traders who have traded more than the minimum trade amount
          if (tradeAmountUSD >= minTradeAmountFilter) {
            // Track unique traders per token
            if (!uniqueTradersMap.has(mint)) {
              uniqueTradersMap.set(mint, new Set<string>())
            }
            uniqueTradersMap.get(mint)?.add(trader)
          }
        })

        // Also include all trades for favorited tokens, regardless of time range
        if (favoritesList.length > 0) {
          // For each favorite, ensure we have its trades
          for (const favoriteMint of favoritesList) {
            // If we don't already have trades for this favorite from the recent time range
            if (!tokenTradesMap.has(favoriteMint)) {
              // Find all trades for this favorite token
              const favoriteTrades = allTrades.filter((trade) => trade.mint === favoriteMint)

              if (favoriteTrades.length > 0) {
                // Add these trades to our map
                tokenTradesMap.set(favoriteMint, favoriteTrades)

                // Process unique traders for this favorite
                const uniqueTraders = new Set<string>()
                const traderAmounts = new Map<string, number>()

                favoriteTrades.forEach((trade) => {
                  const trader = trade.user
                  const tradeAmountUSD = (trade.sol_amount / 1e9) * solPrice

                  // Track trader amounts
                  traderAmounts.set(trader, (traderAmounts.get(trader) || 0) + tradeAmountUSD)

                  // Only count traders who meet the minimum amount
                  if (tradeAmountUSD >= minTradeAmountFilter) {
                    uniqueTraders.add(trader)
                  }
                })

                uniqueTradersMap.set(favoriteMint, uniqueTraders)
                traderTradeAmountsMap.set(favoriteMint, traderAmounts)
              }
            }
          }
        }

        // Second pass: build token data
        const tokenMap = new Map<string, TokenData>()

        tokenTradesMap.forEach((trades, mint) => {
          if (trades.length === 0) return

          // Use the most recent trade for token metadata
          const latestTrade = trades.reduce(
            (latest, trade) => (trade.timestamp > latest.timestamp ? trade : latest),
            trades[0],
          )

          // For favorites, calculate volumes based on the selected time range
          const isInFavorites = favoritesList.includes(mint)
          const tradesForVolumeCalc = isInFavorites
            ? trades.filter((trade) => (trade.received_time || trade.timestamp * 1000) >= cutoff)
            : trades

          // Calculate total volume, buy volume, and sell volume
          let totalVolume = 0
          let buyVolume = 0
          let sellVolume = 0

          tradesForVolumeCalc.forEach((trade) => {
            const tradeVolume = trade.sol_amount / 1e9 // Convert lamports to SOL
            totalVolume += tradeVolume
            if (trade.is_buy) {
              buyVolume += tradeVolume
            } else {
              sellVolume += tradeVolume
            }
          })

          // Calculate last trade time
          const lastTradeTime = trades.reduce((latest, trade) => Math.max(latest, trade.timestamp), 0)

          // Calculate buy/sell ratio
          const buyRatio = totalVolume > 0 ? buyVolume / totalVolume : 0

          // Get unique traders for this token (those who have traded more than the minimum amount)
          const uniqueTraders = Array.from(uniqueTradersMap.get(mint) || new Set<string>())
          const uniqueTraderCount = uniqueTraders.length

          // Create token data
          tokenMap.set(mint, {
            mint: latestTrade.mint,
            name: latestTrade.name,
            symbol: latestTrade.symbol,
            image_uri: latestTrade.image_uri,
            usd_market_cap: latestTrade.usd_market_cap,
            market_cap: latestTrade.market_cap,
            total_volume: totalVolume,
            buy_volume: buyVolume,
            sell_volume: sellVolume,
            unique_traders: uniqueTraders,
            unique_trader_count: uniqueTraderCount,
            trades: trades,
            last_trade_time: lastTradeTime,
            creator: latestTrade.creator,
            creator_username: latestTrade.creator_username,
            total_supply: latestTrade.total_supply,
            virtual_sol_reserves: latestTrade.virtual_sol_reserves,
            virtual_token_reserves: latestTrade.virtual_token_reserves,
            buy_sell_ratio: buyRatio,
            created_timestamp: latestTrade.created_timestamp,
            website: latestTrade.website,
            twitter: latestTrade.twitter,
            telegram: latestTrade.telegram,
            king_of_the_hill_timestamp: latestTrade.king_of_the_hill_timestamp,
            description: latestTrade.description, // Include description from the latest trade
          })
        })

        // Update tokens state
        setTokens(tokenMap)

        // Force a re-render to ensure UI updates
        setRenderKey((prev) => prev + 1)
      } catch (error) {
        console.error("Error processing tokens:", error)
      }
    }

    loadFavoritesAndProcessTokens()
  }, [allTrades, timeRange, solPrice, minTradeAmountFilter, setTokens, setRenderKey])
}
