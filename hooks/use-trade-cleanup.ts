"use client"

import type React from "react"

import { useEffect, useRef } from "react"
import { db } from "@/lib/db"
import type { Trade } from "./use-websocket-trades"

export function useTradeCleanup({
  tradeRetentionMinutes,
  setAllTrades,
}: {
  tradeRetentionMinutes: number
  setAllTrades: React.Dispatch<React.SetStateAction<Trade[]>>
}) {
  const cleanupIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const previousRetentionRef = useRef(tradeRetentionMinutes)

  // Set up cleanup interval for old trades
  useEffect(() => {
    const cleanupTrades = async () => {
      try {
        // Use the configured retention time instead of hardcoded 60 minutes
        const deletedCount = await db.cleanupOldTrades(tradeRetentionMinutes)
        if (deletedCount > 0) {
          console.log(`Cleaned up ${deletedCount} old trades`)
        }
      } catch (error) {
        console.error("Error cleaning up trades:", error)
      }
    }

    // Run cleanup every 5 minutes
    cleanupIntervalRef.current = setInterval(cleanupTrades, 5 * 60 * 1000)

    // Run once on mount
    cleanupTrades()

    return () => {
      if (cleanupIntervalRef.current) {
        clearInterval(cleanupIntervalRef.current)
      }
    }
  }, [tradeRetentionMinutes])

  // Clean up old trades based on time range - only when retention period changes
  useEffect(() => {
    // Only run this effect if the retention period has actually changed
    if (previousRetentionRef.current !== tradeRetentionMinutes) {
      previousRetentionRef.current = tradeRetentionMinutes

      // Clean up allTrades - keep only trades within the configured retention period
      setAllTrades((prevTrades) => {
        const cutoffTime = Date.now() - tradeRetentionMinutes * 60 * 1000
        return prevTrades.filter((trade) => (trade.received_time || trade.timestamp * 1000) >= cutoffTime)
      })

      // Set up interval for ongoing cleanup
      const cleanupInterval = setInterval(() => {
        setAllTrades((prevTrades) => {
          const cutoffTime = Date.now() - tradeRetentionMinutes * 60 * 1000
          return prevTrades.filter((trade) => (trade.received_time || trade.timestamp * 1000) >= cutoffTime)
        })
      }, 60000) // Run every minute

      return () => clearInterval(cleanupInterval)
    }

    // If retention period hasn't changed, just set up the interval
    const cleanupInterval = setInterval(() => {
      setAllTrades((prevTrades) => {
        const cutoffTime = Date.now() - tradeRetentionMinutes * 60 * 1000
        return prevTrades.filter((trade) => (trade.received_time || trade.timestamp * 1000) >= cutoffTime)
      })
    }, 60000) // Run every minute

    return () => clearInterval(cleanupInterval)
  }, [tradeRetentionMinutes, setAllTrades])
}
