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
  const mintAddress = (pumpTrade.mintAddress || "").trim()

  return {
    mint: mintAddress,
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
  const connectionStateRef = useRef<"connecting" | "waiting_info" | "sent_connect" | "ready">("connecting")
  const tradesByMintRef = useRef<Map<string, Trade[]>>(new Map())
  const signatureIndexRef = useRef<Set<string>>(new Set())
  const subscribedSidRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    console.log("[v0] Setting up Pump.fun NATS WebSocket connection (direct)")

    let isUnmounting = false

    const connect = () => {
      if (isUnmounting) return

      try {
        connectionStateRef.current = "waiting_info"

        const socket = new WebSocket("wss://unified-prod.nats.realtime.pump.fun/", ["nats"])
        socketRef.current = socket
        messageBufferRef.current = ""
        subscribedSidRef.current.clear()

        socket.onopen = () => {
          console.log("[v0] NATS WebSocket opened, waiting for INFO from server")
        }

        const reserveSid = (() => {
          let current = 1
          return () => String(current++)
        })()

        const ensurePingTimer = () => {
          if (pingIntervalRef.current) {
            return
          }

          pingIntervalRef.current = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send("PING\r\n")
            }
          }, 30000)
        }

        const handleControlLine = (line: string) => {
          if (!line) {
            return
          }

          if (line.startsWith("INFO ")) {
            console.log("[v0] Received INFO from server, sending CONNECT with credentials")

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

            socket.send(`CONNECT ${connectPayload}\r\nPING\r\n`)
            connectionStateRef.current = "sent_connect"
            return
          }

          if (line.startsWith("+OK")) {
            console.log("[v0] Received +OK, connection accepted")
            return
          }

          if (line === "PING") {
            socket.send("PONG\r\n")
            return
          }

          if (line === "PONG") {
            if (connectionStateRef.current === "sent_connect") {
              console.log("[v0] Received initial PONG, registering subscriptions")
              connectionStateRef.current = "ready"
              setIsConnected(true)

              const warmupSid = reserveSid()
              const warmupSubject = `_WARMUP_UNIFIED_${Date.now()}`
              socket.send(`SUB ${warmupSubject} ${warmupSid}\r\n`)
              socket.send(`UNSUB ${warmupSid}\r\n`)

              const processedSid = reserveSid()
              const wildcardSid = reserveSid()

              subscribedSidRef.current.add(processedSid)
              subscribedSidRef.current.add(wildcardSid)

              socket.send(`SUB unifiedTradeEvent.processed ${processedSid}\r\n`)
              socket.send(`SUB unifiedTradeEvent.processed.* ${wildcardSid}\r\n`)
              console.log("[v0] Subscribed to unified trade events", {
                processedSid,
                wildcardSid,
              })

              ensurePingTimer()
            }
            return
          }

          if (line.startsWith("-ERR")) {
            console.error("[v0] Received error from NATS server:", line)
            socket.close(4001, line)
            return
          }
        }

        const processPayload = (subject: string | undefined, sid: string | undefined, payload: string) => {
          if (!subject || !sid) {
            return
          }

          if (!subscribedSidRef.current.has(sid)) {
            return
          }

          if (!subject.startsWith("unifiedTradeEvent.processed")) {
            return
          }

          const decoded = decodePumpPayload(payload)
          if (!decoded) {
            console.error("[v0] Failed to decode payload:", payload.slice(0, 200))
            return
          }

          console.log("[v0] Successfully decoded trade:", decoded.mintAddress, decoded.type)
          const trade = convertPumpTradeToLocal(decoded)
          handleTrade(trade)
        }

        socket.onmessage = (event) => {
          if (typeof event.data !== "string") {
            return
          }

          messageBufferRef.current += event.data

          let buffer = messageBufferRef.current

          const restoreBuffer = (lineWithNewline: string, remaining: string) => {
            messageBufferRef.current = `${lineWithNewline}${remaining}`
          }

          while (buffer.length > 0) {
            const newlineIndex = buffer.indexOf("\n")
            if (newlineIndex === -1) {
              break
            }

            const lineWithNewline = buffer.slice(0, newlineIndex + 1)
            let line = lineWithNewline
            if (line.endsWith("\r\n")) {
              line = line.slice(0, -2)
            } else if (line.endsWith("\n")) {
              line = line.slice(0, -1)
            } else if (line.endsWith("\r")) {
              line = line.slice(0, -1)
            }

            buffer = buffer.slice(lineWithNewline.length)

            if (line.startsWith("MSG ")) {
              const parts = line.split(" ")
              const subject = parts[1]
              const sid = parts[2]
              const hasReply = parts.length === 5
              const sizeIndex = hasReply ? 4 : 3
              const payloadSize = Number.parseInt(parts[sizeIndex], 10)

              if (!Number.isFinite(payloadSize) || payloadSize < 0) {
                continue
              }

              if (buffer.length < payloadSize + 1) {
                restoreBuffer(lineWithNewline, buffer)
                return
              }

              const payload = buffer.slice(0, payloadSize)
              buffer = buffer.slice(payloadSize)

              if (buffer.startsWith("\r\n")) {
                buffer = buffer.slice(2)
              } else if (buffer.startsWith("\n")) {
                buffer = buffer.slice(1)
              } else if (buffer.startsWith("\r")) {
                buffer = buffer.slice(1)
              }

              processPayload(subject, sid, payload)
              continue
            }

            handleControlLine(line)
          }

          messageBufferRef.current = buffer
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

    const pruneAndReindexTrades = (cutoff: number) => {
      const signatureIndex = signatureIndexRef.current
      signatureIndex.clear()

      for (const [mint, trades] of tradesByMintRef.current) {
        const recentTrades = trades.filter((trade) => (trade.received_time || trade.timestamp * 1000) >= cutoff)

        if (recentTrades.length === 0) {
          tradesByMintRef.current.delete(mint)
          continue
        }

        tradesByMintRef.current.set(mint, recentTrades)
        for (const trade of recentTrades) {
          if (trade.signature) {
            signatureIndex.add(trade.signature)
          }
        }
      }
    }

    const flattenSortedTrades = () => {
      const aggregated: Trade[] = []
      for (const trades of tradesByMintRef.current.values()) {
        aggregated.push(...trades)
      }

      aggregated.sort((a, b) => {
        const timeA = a.received_time ?? a.timestamp * 1000
        const timeB = b.received_time ?? b.timestamp * 1000
        return timeA - timeB
      })

      return aggregated
    }

    const handleTrade = async (incomingTrade: Trade) => {
      const trimmedMint = incomingTrade.mint?.trim()
      const trimmedSignature = incomingTrade.signature?.trim()

      if (!trimmedMint || !trimmedSignature) {
        return
      }

      const newTrade: Trade = {
        ...incomingTrade,
        mint: trimmedMint,
        signature: trimmedSignature,
        received_time: Date.now(),
      }

      const cutoff = Date.now() - 60 * 60 * 1000
      pruneAndReindexTrades(cutoff)

      if (signatureIndexRef.current.has(trimmedSignature)) {
        return
      }

      const tradesForMint = tradesByMintRef.current.get(trimmedMint) ?? []
      tradesByMintRef.current.set(trimmedMint, [...tradesForMint, newTrade])
      signatureIndexRef.current.add(trimmedSignature)

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

      setAllTrades(flattenSortedTrades())
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

      tradesByMintRef.current.clear()
      signatureIndexRef.current.clear()
      subscribedSidRef.current.clear()
      setIsConnected(false)
    }
  }, [setAllTrades])

  return { isConnected }
}
