#!/usr/bin/env tsx
/**
 * Diagnostic script to check where completed status comes from
 * Checks both the pump.fun API and websocket feed structure
 */

import { fetchPumpCoin } from "../lib/pump-coin"

// Test with a few known tokens - you can add more
const TEST_MINTS = [
  // Add some known mint addresses here - you can get these from your database
  // For now, we'll fetch a few random ones from the API
]

async function checkApiStructure(mint: string) {
  console.log(`\n${"=".repeat(80)}`)
  console.log(`Checking API structure for: ${mint}`)
  console.log(`${"=".repeat(80)}`)

  try {
    const coinInfo = await fetchPumpCoin(mint)
    
    if (!coinInfo) {
      console.log("❌ Token not found in API")
      return null
    }

    console.log("\n📦 Full API Response Structure:")
    console.log(JSON.stringify(coinInfo, null, 2))

    console.log("\n🔍 Checking for completed-related fields:")
    const coinRecord = coinInfo as Record<string, unknown>
    
    const completedFields = [
      "completed",
      "complete",
      "isCompleted",
      "is_completed",
      "graduated",
      "isGraduated",
      "is_graduated",
    ]

    for (const field of completedFields) {
      if (field in coinRecord) {
        console.log(`  ✓ Found: ${field} = ${JSON.stringify(coinRecord[field])} (type: ${typeof coinRecord[field]})`)
      }
    }

    console.log("\n🔍 Checking for bonding curve fields:")
    const bondingFields = [
      "bondingCurve",
      "bonding_curve",
      "associatedBondingCurve",
      "associated_bonding_curve",
    ]

    for (const field of bondingFields) {
      if (field in coinRecord) {
        const value = coinRecord[field]
        console.log(`  ✓ Found: ${field} = ${value ? `${String(value).slice(0, 20)}...` : "null/empty"} (type: ${typeof value})`)
      }
    }

    console.log("\n🔍 Checking metadata object (if present):")
    if (coinRecord.metadata && typeof coinRecord.metadata === "object") {
      const metadata = coinRecord.metadata as Record<string, unknown>
      console.log("  Metadata keys:", Object.keys(metadata))
      
      for (const field of completedFields) {
        if (field in metadata) {
          console.log(`  ✓ Found in metadata: ${field} = ${JSON.stringify(metadata[field])} (type: ${typeof metadata[field]})`)
        }
      }
    }

    return coinInfo
  } catch (error) {
    console.error("❌ Error fetching from API:", (error as Error).message)
    return null
  }
}

async function checkWebsocketStructure() {
  console.log(`\n${"=".repeat(80)}`)
  console.log("Checking WebSocket Feed Structure")
  console.log(`${"=".repeat(80)}`)

  // Connect to the NATS websocket (same as ingest service)
  const WebSocket = require("ws")
  const { decodePumpPayload } = require("../lib/pump-trades")
  
  const NATS_URL = "wss://unified-prod.nats.realtime.pump.fun/"
  const NATS_HEADERS = {
    Origin: "https://pump.fun",
    "User-Agent": "pump-investments-diagnostic/1.0",
  }
  const NATS_CONNECT_PAYLOAD = {
    type: "connect",
    channel: "PumpUnifiedTrade",
  }
  
  const ws = new WebSocket(NATS_URL, { headers: NATS_HEADERS })

  return new Promise<void>((resolve) => {
    let messageCount = 0
    const maxMessages = 10

    let messageBuffer = ""

  ws.on("open", () => {
      console.log("✅ Connected to NATS WebSocket")
      ws.send(JSON.stringify(NATS_CONNECT_PAYLOAD))
    })

    ws.on("message", (data: Buffer) => {
      messageCount++
      
      try {
        const chunk = data.toString()
        messageBuffer += chunk

        // Handle NATS protocol messages
        if (messageBuffer.startsWith("PING")) {
          ws.send("PONG\r\n")
          const newline = messageBuffer.indexOf("\r\n")
          messageBuffer = newline === -1 ? "" : messageBuffer.slice(newline + 2)
          return
        }

        if (messageBuffer.startsWith("PONG") || messageBuffer.startsWith("+OK") || messageBuffer.startsWith("INFO")) {
          const newline = messageBuffer.indexOf("\r\n")
          if (newline === -1) return
          messageBuffer = messageBuffer.slice(newline + 2)
          return
        }

        if (!messageBuffer.startsWith("MSG")) {
          const newline = messageBuffer.indexOf("\r\n")
          messageBuffer = newline === -1 ? "" : messageBuffer.slice(newline + 2)
          return
        }

        const headerEnd = messageBuffer.indexOf("\r\n")
        if (headerEnd === -1) return

        const header = messageBuffer.slice(0, headerEnd)
        const parts = header.split(" ")
        if (parts.length < 4) {
          messageBuffer = messageBuffer.slice(headerEnd + 2)
          return
        }

        const size = Number(parts[3])
        const totalLength = headerEnd + 2 + size + 2
        if (messageBuffer.length < totalLength) return

        const payload = messageBuffer.slice(headerEnd + 2, headerEnd + 2 + size)
        messageBuffer = messageBuffer.slice(totalLength)

        const trade = decodePumpPayload(payload)
        if (!trade) return
        
        console.log(`\n📨 WebSocket Message #${messageCount}:`)
        console.log(JSON.stringify(trade, null, 2))

        console.log("\n🔍 Checking for completed-related fields in trade:")
        const tradeRecord = trade as Record<string, unknown>
        
        const completedFields = [
          "completed",
          "complete",
          "isCompleted",
          "is_completed",
          "isBondingCurve",
          "is_bonding_curve",
          "graduated",
          "isGraduated",
        ]

        for (const field of completedFields) {
          if (field in tradeRecord) {
            console.log(`  ✓ Found: ${field} = ${JSON.stringify(tradeRecord[field])} (type: ${typeof tradeRecord[field]})`)
          }
        }

        console.log("\n🔍 Checking coinMeta object (if present):")
        if (tradeRecord.coinMeta && typeof tradeRecord.coinMeta === "object") {
          const coinMeta = tradeRecord.coinMeta as Record<string, unknown>
          console.log("  coinMeta keys:", Object.keys(coinMeta))
          
          for (const field of completedFields) {
            if (field in coinMeta) {
              console.log(`  ✓ Found in coinMeta: ${field} = ${JSON.stringify(coinMeta[field])} (type: ${typeof coinMeta[field]})`)
            }
          }

          // Check bonding curve fields
          if ("bondingCurve" in coinMeta || "bonding_curve" in coinMeta) {
            const bc = coinMeta.bondingCurve ?? coinMeta.bonding_curve
            console.log(`  ✓ Bonding curve address: ${bc ? `${String(bc).slice(0, 20)}...` : "null/empty"}`)
          }
        }

        if (messageCount >= maxMessages) {
          ws.close()
          resolve()
        }
      } catch (error) {
        console.error("❌ Error parsing message:", (error as Error).message)
        console.log("Raw message:", data.toString().slice(0, 200))
      }
    })

    ws.on("error", (error: Error) => {
      console.error("❌ WebSocket error:", error.message)
      resolve()
    })

    // Timeout after 30 seconds
    setTimeout(() => {
      console.log("\n⏱️ Timeout reached")
      ws.close()
      resolve()
    }, 30000)
  })
}

async function getTokensFromDatabase() {
  try {
    const { PrismaClient } = require("@prisma/client")
    const prisma = new PrismaClient()

    // Get a mix of completed and non-completed tokens
    const completed = await prisma.token.findFirst({
      where: { completed: true },
      select: { mintAddress: true },
    })

    const notCompleted = await prisma.token.findFirst({
      where: { completed: false },
      select: { mintAddress: true },
    })

    await prisma.$disconnect()

    const mints: string[] = []
    if (completed) mints.push(completed.mintAddress)
    if (notCompleted) mints.push(notCompleted.mintAddress)

    return mints
  } catch (error) {
    console.error("❌ Error querying database:", (error as Error).message)
    return []
  }
}

async function main() {
  console.log("🔍 Diagnostic Script: Checking Completed Status Sources")
  console.log("=".repeat(80))

  // Get some test tokens from database
  console.log("\n📊 Fetching test tokens from database...")
  const testMints = await getTokensFromDatabase()

  if (testMints.length === 0) {
    console.log("⚠️ No tokens found in database. Add some mint addresses manually.")
    console.log("You can also just run the websocket check to see live data.")
  } else {
    console.log(`✓ Found ${testMints.length} test tokens:`, testMints)
    
    // Check API structure for each token
    for (const mint of testMints) {
      await checkApiStructure(mint)
      // Small delay between requests
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  // Check websocket structure
  await checkWebsocketStructure()

  console.log(`\n${"=".repeat(80)}`)
  console.log("✅ Diagnostic complete!")
  console.log(`${"=".repeat(80)}`)
}

main().catch(console.error)

