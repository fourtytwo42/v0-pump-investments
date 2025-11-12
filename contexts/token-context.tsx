"use client"

import type React from "react"
import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react"
import { db } from "@/lib/db"
import { toast } from "@/components/ui/use-toast"
import { useWebSocketTrades } from "@/hooks/use-websocket-trades"

// Define the types
interface Trade {
  mint: string
  name: string
  symbol: string
  image_uri: string
  usd_market_cap: number
  market_cap: number
  sol_amount: number
  is_buy: boolean
  user: string
  creator: string
  creator_username: string
  token_amount: number
  total_supply: number
  timestamp: number
  received_time?: number
  virtual_sol_reserves: number
  virtual_token_reserves: number
  signature: string
  created_timestamp?: number
  website?: string | null
  twitter?: string | null
  telegram?: string | null
  king_of_the_hill_timestamp?: number | null
  description?: string | null
  [key: string]: any
}

interface TokenData {
  mint: string
  name: string
  symbol: string
  image_uri: string
  usd_market_cap: number
  market_cap: number
  total_volume: number
  buy_volume: number
  sell_volume: number
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
}

// Define the context type
interface TokenContextType {
  tokens: Map<string, TokenData>
  setTokens: React.Dispatch<React.SetStateAction<Map<string, TokenData>>>
  allTrades: Trade[]
  setAllTrades: React.Dispatch<React.SetStateAction<Trade[]>>
  favorites: string[]
  toggleFavorite: (mint: string) => Promise<void>
  isLoading: boolean
  solPrice: number
  showFavorites: boolean
  setShowFavorites: React.Dispatch<React.SetStateAction<boolean>>
  isPaused: boolean
  setIsPaused: React.Dispatch<React.SetStateAction<boolean>>
  renderKey: number
  setRenderKey: React.Dispatch<React.SetStateAction<number>>
  isConnected: boolean
}

// Create the context with a default value
const TokenContext = createContext<TokenContextType | undefined>(undefined)

// Create a provider component
export function TokenProvider({ children }: { children: React.ReactNode }) {
  const [tokens, setTokens] = useState<Map<string, TokenData>>(new Map())
  const [allTrades, setAllTrades] = useState<Trade[]>([])
  const [favorites, setFavorites] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [solPrice, setSolPrice] = useState<number>(175)
  const [showFavorites, setShowFavorites] = useState<boolean>(false)
  const [isPaused, setIsPaused] = useState<boolean>(false)
  const [renderKey, setRenderKey] = useState<number>(0)

  // Call useWebSocketTrades here
  const { isConnected } = useWebSocketTrades(setAllTrades)

  // Load favorites from Dexie
  const loadFavorites = useCallback(async () => {
    try {
      const favs = await db.getFavorites()
      setFavorites(favs)
    } catch (error) {
      console.error("Error loading favorites:", error)
      toast({
        title: "Error",
        description: "Failed to load favorites",
        variant: "destructive",
      })
    }
  }, [])

  // Toggle favorite function
  const toggleFavorite = useCallback(
    async (mint: string) => {
      try {
        const isFavorite = await db.isFavorite(mint)

        if (isFavorite) {
          await db.removeFavorite(mint)
          toast({
            title: "Removed from favorites",
            description: "Token removed from your favorites",
          })
        } else {
          await db.addFavorite(mint)
          toast({
            title: "Added to favorites",
            description: "Token added to your favorites",
          })
        }
        loadFavorites()
      } catch (error) {
        console.error("Error toggling favorite:", error)
        toast({
          title: "Error",
          description: "Failed to update favorites",
          variant: "destructive",
        })
      }
    },
    [loadFavorites],
  )

  // Fetch SOL price
  const fetchSolPrice = useCallback(async () => {
    try {
      const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd")
      const data = await response.json()
      if (data.solana && data.solana.usd) {
        setSolPrice(data.solana.usd)
      }
    } catch (error) {
      // Silent error handling
    }
  }, [])

  // Initialize data
  useEffect(() => {
    const initializeData = async () => {
      setIsLoading(true)
      try {
        await loadFavorites()
        const storedTrades = await db.getRecentTrades()
        if (storedTrades.length > 0) {
          setAllTrades(storedTrades as Trade[])
        }
        await fetchSolPrice()
      } catch (error) {
        console.error("Error initializing data:", error)
      } finally {
        setIsLoading(false)
      }
    }
    initializeData()
    const solPriceInterval = setInterval(fetchSolPrice, 60000)
    return () => {
      clearInterval(solPriceInterval)
    }
  }, [loadFavorites, fetchSolPrice])

  // Memoize the context value to prevent unnecessary re-renders
  const value = useMemo(
    () => ({
      tokens,
      setTokens,
      allTrades,
      setAllTrades,
      favorites,
      toggleFavorite,
      isLoading,
      solPrice,
      showFavorites,
      setShowFavorites,
      isPaused,
      setIsPaused,
      renderKey,
      setRenderKey,
      isConnected, // Add isConnected here
    }),
    [
      tokens,
      allTrades,
      favorites,
      toggleFavorite,
      isLoading,
      solPrice,
      showFavorites,
      isPaused,
      renderKey,
      isConnected, // Add isConnected to dependencies
    ],
  )

  return <TokenContext.Provider value={value}>{children}</TokenContext.Provider>
}

// Create a custom hook for using this context
export function useTokenContext() {
  const context = useContext(TokenContext)
  if (context === undefined) {
    throw new Error("useTokenContext must be used within a TokenProvider")
  }
  return context
}
