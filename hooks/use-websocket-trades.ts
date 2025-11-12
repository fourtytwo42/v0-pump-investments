"use client"

import type React from "react"

import { useEffect, useRef, useState } from "react"

import { db, type StoredTrade } from "@/lib/db"
import type { Trade } from "@/lib/pump-trades"
import { convertPumpTradeToLocal, decodePumpPayload, normalizeIpfsUri } from "@/lib/pump-trades"
import {
  cacheTokenMetadata,
  fetchTokenMetadataWithCache,
  getCachedTokenMetadata,
  hasCachedTokenMetadata,
} from "@/lib/token-metadata-cache"
import { normalizeTokenMetadata, type TokenMetadata as PumpTokenMetadata } from "@/lib/token-metadata"

type ProxyMessage = {
  type?: string
  state?: string
  trade?: Trade
  mint?: string
  metadata?: unknown
  metadata_uri?: string | null
  metadataUri?: string | null
  coin?: unknown
  payload?: string
}

function logMetadata(message: string, ...args: unknown[]) {
  if (process.env.NEXT_PUBLIC_LOG_METADATA === "true") {
    console.log(message, ...args)
  }
}

export type { Trade }

const RECONNECT_DELAY_MS = 5000
const TRADE_RETENTION_MS = 60 * 60 * 1000
const METADATA_WAIT_TIMEOUT_MS = 2500

export function useWebSocketTrades(setAllTrades: React.Dispatch<React.SetStateAction<Trade[]>>) {
  const [isConnected, setIsConnected] = useState<boolean>(false)
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const signatureSetRef = useRef<Set<string>>(new Set())
  const metadataFetchByMintRef = useRef<Map<string, Promise<PumpTokenMetadata | null>>>(new Map())
  const metadataWaitersRef = useRef<
    Map<string, { resolve: (metadata: PumpTokenMetadata | null) => void; timeoutId: NodeJS.Timeout }>
  >(new Map())

  useEffect(() => {
    let isUnmounting = false

    const applyMetadataToExistingTrades = (
      mint: string,
      metadata: PumpTokenMetadata | null,
      metadataUri: string | null,
    ) => {
      if (!metadata) {
        return
      }

      logMetadata("[metadata] websocket applying metadata to cached trades", mint)

      setAllTrades((prevTrades) => {
        let changed = false

        const updatedTrades = prevTrades.map((trade) => {
          if (trade.mint !== mint) {
            return trade
          }

          let tradeChanged = false
          const next: Trade = { ...trade }

          const safeName = metadata.name?.trim() || null
          const safeSymbol = metadata.symbol?.trim() || null
          const safeDescription = metadata.description?.trim() || null
          const safeImage = metadata.image?.trim() || null
          const safeWebsite = metadata.website?.trim() || null
          const safeTwitter = metadata.twitter?.trim() || null
          const safeTelegram = metadata.telegram?.trim() || null

          if (safeName && safeName !== trade.name) {
            next.name = safeName
            tradeChanged = true
          }

          if (safeSymbol && safeSymbol !== trade.symbol) {
            next.symbol = safeSymbol
            tradeChanged = true
          }

          if (safeDescription && safeDescription !== trade.description) {
            next.description = safeDescription
            tradeChanged = true
          }

          if (safeImage && safeImage !== trade.image_uri) {
            next.image_uri = safeImage
            tradeChanged = true
          }

          if (safeWebsite && safeWebsite !== trade.website) {
            next.website = safeWebsite
            tradeChanged = true
          }

          if (safeTwitter && safeTwitter !== trade.twitter) {
            next.twitter = safeTwitter
            tradeChanged = true
          }

          if (safeTelegram && safeTelegram !== trade.telegram) {
            next.telegram = safeTelegram
            tradeChanged = true
          }

          if (
            metadata.createdTimestamp !== undefined &&
            metadata.createdTimestamp !== null &&
            !trade.created_timestamp
          ) {
            next.created_timestamp = metadata.createdTimestamp ?? undefined
            tradeChanged = true
          }

          if (
            metadata.kingOfTheHillTimestamp !== undefined &&
            metadata.kingOfTheHillTimestamp !== null &&
            (trade.king_of_the_hill_timestamp === undefined || trade.king_of_the_hill_timestamp === null)
          ) {
            next.king_of_the_hill_timestamp = metadata.kingOfTheHillTimestamp ?? null
            tradeChanged = true
          }

          if (metadataUri && metadataUri !== trade.metadata_uri) {
            next.metadata_uri = metadataUri
            tradeChanged = true
          }

          if (typeof metadata.complete === "boolean" && next.is_completed !== metadata.complete) {
            if (metadata.complete === true || next.is_completed === undefined) {
              next.is_completed = metadata.complete
              tradeChanged = true
            }
          }

          if (typeof metadata.complete === "boolean") {
            if (metadata.complete === true) {
              if (next.is_bonding_curve !== false) {
                next.is_bonding_curve = false
                tradeChanged = true
              }
            } else if (next.is_bonding_curve === undefined || next.is_bonding_curve === null) {
              next.is_bonding_curve = true
              tradeChanged = true
            }
          }

          if (metadata.bondingCurve && metadata.bondingCurve !== trade.bonding_curve) {
            next.bonding_curve = metadata.bondingCurve
            tradeChanged = true
          }

          if (
            metadata.associatedBondingCurve &&
            metadata.associatedBondingCurve !== trade.associated_bonding_curve
          ) {
            next.associated_bonding_curve = metadata.associatedBondingCurve
            tradeChanged = true
          }

          if (tradeChanged) {
            changed = true
            return next
          }

          return trade
        })

        return changed ? updatedTrades : prevTrades
      })
    }

    const resolveProxyUrl = () => {
      if (process.env.NEXT_PUBLIC_PUMP_PROXY_WS) {
        return process.env.NEXT_PUBLIC_PUMP_PROXY_WS
      }

      const hostname = window.location.hostname || "127.0.0.1"

      if (hostname === "localhost" || hostname === "127.0.0.1") {
        const protocol = window.location.protocol === "https:" ? "wss" : "ws"
        const port = process.env.NEXT_PUBLIC_PUMP_PROXY_PORT || "4000"
        return `${protocol}://localhost:${port}`
      }

      if (hostname === "pump.investments" || hostname.endsWith(".pump.investments")) {
        return "wss://ws.pump.investments"
      }

      const protocol = window.location.protocol === "https:" ? "wss" : "ws"
      const port = process.env.NEXT_PUBLIC_PUMP_PROXY_PORT || "4000"
      return `${protocol}://${hostname}:${port}`
    }

    const fetchMetadataForMint = async (
      mint: string,
      metadataUri: string | null | undefined,
    ): Promise<PumpTokenMetadata | null> => {
      if (!mint) {
        return null
      }

      const cached = hasCachedTokenMetadata(mint) ? getCachedTokenMetadata(mint) ?? null : undefined
      if (cached !== undefined) {
        return cached
      }

      if (metadataFetchByMintRef.current.has(mint)) {
        return metadataFetchByMintRef.current.get(mint) ?? null
      }

      const waitPromise = new Promise<PumpTokenMetadata | null>((resolve) => {
        const timeoutId = setTimeout(async () => {
          metadataWaitersRef.current.delete(mint)
          metadataFetchByMintRef.current.delete(mint)
          logMetadata("[metadata] websocket fallback to client fetch", mint)

          const fallback = await fetchTokenMetadataWithCache(mint, metadataUri ?? null)
          if (fallback) {
            cacheTokenMetadata(mint, fallback)
            applyMetadataToExistingTrades(mint, fallback, normalizeIpfsUri(metadataUri) ?? null)
          } else if (metadataUri) {
            cacheTokenMetadata(mint, null)
          }

          resolve(fallback ?? null)
        }, METADATA_WAIT_TIMEOUT_MS)

        metadataWaitersRef.current.set(mint, { resolve, timeoutId })
      })

      metadataFetchByMintRef.current.set(mint, waitPromise)
      return waitPromise
    }

    const handleTrade = async (incomingTrade: Trade) => {
      const trimmedMint = incomingTrade.mint?.trim()
      const trimmedSignature = incomingTrade.signature?.trim()

      if (!trimmedMint || !trimmedSignature) {
        return
      }

      if (signatureSetRef.current.has(trimmedSignature)) {
        return
      }

      const normalizedTrade: Trade = {
        ...incomingTrade,
        is_completed: incomingTrade.is_completed ?? false,
        is_bonding_curve:
          incomingTrade.is_bonding_curve ??
          (incomingTrade.is_completed === true ? false : true),
      }

      void fetchMetadataForMint(trimmedMint, normalizedTrade.metadata_uri)

      signatureSetRef.current.add(trimmedSignature)

      const newTrade: Trade = {
        ...normalizedTrade,
        mint: trimmedMint,
        signature: trimmedSignature,
        received_time: Date.now(),
      }

      try {
        const receivedTime = newTrade.received_time ?? Date.now()
        const storedTrade: StoredTrade = {
          ...newTrade,
          id: `${newTrade.mint}-${newTrade.timestamp}-${newTrade.signature}`,
          received_time: receivedTime,
        }
        await db.addTrade(storedTrade)
      } catch (error) {
        console.error("[v0] Error storing trade:", error)
      }

      setAllTrades((prevTrades) => {
        const cutoff = Date.now() - TRADE_RETENTION_MS
        const filtered = prevTrades.filter((trade) => (trade.received_time ?? trade.timestamp * 1000) >= cutoff)
        const withoutDuplicate = filtered.filter((trade) => trade.signature !== trimmedSignature)
        const updated = [...withoutDuplicate, newTrade]
        signatureSetRef.current = new Set(updated.map((trade) => trade.signature))
        return updated
      })
    }

    const connect = () => {
      if (isUnmounting) return

      try {
        const socketUrl = resolveProxyUrl()
        console.log("[v0] Connecting to Pump.fun proxy websocket:", socketUrl)

        const socket = new WebSocket(socketUrl)
        socketRef.current = socket

        socket.onopen = () => {
          console.log("[v0] Proxy websocket connected")
        }

        socket.onmessage = (event) => {
          if (typeof event.data !== "string") {
            return
          }

          logMetadata("[metadata] websocket received message raw", event.data.slice(0, 200))

          let message: ProxyMessage | null = null

          try {
            message = JSON.parse(event.data) as ProxyMessage
          } catch (error) {
            console.error("[v0] Failed to parse proxy message:", error, event.data)
            return
          }

          if (!message || typeof message !== "object") {
            return
          }

          if (message.type === "status") {
            setIsConnected(message.state === "ready")
            return
          }

          if (message.type === "trade" && message.trade) {
            logMetadata("[metadata] websocket received proxied trade", message.trade.mint)
            void handleTrade(message.trade)
            return
          }

          if (message.type === "metadata" && typeof message.mint === "string") {
            const mint = message.mint.trim()
            if (!mint) {
              return
            }

            const metadataUri = normalizeIpfsUri((message.metadata_uri ?? message.metadataUri) as string | null | undefined)
            const rawMetadata =
              message.metadata && typeof message.metadata === "object" ? (message.metadata as Record<string, unknown>) : null
            const coinMetadata =
              message.coin && typeof message.coin === "object" ? (message.coin as Record<string, unknown>) : null

            let normalizedMetadata: PumpTokenMetadata | null = null
            if (rawMetadata) {
              normalizedMetadata = normalizeTokenMetadata(rawMetadata)
            } else if (coinMetadata) {
              normalizedMetadata = normalizeTokenMetadata(coinMetadata)
            }

            if (normalizedMetadata) {
              cacheTokenMetadata(mint, normalizedMetadata)
              applyMetadataToExistingTrades(mint, normalizedMetadata, metadataUri ?? null)
            } else if (metadataUri) {
              cacheTokenMetadata(mint, null)
            }

            const waiter = metadataWaitersRef.current.get(mint)
            if (waiter) {
              clearTimeout(waiter.timeoutId)
              metadataWaitersRef.current.delete(mint)
              metadataFetchByMintRef.current.delete(mint)
              waiter.resolve(normalizedMetadata)
            } else {
              metadataFetchByMintRef.current.delete(mint)
            }

            return
          }

          if (message.type === "raw" && typeof message.payload === "string") {
            logMetadata("[metadata] websocket decoding raw payload", message.payload.slice(0, 200))
            const decoded = decodePumpPayload(message.payload)
            if (!decoded) {
              return
            }

            const trade = convertPumpTradeToLocal(decoded)
            if (!trade.mint || !trade.signature) {
              return
            }

            void handleTrade(trade)
          }
        }

        socket.onerror = (error) => {
          console.error("[v0] Proxy websocket error:", error)
          setIsConnected(false)
        }

        socket.onclose = (event) => {
          console.log(`[v0] Proxy websocket closed: ${event.code} ${event.reason}`)
          setIsConnected(false)

          if (!isUnmounting) {
            reconnectTimeoutRef.current = setTimeout(() => {
              console.log("[v0] Reconnecting to proxy websocket...")
              connect()
            }, RECONNECT_DELAY_MS)
          }
        }
      } catch (error) {
        console.error("[v0] Failed to create proxy websocket:", error)
        setIsConnected(false)

        if (!isUnmounting) {
          reconnectTimeoutRef.current = setTimeout(connect, RECONNECT_DELAY_MS)
        }
      }
    }

    connect()

    return () => {
      isUnmounting = true
      console.log("[v0] Cleaning up Pump.fun proxy websocket connection")

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }

      if (socketRef.current) {
        socketRef.current.close()
        socketRef.current = null
      }

      signatureSetRef.current.clear()
      for (const { timeoutId } of metadataWaitersRef.current.values()) {
        clearTimeout(timeoutId)
      }
      metadataWaitersRef.current.clear()
      metadataFetchByMintRef.current.clear()
      setIsConnected(false)
    }
  }, [setAllTrades])

  return { isConnected }
}
