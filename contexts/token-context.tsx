"use client"

import type React from "react"
import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react"
import { db } from "@/lib/db"
import { toast } from "@/components/ui/use-toast"
import type { TokenData, TokenQueryOptions } from "@/types/token-data"

interface TokenContextType {
  tokens: Map<string, TokenData>
  visibleTokens: TokenData[]
  setTokens: React.Dispatch<React.SetStateAction<Map<string, TokenData>>>
  favorites: string[]
  toggleFavorite: (mint: string) => Promise<void>
  isLoading: boolean
  solPrice: number
  showFavorites: boolean
  setShowFavorites: React.Dispatch<React.SetStateAction<boolean>>
  isPaused: boolean
  setIsPaused: React.Dispatch<React.SetStateAction<boolean>>
  totalPages: number
  totalCount: number
  queryOptions: TokenQueryOptions
  setTokenQueryOptions: (options: TokenQueryOptions) => void
  isConnected: boolean
}

const TokenContext = createContext<TokenContextType | undefined>(undefined)

const DEFAULT_QUERY_OPTIONS: TokenQueryOptions = {
  page: 1,
  pageSize: 12,
  sortBy: "marketCap",
  sortOrder: "desc",
  timeRangeMinutes: 10,
  filters: {
    hideExternal: false,
    hideKOTH: false,
    graduationFilter: "all",
    minTradeAmount: 0,
    favoritesOnly: false,
  },
}

export function TokenProvider({ children }: { children: React.ReactNode }) {
  const [tokens, setTokens] = useState<Map<string, TokenData>>(new Map())
  const [visibleTokens, setVisibleTokens] = useState<TokenData[]>([])
  const [favorites, setFavorites] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [solPrice, setSolPrice] = useState<number>(175)
  const [showFavorites, setShowFavorites] = useState<boolean>(false)
  const [isPaused, setIsPaused] = useState<boolean>(false)
  const [queryOptions, setQueryOptions] = useState<TokenQueryOptions>(DEFAULT_QUERY_OPTIONS)
  const [totalPages, setTotalPages] = useState<number>(1)
  const [totalCount, setTotalCount] = useState<number>(0)
  const [isConnected, setIsConnected] = useState<boolean>(false)
  const tokenMapRef = useRef<Map<string, TokenData>>(new Map())

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

  const fetchSolPrice = useCallback(async () => {
    try {
      const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd")
      const data = await response.json()
      if (data.solana && data.solana.usd) {
        setSolPrice(data.solana.usd)
      }
    } catch (error) {
      console.warn("Failed to fetch SOL price:", (error as Error).message)
    }
  }, [])

  const setTokenQueryOptions = useCallback((options: TokenQueryOptions) => {
    setQueryOptions((previous) => {
      const previousSerialized = JSON.stringify(previous)
      const nextSerialized = JSON.stringify(options)
      return previousSerialized === nextSerialized ? previous : options
    })
  }, [])

  useEffect(() => {
    const initialize = async () => {
      setIsLoading(true)
      try {
        await loadFavorites()
        await fetchSolPrice()
      } catch (error) {
        console.error("Error initializing token context:", error)
      } finally {
        setIsLoading(false)
      }
    }

    initialize()
    const solPriceInterval = setInterval(fetchSolPrice, 60000)
    return () => {
      clearInterval(solPriceInterval)
    }
  }, [loadFavorites, fetchSolPrice])

  useEffect(() => {
    let cancelled = false
    let controller: AbortController | null = null
    let fallbackInterval: ReturnType<typeof setInterval> | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let consecutiveFailures = 0

    const requestBody = JSON.stringify({
      ...queryOptions,
      favoriteMints: favorites,
    })

    const applySnapshot = (payload: { tokens: TokenData[]; totalPages: number; total: number }) => {
      const tokenMap = new Map(payload.tokens.map((token) => [token.mint, token]))
      tokenMapRef.current = tokenMap
      setTokens(tokenMap)
      setVisibleTokens(payload.tokens)
      setTotalPages(payload.totalPages)
      setTotalCount(payload.total)
      setIsLoading(false)
      setIsConnected(true)
    }

    const applyPatch = (payload: {
      upserts: TokenData[]
      removedMints: string[]
      order: string[]
      totalPages: number
      total: number
    }) => {
      const next = new Map(tokenMapRef.current)
      payload.removedMints.forEach((mint) => next.delete(mint))
      payload.upserts.forEach((token) => next.set(token.mint, token))
      tokenMapRef.current = next
      setTokens(next)
      setVisibleTokens(payload.order.map((mint) => next.get(mint)).filter((token): token is TokenData => Boolean(token)))
      setTotalPages(payload.totalPages)
      setTotalCount(payload.total)
      setIsLoading(false)
      setIsConnected(true)
    }

    const fetchSnapshot = async () => {
      if (cancelled) return
      try {
        const response = await fetch("/api/tokens", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: requestBody,
        })
        if (!response.ok) throw new Error(`Request failed with status ${response.status}`)
        const payload = (await response.json()) as {
          tokens: TokenData[]
          totalPages: number
          total: number
        }
        if (!cancelled) applySnapshot(payload)
      } catch (error) {
        if (!cancelled) console.error("[TokenProvider] Snapshot fallback failed:", error)
      }
    }

    const stopFallback = () => {
      if (fallbackInterval) clearInterval(fallbackInterval)
      fallbackInterval = null
    }

    const startFallback = () => {
      if (fallbackInterval) return
      void fetchSnapshot()
      fallbackInterval = setInterval(() => void fetchSnapshot(), 5_000)
    }

    const consumeSse = async (response: Response) => {
      if (!response.body) throw new Error("Token stream response has no body")
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (!cancelled) {
        const { done, value } = await reader.read()
        if (done) throw new Error("Token stream closed")
        buffer += decoder.decode(value, { stream: true })
        let boundary = buffer.indexOf("\n\n")
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const event = block.match(/^event:\s*(.+)$/m)?.[1]
          const data = block.match(/^data:\s*(.+)$/m)?.[1]
          if (event && data && event !== "heartbeat") {
            const payload = JSON.parse(data)
            if (event === "snapshot") applySnapshot(payload)
            if (event === "patch") applyPatch(payload)
            consecutiveFailures = 0
            stopFallback()
          }
          boundary = buffer.indexOf("\n\n")
        }
      }
    }

    const connect = async () => {
      if (cancelled) return
      controller = new AbortController()
      try {
        const response = await fetch("/api/tokens/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: requestBody,
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`Token stream failed with status ${response.status}`)
        await consumeSse(response)
      } catch (error) {
        if (cancelled || controller.signal.aborted) return
        consecutiveFailures += 1
        setIsConnected(false)
        if (consecutiveFailures >= 3) startFallback()
        const delay = Math.min(30_000, 1_000 * 2 ** Math.min(consecutiveFailures - 1, 5))
        const jitter = Math.floor(delay * Math.random() * 0.2)
        console.warn(`[TokenProvider] Reconnecting token stream in ${delay + jitter}ms`, error)
        reconnectTimer = setTimeout(() => void connect(), delay + jitter)
      }
    }

    setIsLoading(true)
    void connect()

    return () => {
      cancelled = true
      controller?.abort()
      if (reconnectTimer) clearTimeout(reconnectTimer)
      stopFallback()
    }
  }, [queryOptions, favorites])

  const value = useMemo(
    () => ({
      tokens,
      visibleTokens,
      setTokens,
      favorites,
      toggleFavorite,
      isLoading,
      solPrice,
      showFavorites,
      setShowFavorites,
      isPaused,
      setIsPaused,
      totalPages,
      totalCount,
      queryOptions,
      setTokenQueryOptions,
      isConnected,
    }),
    [
      tokens,
      visibleTokens,
      favorites,
      toggleFavorite,
      isLoading,
      solPrice,
      showFavorites,
      isPaused,
      totalPages,
      totalCount,
      queryOptions,
      setTokenQueryOptions,
      isConnected,
    ],
  )

  return <TokenContext.Provider value={value}>{children}</TokenContext.Provider>
}

export function useTokenContext() {
  const context = useContext(TokenContext)
  if (context === undefined) {
    throw new Error("useTokenContext must be used within a TokenProvider")
  }
  return context
}
