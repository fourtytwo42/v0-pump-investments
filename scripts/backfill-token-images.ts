import { prisma } from "@/lib/prisma"
import { normalizeTokenMetadata } from "@/lib/token-metadata"
import { normalizeIpfsUri } from "@/lib/pump-trades"

async function fetchMetadata(uri: string): Promise<any | null> {
  try {
    const response = await fetch(uri, { headers: { accept: "application/json" } })
    if (!response.ok) {
      console.warn(`[backfill] metadata fetch failed ${uri} -> ${response.status}`)
      return null
    }
    return response.json()
  } catch (error) {
    console.warn(`[backfill] metadata fetch error ${uri}:`, (error as Error).message)
    return null
  }
}

async function run() {
  const candidates = await prisma.token.findMany({
    where: {
      metadataUri: {
        not: null,
      },
    },
    select: {
      id: true,
      mintAddress: true,
      metadataUri: true,
      imageUri: true,
    },
  })

  const filtered = candidates.filter((token) => !token.imageUri || token.imageUri === token.metadataUri)

  console.log(`[backfill] Found ${filtered.length} tokens to update`)

  for (const token of filtered) {
    if (!token.metadataUri) continue

    const metadataJson = await fetchMetadata(token.metadataUri)
    if (!metadataJson) continue

    const normalized = normalizeTokenMetadata(metadataJson)
    const imageUri = normalized.image ? normalizeIpfsUri(normalized.image) : null

    if (!imageUri) {
      continue
    }

    console.log(`[backfill] ${token.mintAddress} -> ${imageUri}`)

    await prisma.token.update({
      where: { id: token.id },
      data: {
        imageUri,
        description: normalized.description ?? undefined,
        twitter: normalized.twitter ?? undefined,
        telegram: normalized.telegram ?? undefined,
        website: normalized.website ?? undefined,
      },
    })

    console.log(`[backfill] Updated ${token.mintAddress}`)
  }
}

run()
  .catch((error) => {
    console.error("[backfill] Failed:", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
