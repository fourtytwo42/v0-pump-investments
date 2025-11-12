"use client"

import { useEffect, type Dispatch, type SetStateAction } from "react"
import type { TokenData } from "./use-token-processing"
import type { Trade } from "./use-websocket-trades"
import {
  fetchTokenMetadataWithCache,
  getCachedTokenMetadata,
  hasCachedTokenMetadata,
  primeTokenMetadataCache,
} from "@/lib/token-metadata-cache"
import type { TokenMetadata } from "@/lib/token-metadata"
import { db } from "@/lib/db"

interface UseVisibleTokenMetadataParams {
  paginatedTokens: TokenData[]
  setTokens: Dispatch<SetStateAction<Map<string, TokenData>>>
  setAllTrades: Dispatch<SetStateAction<Trade[]>>
}

function tokenHasMetadata(token: TokenData): boolean {
  const hasName = token.name && token.name.trim().length > 0 && token.name.trim() !== "Unknown"
  const hasSymbol = token.symbol && token.symbol.trim().length > 0 && token.symbol.trim() !== "???"
  const hasImage = token.image_uri && token.image_uri.trim().length > 0 && !token.image_uri.trim().endsWith(".json")
  const hasDescription = token.description && token.description.trim().length > 0
  const hasWebsite = token.website && token.website.trim().length > 0
  const hasTwitter = token.twitter && token.twitter.trim().length > 0
  const hasTelegram = token.telegram && token.telegram.trim().length > 0

  if (process.env.NEXT_PUBLIC_LOG_METADATA === "true") {
    console.log("[metadata] tokenHasMetadata", token.mint, {
      hasName,
      hasSymbol,
      hasImage,
      hasDescription,
      hasWebsite,
      hasTwitter,
      hasTelegram,
    })
  }

  return Boolean(hasName || hasSymbol || hasImage || hasDescription || hasWebsite || hasTwitter || hasTelegram)
}

function shouldReplaceName(current: string | undefined, incoming?: string | null): boolean {
  if (!incoming) {
    return false
  }

  if (!current) {
    return true
  }

  const trimmed = current.trim()
  return trimmed.length === 0 || trimmed === "Unknown"
}

function shouldReplaceSymbol(current: string | undefined, incoming?: string | null): boolean {
  if (!incoming) {
    return false
  }

  if (!current) {
    return true
  }

  const trimmed = current.trim()
  return trimmed.length === 0 || trimmed === "???"
}

function shouldReplaceImage(current: string | undefined, incoming?: string | null): boolean {
  if (!incoming) {
    return false
  }

  if (!current) {
    return true
  }

  const trimmed = current.trim()
  return trimmed.length === 0 || trimmed.endsWith(".json")
}

function mergeMetadataIntoToken(token: TokenData, metadata: TokenMetadata): { updated: TokenData; changed: boolean } {
  let changed = false
  const updated: TokenData = { ...token }

  if (shouldReplaceName(token.name, metadata.name)) {
    updated.name = metadata.name ?? updated.name
    changed = true
  }

  if (shouldReplaceSymbol(token.symbol, metadata.symbol)) {
    updated.symbol = metadata.symbol ?? updated.symbol
    changed = true
  }

  if (shouldReplaceImage(token.image_uri, metadata.image)) {
    updated.image_uri = metadata.image ?? updated.image_uri
    changed = true
  }

  if (metadata.description && (!token.description || token.description.trim().length === 0)) {
    updated.description = metadata.description
    changed = true
  }

  if (metadata.website && !token.website) {
    updated.website = metadata.website
    changed = true
  }

  if (metadata.twitter && !token.twitter) {
    updated.twitter = metadata.twitter
    changed = true
  }

  if (metadata.telegram && !token.telegram) {
    updated.telegram = metadata.telegram
    changed = true
  }

  if (metadata.createdTimestamp && !token.created_timestamp) {
    updated.created_timestamp = metadata.createdTimestamp
    changed = true
  }

  if (
    metadata.kingOfTheHillTimestamp &&
    (token.king_of_the_hill_timestamp === undefined || token.king_of_the_hill_timestamp === null)
  ) {
    updated.king_of_the_hill_timestamp = metadata.kingOfTheHillTimestamp
    changed = true
  }

  return { updated, changed }
}

function mergeMetadataIntoTrade(trade: Trade, metadata: TokenMetadata): { updated: Trade; changed: boolean } {
  let changed = false
  const updated: Trade = { ...trade }

  if (shouldReplaceName(trade.name, metadata.name)) {
    updated.name = metadata.name ?? updated.name
    changed = true
  }

  if (shouldReplaceSymbol(trade.symbol, metadata.symbol)) {
    updated.symbol = metadata.symbol ?? updated.symbol
    changed = true
  }

  if (shouldReplaceImage(trade.image_uri, metadata.image)) {
    updated.image_uri = metadata.image ?? updated.image_uri
    changed = true
  }

  if (metadata.description && (!trade.description || trade.description.trim().length === 0)) {
    updated.description = metadata.description
    changed = true
  }

  if (metadata.website && !trade.website) {
    updated.website = metadata.website
    changed = true
  }

  if (metadata.twitter && !trade.twitter) {
    updated.twitter = metadata.twitter
    changed = true
  }

  if (metadata.telegram && !trade.telegram) {
    updated.telegram = metadata.telegram
    changed = true
  }

  if (metadata.createdTimestamp && !trade.created_timestamp) {
    updated.created_timestamp = metadata.createdTimestamp
    changed = true
  }

  if (
    metadata.kingOfTheHillTimestamp &&
    (trade.king_of_the_hill_timestamp === undefined || trade.king_of_the_hill_timestamp === null)
  ) {
    updated.king_of_the_hill_timestamp = metadata.kingOfTheHillTimestamp
    changed = true
  }

  return { updated, changed }
}

async function persistMetadataToDatabase(mint: string, metadata: TokenMetadata) {
  try {
    await db.trades.where("mint").equals(mint).modify((stored) => {
      if (shouldReplaceName(stored.name, metadata.name)) {
        stored.name = metadata.name ?? stored.name
      }

      if (shouldReplaceSymbol(stored.symbol, metadata.symbol)) {
        stored.symbol = metadata.symbol ?? stored.symbol
      }

      if (shouldReplaceImage(stored.image_uri, metadata.image)) {
        stored.image_uri = metadata.image ?? stored.image_uri
      }

      if (metadata.description && (!stored.description || stored.description.trim().length === 0)) {
        stored.description = metadata.description
      }

      if (metadata.website && !stored.website) {
        stored.website = metadata.website
      }

      if (metadata.twitter && !stored.twitter) {
        stored.twitter = metadata.twitter
      }

      if (metadata.telegram && !stored.telegram) {
        stored.telegram = metadata.telegram
      }

      if (metadata.createdTimestamp && !stored.created_timestamp) {
        stored.created_timestamp = metadata.createdTimestamp
      }

      if (
        metadata.kingOfTheHillTimestamp &&
        (stored.king_of_the_hill_timestamp === undefined || stored.king_of_the_hill_timestamp === null)
      ) {
        stored.king_of_the_hill_timestamp = metadata.kingOfTheHillTimestamp
      }
    })
  } catch (error) {
    console.error(`[v0] Failed to persist metadata for mint ${mint}:`, error)
  }
}

export function useVisibleTokenMetadata({ paginatedTokens, setTokens, setAllTrades }: UseVisibleTokenMetadataParams) {
  useEffect(() => {
    if (paginatedTokens.length === 0) {
      return
    }

    let isCancelled = false

    const applyMetadata = (mint: string, metadata: TokenMetadata) => {
      if (isCancelled) {
        return
      }

      setTokens((prev) => {
        const existing = prev.get(mint)
        if (!existing) {
          return prev
        }

        const { updated, changed } = mergeMetadataIntoToken(existing, metadata)
        if (!changed) {
          return prev
        }

        const next = new Map(prev)
        next.set(mint, updated)
        return next
      })

      setAllTrades((prev) => {
        let changed = false
        const updatedTrades = prev.map((trade) => {
          if (trade.mint !== mint) {
            return trade
          }

          const { updated, changed: tradeChanged } = mergeMetadataIntoTrade(trade, metadata)
          if (tradeChanged) {
            changed = true
            if (process.env.NEXT_PUBLIC_LOG_METADATA === "true") {
              console.log("[metadata] applied metadata to trade", mint, trade.signature)
            }
            return updated
          }

          return trade
        })

        return changed ? updatedTrades : prev
      })

      void persistMetadataToDatabase(mint, metadata)
    }

    const loadMetadata = async () => {
      for (const token of paginatedTokens) {
        if (!token?.mint) {
          continue
        }

        if (tokenHasMetadata(token)) {
          if (process.env.NEXT_PUBLIC_LOG_METADATA === "true") {
            console.log("[metadata] skipping fetch (token already has metadata)", token.mint)
          }
          primeTokenMetadataCache(token.mint, {
            name: token.name,
            symbol: token.symbol,
            image: token.image_uri,
            description: token.description ?? null,
            website: token.website ?? null,
            twitter: token.twitter ?? null,
            telegram: token.telegram ?? null,
            createdTimestamp: token.created_timestamp ?? null,
            kingOfTheHillTimestamp: token.king_of_the_hill_timestamp ?? null,
          })
          continue
        }

        const cached = hasCachedTokenMetadata(token.mint)
          ? getCachedTokenMetadata(token.mint) ?? null
          : undefined

        if (cached === null) {
          if (process.env.NEXT_PUBLIC_LOG_METADATA === "true") {
            console.log("[metadata] cached null (skip)", token.mint)
          }
          continue
        }

        if (cached) {
          if (process.env.NEXT_PUBLIC_LOG_METADATA === "true") {
            console.log("[metadata] apply cached metadata", token.mint)
          }
          applyMetadata(token.mint, cached)
          continue
        }

        if (process.env.NEXT_PUBLIC_LOG_METADATA === "true") {
          console.log("[metadata] fetching metadata for visible token", token.mint)
        }

        const fetched = await fetchTokenMetadataWithCache(token.mint)
        if (process.env.NEXT_PUBLIC_LOG_METADATA === "true") {
          console.log("[metadata] fetch result", token.mint, fetched ? "value" : "null")
        }
        if (fetched) {
          applyMetadata(token.mint, fetched)
        }
      }
    }

    void loadMetadata()

    return () => {
      isCancelled = true
    }
  }, [paginatedTokens, setTokens, setAllTrades])
}
