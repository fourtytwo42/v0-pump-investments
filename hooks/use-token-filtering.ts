"use client"

import { useState, useEffect, useMemo } from "react"
import type { TokenData } from "./use-token-processing"
import type { DashboardSettings } from "./use-settings"

interface UseTokenFilteringProps {
  tokens: Map<string, TokenData>
  sortBy: string
  settings: DashboardSettings
  showFavorites: boolean
  favorites: string[]
  isPaused: boolean
  renderKey: number
}

export function useTokenFiltering({
  tokens,
  sortBy,
  settings,
  showFavorites,
  favorites,
  isPaused,
  renderKey,
}: UseTokenFilteringProps) {
  const [pausedTokens, setPausedTokens] = useState<TokenData[]>([])

  // Filter and sort tokens - now respects the pause state
  const sortedTokens = useMemo(() => {
    // If paused, use the stored paused tokens
    if (isPaused && pausedTokens.length > 0) {
      return pausedTokens
    }

    const tokenArray = Array.from(tokens.values())

    // Apply filters
    const filteredTokens = tokenArray.filter((token) => {
      // Filter to show only favorites if showFavorites is true
      if (showFavorites && !favorites.includes(token.mint)) {
        return false
      }

      // Filter out KOTH tokens if hideKOTH is enabled
      if (
        settings.hideKOTH &&
        token.king_of_the_hill_timestamp !== null &&
        token.king_of_the_hill_timestamp !== undefined
      ) {
        return false
      }

      // Filter out external tokens if hideExternal is enabled
      if (settings.hideExternal && !token.mint.endsWith("pump")) {
        return false
      }

      if (settings.graduationFilter === "bonding" && token.is_completed) {
        return false
      }

      if (settings.graduationFilter === "graduated" && !token.is_completed) {
        return false
      }

      if (
        token.usd_market_cap < settings.minMarketCapFilter ||
        (settings.maxMarketCapFilter < 1000000 && token.usd_market_cap > settings.maxMarketCapFilter)
      ) {
        return false
      }

      // Volume filters - limits are already in SOL
      if (token.total_volume < settings.minTotalVolume || token.total_volume > settings.maxTotalVolume) {
        return false
      }

      if (token.buy_volume < settings.minBuyVolume || token.buy_volume > settings.maxBuyVolume) {
        return false
      }

      if (token.sell_volume < settings.minSellVolume || token.sell_volume > settings.maxSellVolume) {
        return false
      }

      // Unique traders filter
      if (
        token.unique_trader_count < settings.minUniqueTraders ||
        token.unique_trader_count > settings.maxUniqueTraders
      ) {
        return false
      }

      if (token.unique_trader_count < settings.minUniqueTraderCountFilter) {
        return false
      }

      if (
        settings.maxUniqueTraderCountFilter < 500 &&
        token.unique_trader_count > settings.maxUniqueTraderCountFilter
      ) {
        return false
      }

      return true
    })

    // Sort tokens
    return filteredTokens.sort((a, b) => {
      switch (sortBy) {
        case "marketCap":
          return b.usd_market_cap - a.usd_market_cap
        case "totalVolume":
          return b.total_volume - a.total_volume
        case "buyVolume":
          return b.buy_volume - a.buy_volume
        case "sellVolume":
          return b.sell_volume - a.sell_volume
        case "uniqueTraders":
          return b.unique_trader_count - a.unique_trader_count
        case "tokenAge": {
          const tsA = a.created_timestamp
          const tsB = b.created_timestamp
          if (tsA == null && tsB == null) return 0
          if (tsA == null) return 1
          if (tsB == null) return -1
          return tsB - tsA // Newest first
        }
        case "lastTrade": {
          // Sort by last trade timestamp (oldest first)
          const tsA = a.last_trade_timestamp
          const tsB = b.last_trade_timestamp

          if (tsA == null && tsB == null) return 0 // both unknown, treat as equal
          if (tsA == null) return 1 // a is unknown (older or N/A), put it after b
          if (tsB == null) return -1 // b is unknown (older or N/A), put it after a

          return tsA - tsB // Sort by oldest first (lower timestamp means older)
        }
        default:
          return b.usd_market_cap - a.usd_market_cap
      }
    })
  }, [tokens, sortBy, settings, renderKey, showFavorites, favorites, isPaused, pausedTokens])

  // Handle pause/unpause for token sorting
  useEffect(() => {
    if (isPaused) {
      // When paused, store the current filtered and sorted tokens
      const tokenArray = Array.from(tokens.values())

      // Apply filters (same logic as in the useMemo above)
      const filteredTokens = tokenArray.filter((token) => {
        if (showFavorites && !favorites.includes(token.mint)) return false
        if (
          settings.hideKOTH &&
          token.king_of_the_hill_timestamp !== null &&
          token.king_of_the_hill_timestamp !== undefined
        )
          return false
        if (settings.hideExternal && !token.mint.endsWith("pump")) return false

        if (settings.graduationFilter === "bonding" && token.is_completed) return false
        if (settings.graduationFilter === "graduated" && !token.is_completed) return false

        if (
          token.usd_market_cap < settings.minMarketCapFilter ||
          (settings.maxMarketCapFilter < 1000000 && token.usd_market_cap > settings.maxMarketCapFilter)
        )
          return false

        if (token.total_volume < settings.minTotalVolume || token.total_volume > settings.maxTotalVolume) return false
        if (token.buy_volume < settings.minBuyVolume || token.buy_volume > settings.maxBuyVolume) return false
        if (token.sell_volume < settings.minSellVolume || token.sell_volume > settings.maxSellVolume) return false
        if (
          token.unique_trader_count < settings.minUniqueTraders ||
          token.unique_trader_count > settings.maxUniqueTraders
        )
          return false
        if (token.unique_trader_count < settings.minUniqueTraderCountFilter) return false
        if (
          settings.maxUniqueTraderCountFilter < 500 &&
          token.unique_trader_count > settings.maxUniqueTraderCountFilter
        )
          return false
        return true
      })

      // Sort tokens (same logic as in the useMemo above)
      const sortedFilteredTokens = filteredTokens.sort((a, b) => {
        switch (sortBy) {
          case "marketCap":
            return b.usd_market_cap - a.usd_market_cap
          case "totalVolume":
            return b.total_volume - a.total_volume
          case "buyVolume":
            return b.buy_volume - a.buy_volume
          case "sellVolume":
            return b.sell_volume - a.sell_volume
          case "uniqueTraders":
            return b.unique_trader_count - a.unique_trader_count
          case "tokenAge": {
            const tsA = a.created_timestamp
            const tsB = b.created_timestamp
            if (tsA == null && tsB == null) return 0
            if (tsA == null) return 1
            if (tsB == null) return -1
            return tsB - tsA
          }
          case "lastTrade": {
            const tsA = a.last_trade_timestamp
            const tsB = b.last_trade_timestamp
            if (tsA == null && tsB == null) return 0
            if (tsA == null) return 1
            if (tsB == null) return -1
            return tsA - tsB
          }
          default:
            return b.usd_market_cap - a.usd_market_cap
        }
      })

      setPausedTokens(sortedFilteredTokens)
    } else {
      // When unpaused, clear the paused tokens
      setPausedTokens([])
    }
  }, [isPaused, tokens, sortBy, settings, showFavorites, favorites])

  return sortedTokens
}
