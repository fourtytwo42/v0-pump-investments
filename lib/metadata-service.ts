import { prisma } from "@/lib/prisma"
import { getTokenDetails } from "@/lib/pump-api"

export async function resolveTokenMetadata(mintAddress: string) {
  const stored = await prisma.token.findUnique({
    where: { mintAddress },
    select: {
      name: true,
      symbol: true,
      imageUri: true,
      metadataUri: true,
      twitter: true,
      telegram: true,
      website: true,
      description: true,
    },
  })
  if (stored?.imageUri && stored?.name && stored?.symbol) return stored
  const upstream = await getTokenDetails(mintAddress)
  if (!upstream) return stored
  return {
    name: upstream.name ?? stored?.name ?? null,
    symbol: upstream.symbol ?? stored?.symbol ?? null,
    imageUri: upstream.imageUri ?? stored?.imageUri ?? null,
    metadataUri: stored?.metadataUri ?? null,
    twitter: upstream.twitter ?? stored?.twitter ?? null,
    telegram: upstream.telegram ?? stored?.telegram ?? null,
    website: upstream.website ?? stored?.website ?? null,
    description: stored?.description ?? null,
  }
}
