import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function wipeDatabase() {
  console.log("🗑️  Starting database wipe...")

  try {
    // Truncate tables in order (respecting foreign key constraints)
    // CASCADE will automatically handle dependent tables
    // Start with child tables, then parent tables
    
    console.log("Truncating trades...")
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE trades RESTART IDENTITY CASCADE`)

    console.log("Truncating token_prices...")
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE token_prices RESTART IDENTITY CASCADE`)

    console.log("Truncating pump_candles_1m...")
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE pump_candles_1m RESTART IDENTITY CASCADE`)

    console.log("Truncating pump_features_1m...")
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE pump_features_1m RESTART IDENTITY CASCADE`)

    console.log("Truncating pump_sol_prices...")
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE pump_sol_prices RESTART IDENTITY CASCADE`)

    console.log("Truncating tokens...")
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE tokens RESTART IDENTITY CASCADE`)

    console.log("✅ Database wiped successfully!")
    console.log("📊 All tables are now empty but structure is preserved")
  } catch (error) {
    console.error("❌ Error wiping database:", (error as Error).message)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

wipeDatabase()
  .then(() => {
    console.log("Done!")
    process.exit(0)
  })
  .catch((error) => {
    console.error("Failed:", error)
    process.exit(1)
  })

