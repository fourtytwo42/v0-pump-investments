"use client"

import type React from "react"

import { useEffect, useRef, useState } from "react"

import { db, type StoredTrade } from "@/lib/db"
import type { Trade } from "@/lib/pump-trades"
import { convertPumpTradeToLocal, decodePumpPayload } from "@/lib/pump-trades"

export type { Trade }

const RECONNECT_DELAY_MS = 5000
const TRADE_RETENTION_MS = 60 * 60 * 1000

export function useWebSocketTrades(setAllTrades: React.Dispatch<React.SetStateAction<Trade[]>>) {
  const [isConnected, setIsConnected] = useState<boolean>(false)
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const signatureSetRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    let isUnmounting = false

    const handleTrade = async (incomingTrade: Trade) => {
      const trimmedMint = incomingTrade.mint?.trim()
      const trimmedSignature = incomingTrade.signature?.trim()

      if (!trimmedMint || !trimmedSignature) {
        return
      }

      if (signatureSetRef.current.has(trimmedSignature)) {
        return
      }

      signatureSetRef.current.add(trimmedSignature)

      const newTrade: Trade = {
        ...incomingTrade,
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
        const envUrl = process.env.NEXT_PUBLIC_PUMP_PROXY_WS
        const protocol = window.location.protocol === "https:" ? "wss" : "ws"
        const defaultHost = window.location.hostname || "localhost"
        const defaultPort = "4000"
        const socketUrl = envUrl ?? `${protocol}://${defaultHost}:${defaultPort}`
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
