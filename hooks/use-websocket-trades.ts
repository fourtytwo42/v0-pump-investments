"use client"

import type React from "react"

import { useEffect, useRef, useState } from "react"

import { db, type StoredTrade } from "@/lib/db"
import type { Trade } from "@/lib/pump-trades"
import { convertPumpTradeToLocal, decodePumpPayload, normalizeIpfsUri } from "@/lib/pump-trades"

export type { Trade }

const RECONNECT_DELAY_MS = 5000
const TRADE_RETENTION_MS = 60 * 60 * 1000

type TokenMetadata = {
  name?: string
  symbol?: string
  description?: string
  image?: string
  twitter?: string
  telegram?: string
  website?: string
}

export function useWebSocketTrades(setAllTrades: React.Dispatch<React.SetStateAction<Trade[]>>) {
  const [isConnected, setIsConnected] = useState<boolean>(false)
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const signatureSetRef = useRef<Set<string>>(new Set())
  const metadataCacheRef = useRef<Map<string, TokenMetadata>>(new Map())
  const metadataFetchRef = useRef<Map<string, Promise<TokenMetadata | null>>>(new Map())

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

    const fetchMetadata = async (metadataUri: string | null | undefined): Promise<TokenMetadata | null> => {
      const normalized = normalizeIpfsUri(metadataUri)
      if (!normalized) {
        return null
      }

      if (metadataCacheRef.current.has(normalized)) {
        return metadataCacheRef.current.get(normalized) ?? null
      }

      if (metadataFetchRef.current.has(normalized)) {
        return metadataFetchRef.current.get(normalized) ?? null
      }

      const controller = new AbortController()
      const fetchPromise = (async () => {
        try {
          const response = await fetch(normalized, {
            signal: controller.signal,
            cache: "force-cache",
            headers: { Accept: "application/json" },
          })

          if (!response.ok) {
            console.error("[v0] Metadata request failed:", normalized, response.status)
            return null
          }

          const data = (await response.json()) as Record<string, unknown>
          const dataRecord = data as Record<string, unknown>
          const rawExtensions =
            (typeof data === "object" && data !== null
              ? (dataRecord.extensions as Record<string, unknown> | undefined) ??
                (dataRecord.extension as Record<string, unknown> | undefined) ??
                (dataRecord.links as Record<string, unknown> | undefined) ??
                (dataRecord.socials as Record<string, unknown> | undefined)
              : undefined) || undefined

          const getDataString = (key: string): string | undefined => {
            const value = dataRecord[key]
            return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
          }

          const getExtensionString = (key: string): string | undefined => {
            if (!rawExtensions) return undefined
            const value = rawExtensions[key]
            return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
          }

          const pickString = (...values: (string | undefined)[]): string | undefined => {
            for (const value of values) {
              if (typeof value === "string" && value.trim().length > 0) {
                return value.trim()
              }
            }
            return undefined
          }

          const imageSource = pickString(
            getDataString("image"),
            getDataString("image_uri"),
            getDataString("imageUrl"),
            getDataString("imageUri"),
            getExtensionString("image"),
            getExtensionString("image_uri"),
            getExtensionString("imageUrl"),
            getExtensionString("imageUri"),
          )

          const metadata: TokenMetadata = {
            name: pickString(getDataString("name"), getDataString("title"), getExtensionString("name"), getExtensionString("title")),
            symbol: pickString(getDataString("symbol"), getExtensionString("symbol")),
            description: pickString(
              getDataString("description"),
              getDataString("summary"),
              getDataString("details"),
              getExtensionString("description"),
            ),
            image: normalizeIpfsUri(imageSource) ?? imageSource,
            twitter: pickString(getDataString("twitter"), getDataString("x"), getExtensionString("twitter"), getExtensionString("twitter_username")),
            telegram: pickString(getDataString("telegram"), getExtensionString("telegram"), getExtensionString("telegram_username")),
            website: pickString(
              getDataString("website"),
              getDataString("external_url"),
              getDataString("externalUrl"),
              getExtensionString("website"),
              getExtensionString("site"),
            ),
          }

          metadataCacheRef.current.set(normalized, metadata)
          return metadata
        } catch (error) {
          if ((error as Error).name !== "AbortError") {
            console.error("[v0] Metadata fetch error:", error)
          }
          return null
        } finally {
          metadataFetchRef.current.delete(normalized)
        }
      })()

      metadataFetchRef.current.set(normalized, fetchPromise)
      const result = await fetchPromise
      return result
    }

    const enrichTrade = async (trade: Trade): Promise<Trade> => {
      const metadata = await fetchMetadata(trade.metadata_uri)
      if (!metadata) {
        return trade
      }

      return {
        ...trade,
        name: metadata.name ?? trade.name,
        symbol: metadata.symbol ?? trade.symbol,
        description: metadata.description ?? trade.description ?? null,
        image_uri: metadata.image ?? trade.image_uri,
        twitter: metadata.twitter ?? trade.twitter ?? null,
        telegram: metadata.telegram ?? trade.telegram ?? null,
        website: metadata.website ?? trade.website ?? null,
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
            void handleTrade(message.trade)
            return
          }

          if (message.type === "raw" && typeof message.payload === "string") {
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
