import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function estimateGrowth() {
  try {
    // Get actual table sizes from PostgreSQL
    const tableSizes = (await prisma.$queryRaw`
      SELECT 
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
        pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('tokens', 'trades', 'token_prices', 'pump_candles_1m', 'pump_features_1m', 'pump_sol_prices')
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
    `) as Array<{ tablename: string; size: string; size_bytes: bigint }>

    let totalBytes = BigInt(0)
    console.log("📊 Actual Table Sizes:")
    tableSizes.forEach((row) => {
      const bytes = Number(row.size_bytes)
      totalBytes += row.size_bytes
      const gb = bytes / (1024 * 1024 * 1024)
      console.log(`  ${row.tablename.padEnd(20)}: ${row.size.padEnd(10)} (${gb.toFixed(4)} GB)`)
    })

    const totalGB = Number(totalBytes) / (1024 * 1024 * 1024)
    console.log(`\nTotal Database Size: ${totalGB.toFixed(4)} GB`)

    // Get counts and growth rates
    const [candleCount, featureCount] = await Promise.all([
      prisma
        .$queryRaw`SELECT COUNT(*)::bigint as count FROM pump_candles_1m`
        .then((r) => Number((r as any)[0].count)),
      prisma
        .$queryRaw`SELECT COUNT(*)::bigint as count FROM pump_features_1m`
        .then((r) => Number((r as any)[0].count)),
    ])

    const timeRangeResult = (await prisma.$queryRaw`
      SELECT 
        MIN(timestamp) as min_ts,
        MAX(timestamp) as max_ts
      FROM pump_candles_1m
    `) as Array<{ min_ts: Date | null; max_ts: Date | null }>

    const timeRangeMinutes = (() => {
      const row = timeRangeResult[0]
      if (!row?.min_ts || !row?.max_ts) return null
      const min = new Date(row.min_ts).getTime()
      const max = new Date(row.max_ts).getTime()
      return (max - min) / 1000 / 60 // minutes
    })()
    const candlesPerMinute = timeRangeMinutes && timeRangeMinutes > 0 ? candleCount / timeRangeMinutes : 486
    const featuresPerMinute = timeRangeMinutes && timeRangeMinutes > 0 ? featureCount / timeRangeMinutes : 488

    // Calculate actual bytes per record (including indexes)
    const candlesSizeRow = tableSizes.find((t) => t.tablename === "pump_candles_1m")
    const featuresSizeRow = tableSizes.find((t) => t.tablename === "pump_features_1m")
    const candlesSizeBytes = candlesSizeRow ? Number(candlesSizeRow.size_bytes) : 0
    const featuresSizeBytes = featuresSizeRow ? Number(featuresSizeRow.size_bytes) : 0

    const bytesPerCandle = candleCount > 0 ? candlesSizeBytes / candleCount : 200
    const bytesPerFeature = featureCount > 0 ? featuresSizeBytes / featureCount : 200

    // Calculate growth per day (bytes)
    const candlesPerDay = candlesPerMinute * 60 * 24
    const featuresPerDay = featuresPerMinute * 60 * 24
    const growthPerDayBytes = candlesPerDay * bytesPerCandle + featuresPerDay * bytesPerFeature
    const growthPerDayGB = growthPerDayBytes / (1024 * 1024 * 1024)

    console.log(`\n📈 Growth Rates:`)
    console.log(`Candles: ${candlesPerMinute.toFixed(1)} per minute`)
    console.log(`Features: ${featuresPerMinute.toFixed(1)} per minute`)
    console.log(`Growth per day: ${growthPerDayGB.toFixed(3)} GB`)
    console.log(`Growth per month (30 days): ${(growthPerDayGB * 30).toFixed(2)} GB`)

    // Project when we hit different sizes
    const targets = [20, 40, 60, 80, 100]
    console.log(`\n🎯 Projected Growth Timeline (from current ${totalGB.toFixed(2)} GB):`)
    console.log(`Size | Days to reach | Months to reach`)
    console.log(`-----|---------------|----------------`)

    targets.forEach((targetGB) => {
      const sizeIncreaseGB = targetGB - totalGB
      if (sizeIncreaseGB <= 0) {
        console.log(`${targetGB}GB | Already exceeded | -`)
      } else {
        const daysNeeded = sizeIncreaseGB / growthPerDayGB
        const monthsNeeded = daysNeeded / 30
        console.log(`${targetGB}GB | ${daysNeeded.toFixed(0)} days | ${monthsNeeded.toFixed(1)} months`)
      }
    })
  } catch (error) {
    console.error("Error:", (error as Error).message)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

estimateGrowth()
  .then(() => {
    process.exit(0)
  })
  .catch((error) => {
    console.error("Failed:", error)
    process.exit(1)
  })

