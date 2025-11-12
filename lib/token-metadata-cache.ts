import { isMetadataEmpty, type TokenMetadata } from "./token-metadata"

const metadataCache = new Map<string, TokenMetadata | null>()
const inflightRequests = new Map<string, Promise<TokenMetadata | null>>()

export function hasCachedTokenMetadata(mint: string): boolean {
  return metadataCache.has(mint)
}

export function getCachedTokenMetadata(mint: string): TokenMetadata | null | undefined {
  return metadataCache.get(mint)
}

export function cacheTokenMetadata(mint: string, metadata: TokenMetadata | null | undefined): void {
  if (metadata == null) {
    metadataCache.set(mint, null)
    return
  }

  if (isMetadataEmpty(metadata)) {
    metadataCache.set(mint, null)
    return
  }

  metadataCache.set(mint, metadata)
}

export function primeTokenMetadataCache(mint: string, metadata: TokenMetadata | null | undefined): void {
  if (metadata == null || metadataCache.has(mint)) {
    return
  }

  if (isMetadataEmpty(metadata)) {
    metadataCache.set(mint, null)
    return
  }

  metadataCache.set(mint, metadata)
}

export async function fetchTokenMetadataWithCache(mint: string): Promise<TokenMetadata | null> {
  if (!mint) {
    return null
  }

  if (metadataCache.has(mint)) {
    return metadataCache.get(mint) ?? null
  }

  if (inflightRequests.has(mint)) {
    return inflightRequests.get(mint) ?? null
  }

  const request = (async () => {
    try {
      const response = await fetch(`/api/token-metadata/${mint}`, {
        cache: "no-store",
      })

      if (!response.ok) {
        throw new Error(`Metadata request failed with status ${response.status}`)
      }

      const payload = (await response.json()) as { metadata?: TokenMetadata | null }
      const metadata = payload.metadata ?? null

      cacheTokenMetadata(mint, metadata)
      return metadataCache.get(mint) ?? null
    } catch (error) {
      console.error(`[v0] Failed to fetch metadata for ${mint}:`, error)
      metadataCache.set(mint, null)
      return null
    } finally {
      inflightRequests.delete(mint)
    }
  })()

  inflightRequests.set(mint, request)
  return request
}

export function clearTokenMetadataCache(): void {
  metadataCache.clear()
  inflightRequests.clear()
}
