#!/usr/bin/env tsx
/**
 * Script to remove invalid tokens from the database
 * Invalid tokens are those with mint addresses that don't pass Solana address validation
 */

import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

function isValidSolanaAddress(address: string): boolean {
  // Solana addresses are base58 encoded and typically 32-44 characters
  // Filter out obvious fake addresses (ending in "pump", too short, etc.)
  if (!address || address.length < 32 || address.length > 44) return false
  if (address.toLowerCase().endsWith("pump")) return false
  // Base58 characters: 1-9, A-H, J-N, P-Z, a-k, m-z (no 0, O, I, l)
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/
  return base58Regex.test(address)
}

async function removeInvalidTokens() {
  console.log("🔍 Finding invalid tokens in database...")

  try {
    // Get all tokens
    const allTokens = await prisma.token.findMany({
      select: {
        id: true,
        mintAddress: true,
        name: true,
        symbol: true,
      },
    })

    console.log(`📊 Total tokens in database: ${allTokens.length}`)

    // Filter invalid tokens
    const invalidTokens = allTokens.filter((token) => !isValidSolanaAddress(token.mintAddress))

    console.log(`❌ Found ${invalidTokens.length} invalid tokens`)

    if (invalidTokens.length === 0) {
      console.log("✅ No invalid tokens to remove")
      return
    }

    // Show some examples
    console.log("\n📋 Sample invalid tokens:")
    invalidTokens.slice(0, 10).forEach((token) => {
      console.log(`  - ${token.mintAddress} (${token.name || "N/A"})`)
    })
    if (invalidTokens.length > 10) {
      console.log(`  ... and ${invalidTokens.length - 10} more`)
    }

    // Get confirmation
    console.log(`\n⚠️  About to delete ${invalidTokens.length} invalid tokens`)
    console.log("This will also delete associated trades and prices (cascade delete)")

    // Delete in batches to avoid overwhelming the database
    const batchSize = 100
    let deleted = 0

    for (let i = 0; i < invalidTokens.length; i += batchSize) {
      const batch = invalidTokens.slice(i, i + batchSize)
      const mintAddresses = batch.map((t) => t.mintAddress)

      const result = await prisma.token.deleteMany({
        where: {
          mintAddress: {
            in: mintAddresses,
          },
        },
      })

      deleted += result.count
      console.log(`✅ Deleted batch: ${result.count} tokens (${deleted}/${invalidTokens.length} total)`)

      // Small delay between batches
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    console.log(`\n✅ Successfully removed ${deleted} invalid tokens from database`)
  } catch (error) {
    console.error("❌ Error removing invalid tokens:", (error as Error).message)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
removeInvalidTokens()
  .then(() => {
    console.log("\n✅ Script completed successfully")
    process.exit(0)
  })
  .catch((error) => {
    console.error("\n❌ Script failed:", error)
    process.exit(1)
  })

