"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { db, type StoredTrade } from "@/lib/db"

// Define the Trade type based on the WebSocket data
export interface Trade {
  mint: string
  name: string
  symbol: string
  image_uri: string
  usd_market_cap: number
  market_cap: number
  sol_amount: number // Raw lamports amount
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

interface PumpUnifiedTrade {
  slotIndexId: string
  tx: string // signature
  timestamp: string // ISO8601
  isBondingCurve: boolean
  program: "pump" | "pump_amm" | string
  mintAddress: string
  quoteMintAddress: string
  poolAddress: string
  userAddress: string
  type: "buy" | "sell"
  marketCap?: number | string
  baseAmount?: number | string
  quoteAmount?: number | string
  amountSol?: number | string
  amountUsd?: number | string
  priceQuotePerBase?: number | string
  priceBasePerQuote?: number | string
  priceUsd?: number | string
  priceSol?: number | string
  protocolFee?: number | string
  protocolFeeUsd?: number | string
  lpFee?: number | string
  lpFeeUsd?: number | string
  creatorAddress?: string
  coinMeta?: {
    name?: string
    symbol?: string
    uri?: string
    mint?: string
    bondingCurve?: string
    creator?: string
    createdTs?: number
  }
}

function decodePumpPayload(rawPayload: string): PumpUnifiedTrade | null {
  try {
    let working = rawPayload.trim()

    // Remove outer quotes if present (handles "\"{}\"" patterns)
    while (working.startsWith('"') && working.endsWith('"')) {
      try {
        working = JSON.parse(working)
      } catch {
        break
      }
    }

    // Check if it's base64 encoded
    if (working.length % 4 === 0 && /^[A-Za-z0-9+/=]+$/.test(working)) {
      try {
        working = atob(working)
      } catch {
        // Not valid base64, continue
      }
    }

    // Unescape any remaining escaped quotes
    working = working.replace(/\\"/g, '"')

    // Try to parse as JSON
    try {
      return JSON.parse(working) as PumpUnifiedTrade
    } catch {
      // Try truncating to last }
      const lastBrace = working.lastIndexOf("}")
      if (lastBrace !== -1) {
        return JSON.parse(working.slice(0, lastBrace + 1)) as PumpUnifiedTrade
      }
    }

    return null
  } catch (error) {
    console.error("[v0] Failed to decode Pump payload:", error)
    return null
  }
}

function convertPumpTradeToLocal(pumpTrade: PumpUnifiedTrade): Trade {
  const timestampMs = typeof pumpTrade.timestamp === "string" ? new Date(pumpTrade.timestamp).getTime() : Date.now()

  return {
    mint: pumpTrade.mintAddress,
    name: pumpTrade.coinMeta?.name || "Unknown",
    symbol: pumpTrade.coinMeta?.symbol || "???",
    image_uri: pumpTrade.coinMeta?.uri || "",
    usd_market_cap: Number(pumpTrade.marketCap || 0),
    market_cap: Number(pumpTrade.marketCap || 0),
    sol_amount: Number(pumpTrade.amountSol || pumpTrade.quoteAmount || 0),
    is_buy: pumpTrade.type === "buy",
    user: pumpTrade.userAddress,
    creator: pumpTrade.creatorAddress || pumpTrade.coinMeta?.creator || "",
    creator_username: "",
    token_amount: Number(pumpTrade.baseAmount || 0),
    total_supply: 0, // Not provided in new format
    timestamp: Math.floor(timestampMs / 1000),
    virtual_sol_reserves: 0, // Not provided in new format
    virtual_token_reserves: 0, // Not provided in new format
    signature: pumpTrade.tx,
    created_timestamp: pumpTrade.coinMeta?.createdTs,
    website: null,
    twitter: null,
    telegram: null,
    king_of_the_hill_timestamp: pumpTrade.isBondingCurve ? null : timestampMs,
  }
}

export function useWebSocketTrades(setAllTrades: React.Dispatch<React.SetStateAction<Trade[]>>) {
  const [isConnected, setIsConnected] = useState<boolean>(false)
  const socketRef = useRef<WebSocket | null>(null)
  const messageBufferRef = useRef<string>("")
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const pendingMsgRef = useRef<{ size: number } | null>(null)
  const connectionStateRef = useRef<"connecting" | "waiting_info" | "sent_connect" | "ready">("connecting")

  useEffect(() => {
    console.log("[v0] Setting up Pump.fun NATS WebSocket connection (direct)")

    let isUnmounting = false

    const connect = () => {
      if (isUnmounting) return

      try {
        connectionStateRef.current = "waiting_info"

        const socket = new WebSocket("wss://unified-prod.nats.realtime.pump.fun/")
        socketRef.current = socket

        socket.onopen = () => {
          console.log("[v0] NATS WebSocket opened, waiting for INFO from server")
        }

        socket.onmessage = (event) => {
          const data = event.data as string
          messageBufferRef.current += data

          const lines = messageBufferRef.current.split("\r\n")

          if (!messageBufferRef.current.endsWith("\r\n")) {
            messageBufferRef.current = lines.pop() || ""
          } else {
            messageBufferRef.current = ""
          }

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            if (!line) continue

            if (line.startsWith("INFO ")) {
              console.log("[v0] Received INFO from server, sending CONNECT with credentials")

              // Send CONNECT frame with static credentials
              const connectPayload = JSON.stringify({
                user: "subscriber",
                pass: "OX745xvUbNQMuFqV",
                no_responders: true,
                protocol: 1,
                verbose: false,
                pedantic: false,
                lang: "nats.ws",
                version: "1.30.3",
                headers: true,
              })
              socket.send(`CONNECT ${connectPayload}\r\n`)

              // Immediately send PING after CONNECT
              socket.send("PING\r\n")

              connectionStateRef.current = "sent_connect"
              continue
            }

            if (line.startsWith("+OK")) {
              console.log("[v0] Received +OK, connection accepted")
              continue
            }

            if (line === "PING") {
              socket.send("PONG\r\n")
              continue
            }

            if (line === "PONG") {
              if (connectionStateRef.current === "sent_connect") {
                console.log("[v0] Received PONG, sending subscription")
                connectionStateRef.current = "ready"
                setIsConnected(true)

                // Subscribe to unified trade events (no wildcard needed)
                socket.send("SUB unifiedTradeEvent.processed sub0\r\n")
                console.log("[v0] Subscribed to unifiedTradeEvent.processed")

                // Start ping interval
                pingIntervalRef.current = setInterval(() => {
                  if (socket.readyState === WebSocket.OPEN) {
                    socket.send("PING\r\n")
                  }
                }, 30000)
              }
              continue
            }

            if (line.startsWith("MSG ")) {
              const parts = line.split(" ")
              const payloadSize = Number.parseInt(parts[parts.length - 1], 10)

              i++
              if (i < lines.length) {
                const payload = lines[i]
                console.log("[v0] Received trade payload, size:", payload.length)

                const decoded = decodePumpPayload(payload)
                if (decoded) {
                  console.log("[v0] Successfully decoded trade:", decoded.mintAddress, decoded.type)
                  const trade = convertPumpTradeToLocal(decoded)
                  handleTrade(trade)
                } else {
                  console.error("[v0] Failed to decode payload:", payload.slice(0, 200))
                }
              }
            }
          }
        }

        socket.onerror = (error) => {
          console.error("[v0] NATS WebSocket error:", error)
          setIsConnected(false)
        }

        socket.onclose = (event) => {
          console.log(`[v0] NATS WebSocket closed: ${event.code} ${event.reason}`)
          setIsConnected(false)
          connectionStateRef.current = "connecting"

          if (pingIntervalRef.current) {
            clearInterval(pingIntervalRef.current)
            pingIntervalRef.current = null
          }

          if (!isUnmounting) {
            reconnectTimeoutRef.current = setTimeout(() => {
              console.log("[v0] Attempting to reconnect...")
              connect()
            }, 5000)
          }
        }
      } catch (error) {
        console.error("[v0] Failed to create WebSocket:", error)
        setIsConnected(false)

        if (!isUnmounting) {
          reconnectTimeoutRef.current = setTimeout(connect, 5000)
        }
      }
    }

    const handleTrade = async (newTrade: Trade) => {
      newTrade.received_time = Date.now()

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
        const oneHourAgo = Date.now() - 60 * 60 * 1000
        const filteredTrades = prevTrades.filter(
          (trade) => (trade.received_time || trade.timestamp * 1000) >= oneHourAgo,
        )
        return [...filteredTrades, newTrade]
      })
    }

    connect()

    return () => {
      isUnmounting = true
      console.log("[v0] Cleaning up NATS WebSocket connection")

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }

      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current)
      }

      if (socketRef.current) {
        socketRef.current.close()
        socketRef.current = null
      }

      setIsConnected(false)
    }
  }, [setAllTrades])

  return { isConnected }
}
