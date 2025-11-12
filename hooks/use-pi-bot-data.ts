"use client"

import { useEffect } from "react"
import type { TokenData } from "./use-token-processing"

export function usePiBotData({
  paginatedTokens,
  solPrice,
  timeRange,
  sortBy,
}: {
  paginatedTokens: TokenData[]
  solPrice: number
  timeRange: string
  sortBy: string
}) {
  // This makes token data available to the PI Bot
  useEffect(() => {
    // Expose token data for the PI Bot
    if (typeof window !== "undefined") {
      ;(window as any).__pumpInvestments = {
        visibleTokens: paginatedTokens,
        solPrice: solPrice,
        timeRange: timeRange,
        sortBy: sortBy,
      }
    }

    // Cleanup
    return () => {
      if (typeof window !== "undefined") {
        delete (window as any).__pumpInvestments
      }
    }
  }, [paginatedTokens, solPrice, timeRange, sortBy])
}
