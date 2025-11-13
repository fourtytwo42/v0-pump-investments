"use client"

import type React from "react"
import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react"
import { db } from "@/lib/db"
import { toast } from "@/components/ui/use-toast"
import type { TokenData } from "@/types/token-data"
import type { TokenQueryOptions } from "@/lib/token-query"
import { normalizeIpfsUri } from "@/lib/pump-trades"

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

const CLIENT_COIN_ENDPOINTS = ["/api/pump-coin"]

interface ClientCoinMetadata {
  name?: string | null
  symbol?: string | null
  imageUri?: string | null
  metadataUri?: string | null
  description?: string | null
  twitter?: string | null
  telegram?: string | null
  website?: string | null
  completed?: boolean | null
  kingOfTheHillTimestamp?: number | null
  bondingCurve?: string | null
  associatedBondingCurve?: string | null
}

interface ClientCoinResponse {
  source?: string
  metadata?: ClientCoinMetadata
}

function looksLikeMintPrefix(value: string | null | undefined, mint: string): boolean {
  if (!value) return true
  const cleaned = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase()
  if (!cleaned) return true
  if (cleaned.length < 3) return false
  return mint.toUpperCase().startsWith(cleaned)
}

function shouldHydrateOnClient(token: TokenData): boolean {
  if (!token) return false
  if (!token.image_uri) return true
  if (looksLikeMintPrefix(token.name, token.mint)) return true
  if (looksLikeMintPrefix(token.symbol, token.mint)) return true
  if (!token.description && !token.twitter && !token.telegram) return true
  return false
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
  const metadataPendingRef = useRef<Set<string>>(new Set())
  const metadataRetryRef = useRef<Map<string, number>>(new Map())

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
    let inFlight = false
    let intervalId: NodeJS.Timeout | null = null

    const fetchSnapshot = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      try {
        const response = await fetch("/api/tokens", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...queryOptions,
            favoriteMints: favorites,
          }),
        })

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`)
        }

        const payload = (await response.json()) as {
          tokens: TokenData[]
          totalPages: number
          total: number
        }

        if (cancelled) {
          return
        }

        const tokenMap = new Map<string, TokenData>()
        for (const token of payload.tokens) {
          tokenMap.set(token.mint, token)
        }

        setTokens(tokenMap)
        setVisibleTokens(payload.tokens)
        setTotalPages(payload.totalPages)
        setTotalCount(payload.total)
        setIsLoading(false)
        setIsConnected(true)
      } catch (error) {
        if (!cancelled) {
          console.error("[TokenProvider] Failed to fetch tokens:", error)
          setIsLoading(false)
          setIsConnected(false)
        }
      } finally {
        inFlight = false
      }
    }

    setIsLoading(true)
    fetchSnapshot()
    intervalId = setInterval(fetchSnapshot, 500)

    return () => {
      cancelled = true
      if (intervalId) {
        clearInterval(intervalId)
      }
    }
  }, [queryOptions, favorites])

  const fetchCoinClient = useCallback(async (mint: string): Promise<ClientCoinResponse | null> => {
    for (const base of CLIENT_COIN_ENDPOINTS) {
      const url = `${base}/${encodeURIComponent(mint)}`
      try {
        const response = await fetch(url, {
          method: "GET",
          mode: "cors",
          headers: {
            accept: "application/json, text/plain, */*",
          },
          cache: "no-store",
        })
        if (!response.ok) {
          if (response.status === 404) {
            const payload = (await response.json()) as ClientCoinResponse | { error?: string }
            if (payload && typeof payload === "object" && "metadata" in payload) {
              return payload as ClientCoinResponse
            }
            return null
          }
          continue
        }
        return (await response.json()) as ClientCoinResponse
      } catch (error) {
        console.warn("[TokenProvider] client coin fetch failed", mint, (error as Error).message)
      }
    }
    return null
  }, [])

  const hydrateFromClient = useCallback(
    async (mint: string) => {
      const pending = metadataPendingRef.current
      const retries = metadataRetryRef.current
      const attempt = (retries.get(mint) ?? 0) + 1
      retries.set(mint, attempt)

      try {
        const response = await fetchCoinClient(mint)
        if (!response || typeof response !== "object") {
          return
        }

        const metadata = response.metadata ?? {}

        const normalizedMetadataUri = metadata.metadataUri
          ? normalizeIpfsUri(metadata.metadataUri) ?? metadata.metadataUri
          : null
        const normalizedImage = metadata.imageUri
          ? normalizeIpfsUri(metadata.imageUri) ?? metadata.imageUri
          : null

        let appliedUpdates: Partial<TokenData> | null = null

        setTokens((prev) => {
          const existing = prev.get(mint)
          if (!existing) return prev

          const updates: Partial<TokenData> = {}

          if (normalizedMetadataUri && (!existing.metadata_uri || existing.metadata_uri === "")) {
            updates.metadata_uri = normalizedMetadataUri
            updates.image_metadata_uri = normalizedMetadataUri
          }

          if (
            normalizedImage &&
            (!existing.image_uri || existing.image_uri === existing.metadata_uri || existing.image_uri === "")
          ) {
            updates.image_uri = normalizedImage
          }

          if (metadata.name && looksLikeMintPrefix(existing.name, mint)) {
            updates.name = metadata.name
          }

          if (metadata.symbol && looksLikeMintPrefix(existing.symbol, mint)) {
            updates.symbol = metadata.symbol
          }

          if (metadata.description && !existing.description) {
            updates.description = metadata.description
          }

          if (metadata.twitter && !existing.twitter) {
            updates.twitter = metadata.twitter
          }

          if (metadata.telegram && !existing.telegram) {
            updates.telegram = metadata.telegram
          }

          if (metadata.website && !existing.website) {
            updates.website = metadata.website
          }

          if (typeof metadata.completed === "boolean" && existing.is_completed !== metadata.completed) {
            updates.is_completed = metadata.completed
            updates.is_bonding_curve = metadata.completed ? false : existing.is_bonding_curve
          }

          if (
            metadata.kingOfTheHillTimestamp &&
            !existing.king_of_the_hill_timestamp &&
            Number.isFinite(metadata.kingOfTheHillTimestamp)
          ) {
            updates.king_of_the_hill_timestamp = Number(metadata.kingOfTheHillTimestamp)
          }

          if (metadata.bondingCurve && !existing.bonding_curve) {
            updates.bonding_curve = metadata.bondingCurve
          }

          if (metadata.associatedBondingCurve && !existing.associated_bonding_curve) {
            updates.associated_bonding_curve = metadata.associatedBondingCurve
          }

          if (Object.keys(updates).length === 0) {
            return prev
          }

          appliedUpdates = updates
          const next = new Map(prev)
          next.set(mint, { ...existing, ...updates })
          return next
        })

        if (appliedUpdates) {
          setVisibleTokens((prev) =>
            prev.map((token) => (token.mint === mint ? { ...token, ...appliedUpdates } : token)),
          )
        }
      } finally {
        metadataPendingRef.current.delete(mint)
      }
    },
    [fetchCoinClient, setTokens, setVisibleTokens],
  )

  useEffect(() => {
    if (typeof window === "undefined") return
    const pending = metadataPendingRef.current
    const retries = metadataRetryRef.current

    const candidates = visibleTokens.filter(shouldHydrateOnClient).slice(0, 5)
    for (const token of candidates) {
      if (pending.has(token.mint)) continue
      const attempts = retries.get(token.mint) ?? 0
      if (attempts >= 3) continue
      pending.add(token.mint)
      void hydrateFromClient(token.mint)
    }
  }, [visibleTokens, hydrateFromClient])

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
