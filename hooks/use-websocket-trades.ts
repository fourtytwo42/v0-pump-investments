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
import { normalizeTokenMetadata, type TokenMetadata } from "@/lib/token-metadata"

function logMetadata(message: string, ...args: unknown[]) {
  if (process.env.NEXT_PUBLIC_LOG_METADATA === "true") {
    console.log(message, ...args)
  }
}

export type { Trade }

const RECONNECT_DELAY_MS = 5000
const TRADE_RETENTION_MS = 60 * 60 * 1000

export function useWebSocketTrades(setAllTrades: React.Dispatch<React.SetStateAction<Trade[]>>) {
  const [isConnected, setIsConnected] = useState<boolean>(false)
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const signatureSetRef = useRef<Set<string>>(new Set())
  const metadataFetchByMintRef = useRef<Map<string, Promise<TokenMetadata | null>>>(new Map())

  useEffect(() => {
    let isUnmounting = false

    const resolveProxyUrl = () => {
      if (process.env.NEXT_PUBLIC_PUMP_PROXY_WS) {
        return process.env.NEXT_PUBLIC_PUMP_PROXY_WS
      }

      const protocol = window.location.protocol === "https:" ? "wss" : "ws"
      const host = window.location.hostname || "127.0.0.1"
      const port = process.env.NEXT_PUBLIC_PUMP_PROXY_PORT || "4000"
      return `${protocol}://${host}:${port}`
    }

    const fetchMetadataForMint = async (mint: string, metadataUri: string | null | undefined): Promise<TokenMetadata | null> => {
      if (!mint) {
        return null
      }

      const cached = hasCachedTokenMetadata(mint) ? getCachedTokenMetadata(mint) ?? null : undefined
      if (cached !== undefined) {
        logMetadata("[metadata] websocket cache hit", mint, cached ? "value" : "null")
        return cached
      }

      if (metadataFetchByMintRef.current.has(mint)) {
        logMetadata("[metadata] websocket joining inflight", mint)
        return metadataFetchByMintRef.current.get(mint) ?? null
      }

      const request = (async () => {
        const fromPump = await fetchTokenMetadataWithCache(mint)
        if (fromPump) {
          logMetadata("[metadata] websocket received Pump.fun metadata", mint)
          return fromPump
        }

        const normalizedUri = normalizeIpfsUri(metadataUri) ?? metadataUri
        if (!normalizedUri) {
          cacheTokenMetadata(mint, null)
          return null
        }

        try {
          logMetadata("[metadata] websocket fetching metadata URI", mint, normalizedUri)
          const response = await fetch(normalizedUri, {
            cache: "force-cache",
            headers: { Accept: "application/json" },
          })

          if (!response.ok) {
            throw new Error(`Metadata URI responded with status ${response.status}`)
          }

          const raw = (await response.json()) as unknown
          const metadata = normalizeTokenMetadata(raw)

          cacheTokenMetadata(mint, metadata)
          logMetadata("[metadata] websocket normalized URI metadata", mint, metadata ? "value" : "null")
          return metadata
        } catch (error) {
          console.debug(`[metadata] Websocket metadata URI fetch failed for ${mint}:`, error)
          cacheTokenMetadata(mint, null)
          return null
        } finally {
          metadataFetchByMintRef.current.delete(mint)
        }
      })()

      metadataFetchByMintRef.current.set(mint, request)
      return request
    }

    const enrichTrade = async (incomingTrade: Trade): Promise<Trade> => {
      const metadata = await fetchMetadataForMint(incomingTrade.mint, incomingTrade.metadata_uri)
      if (!metadata) {
        return incomingTrade
      }

      logMetadata("[metadata] websocket applying metadata to trade", incomingTrade.mint, incomingTrade.signature)
      return {
        ...incomingTrade,
        name: metadata.name ?? incomingTrade.name,
        symbol: metadata.symbol ?? incomingTrade.symbol,
        description: metadata.description ?? incomingTrade.description ?? null,
        image_uri: metadata.image ?? incomingTrade.image_uri,
        twitter: metadata.twitter ?? incomingTrade.twitter ?? null,
        telegram: metadata.telegram ?? incomingTrade.telegram ?? null,
        website: metadata.website ?? incomingTrade.website ?? null,
        created_timestamp: incomingTrade.created_timestamp ?? metadata.createdTimestamp ?? undefined,
        king_of_the_hill_timestamp:
          incomingTrade.king_of_the_hill_timestamp ?? metadata.kingOfTheHillTimestamp ?? null,
      }
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

      const enrichedTrade = await enrichTrade({ ...incomingTrade, mint: trimmedMint, signature: trimmedSignature })

      signatureSetRef.current.add(trimmedSignature)

      const newTrade: Trade = {
        ...enrichedTrade,
        mint: trimmedMint,
        signature: trimmedSignature,
        received_time: Date.now(),
      }

      try {
        const storedTrade: StoredTrade = {
          ...newTrade,
          id: `${newTrade.mint}-${newTrade.timestamp}-${newTrade.signature}`,
          received_time: newTrade.received_time,
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

          let message: { type?: string; state?: string; trade?: Trade } | null = null

          try {
            message = JSON.parse(event.data)
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
      setIsConnected(false)
    }
  }, [setAllTrades])

  return { isConnected }
}
