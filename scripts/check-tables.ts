import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function checkTables() {
  console.log("📊 Checking all tables...\n")

  try {
    // Check tokens table
    const tokenCount = await prisma.token.count()
    console.log(`✅ Tokens: ${tokenCount} records`)

    if (tokenCount > 0) {
      const sampleToken = await prisma.token.findFirst({
        select: {
          id: true,
          mintAddress: true,
          symbol: true,
          name: true,
          metadataUri: true,
          imageUri: true,
        },
      })
      console.log(`   Sample: ${sampleToken?.symbol} (${sampleToken?.mintAddress?.slice(0, 8)}...)`)
      console.log(`   Has metadata: ${sampleToken?.metadataUri ? "✅" : "❌"}, Has image: ${sampleToken?.imageUri ? "✅" : "❌"}`)
    }

    // Check trades table
    const tradeCount = await prisma.trade.count()
    console.log(`\n✅ Trades: ${tradeCount} records`)

    if (tradeCount > 0) {
      const oldestTrade = await prisma.trade.findFirst({
        orderBy: { timestamp: "asc" },
        select: { timestamp: true, createdAt: true },
      })
      const newestTrade = await prisma.trade.findFirst({
        orderBy: { timestamp: "desc" },
        select: { timestamp: true, createdAt: true },
      })

      if (oldestTrade && newestTrade) {
        const oldestAge = Math.floor((Date.now() - Number(oldestTrade.timestamp)) / 1000 / 60)
        const newestAge = Math.floor((Date.now() - Number(newestTrade.timestamp)) / 1000 / 60)
        console.log(`   Oldest trade: ${oldestAge} minutes ago`)
        console.log(`   Newest trade: ${newestAge} minutes ago`)
      }
    }

    // Check token_prices table
    const priceCount = await prisma.tokenPrice.count()
    console.log(`\n✅ Token Prices: ${priceCount} records`)

    // Check pump_candles_1m table
    const candleCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count FROM pump_candles_1m
    `
    console.log(`\n✅ Candles (1m): ${candleCount[0]?.count || 0} records`)

    if (Number(candleCount[0]?.count || 0) > 0) {
      const newestCandle = await prisma.$queryRaw<Array<{ token_id: string; timestamp: Date; trades: number }>>`
        SELECT token_id, timestamp, trades 
        FROM pump_candles_1m 
        ORDER BY timestamp DESC 
        LIMIT 1
      `
      if (newestCandle.length > 0) {
        const candleAge = Math.floor((Date.now() - new Date(newestCandle[0].timestamp).getTime()) / 1000 / 60)
        console.log(`   Newest candle: ${candleAge} minutes ago (${newestCandle[0].trades} trades in that minute)`)
      }

      const candlesByToken = await prisma.$queryRaw<Array<{ token_id: string; count: bigint }>>`
        SELECT token_id, COUNT(*)::bigint as count 
        FROM pump_candles_1m 
        GROUP BY token_id 
        ORDER BY count DESC 
        LIMIT 5
      `
      if (candlesByToken.length > 0) {
        console.log(`   Top tokens by candle count:`)
        for (const row of candlesByToken) {
          console.log(`     - ${row.token_id.slice(0, 8)}...: ${row.count} candles`)
        }
      }
    }

    // Check pump_features_1m table
    const featureCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count FROM pump_features_1m
    `
    console.log(`\n✅ Features (1m): ${featureCount[0]?.count || 0} records`)

    if (Number(featureCount[0]?.count || 0) > 0) {
      const newestFeature = await prisma.$queryRaw<Array<{ token_id: string; timestamp: Date }>>`
        SELECT token_id, timestamp 
        FROM pump_features_1m 
        ORDER BY timestamp DESC 
        LIMIT 1
      `
      if (newestFeature.length > 0) {
        const featureAge = Math.floor((Date.now() - new Date(newestFeature[0].timestamp).getTime()) / 1000 / 60)
        console.log(`   Newest feature: ${featureAge} minutes ago`)
      }
    }

    // Check pump_sol_prices table
    const solPriceCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count FROM pump_sol_prices
    `
    console.log(`\n✅ SOL Prices: ${solPriceCount[0]?.count || 0} records`)

    // Check token_market_caps table
    const marketCapCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count FROM token_market_caps
    `
    console.log(`\n✅ Market Caps: ${marketCapCount[0]?.count || 0} records`)

    if (Number(marketCapCount[0]?.count || 0) > 0) {
      const newestMarketCap = await prisma.$queryRaw<Array<{ token_id: string; timestamp: bigint; market_cap_usd: number }>>`
        SELECT token_id, timestamp, market_cap_usd 
        FROM token_market_caps 
        ORDER BY timestamp DESC 
        LIMIT 1
      `
      if (newestMarketCap.length > 0) {
        const marketCapAge = Math.floor((Date.now() - Number(newestMarketCap[0].timestamp)) / 1000 / 60)
        console.log(`   Newest market cap: ${marketCapAge} minutes ago ($${Number(newestMarketCap[0].market_cap_usd).toLocaleString()})`)
      }
    }

    // Check for any trades that should have been processed but haven't been
    const unprocessedTrades = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count
      FROM trades t
      WHERE t.timestamp < ${BigInt(Date.now() - 60 * 1000)}
        AND NOT EXISTS (
          SELECT 1 FROM pump_candles_1m pc
          WHERE pc.token_id = t.token_id
            AND pc.timestamp = DATE_TRUNC('minute', TO_TIMESTAMP(t.timestamp::bigint / 1000.0))
        )
    `
    console.log(`\n📊 Unprocessed trades (older than 1 min, no candle): ${unprocessedTrades[0]?.count || 0}`)

    // Check if there are trades that should have been deleted
    const processedTradesNotDeleted = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count
      FROM trades t
      WHERE t.timestamp < ${BigInt(Date.now() - 60 * 1000)}
        AND EXISTS (
          SELECT 1 FROM pump_candles_1m pc
          WHERE pc.token_id = t.token_id
            AND pc.timestamp = DATE_TRUNC('minute', TO_TIMESTAMP(t.timestamp::bigint / 1000.0))
        )
    `
    console.log(`\n🗑️  Processed trades not deleted (should be deleted): ${processedTradesNotDeleted[0]?.count || 0}`)

    console.log("\n✅ Check complete!")
  } catch (error) {
    console.error("❌ Error checking tables:", (error as Error).message)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

checkTables()
  .then(() => {
    process.exit(0)
  })
  .catch((error) => {
    console.error("Failed:", error)
    process.exit(1)
  })

