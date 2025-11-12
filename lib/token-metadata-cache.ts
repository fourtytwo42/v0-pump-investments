import { isMetadataEmpty, normalizeTokenMetadata, type TokenMetadata } from "./token-metadata"

const metadataCache = new Map<string, TokenMetadata | null>()
const inflightRequests = new Map<string, Promise<TokenMetadata | null>>()

const METADATA_ENDPOINTS: ((mint: string) => string)[] = [
  (mint) => `https://frontend-api.pump.fun/coins/${mint}`,
  (mint) => `https://frontend-api.pump.fun/coins/metadata/${mint}`,
  (mint) => `https://pump.fun/coin-metadata/${mint}`,
]

const REQUEST_TIMEOUT_MS = 12_000

function normalizeAndCache(mint: string, raw: unknown): TokenMetadata | null {
  if (!raw || typeof raw !== "object") {
    metadataCache.set(mint, null)
    return null
  }

  const metadata = normalizeTokenMetadata(raw)
  if (isMetadataEmpty(metadata)) {
    metadataCache.set(mint, null)
    return null
  }

  metadataCache.set(mint, metadata)
  return metadata
}

export function hasCachedTokenMetadata(mint: string): boolean {
  return metadataCache.has(mint)
}

export function getCachedTokenMetadata(mint: string): TokenMetadata | null | undefined {
  return metadataCache.get(mint)
}

export function cacheTokenMetadata(mint: string, metadata: TokenMetadata | null | undefined): void {
  if (metadata == null || isMetadataEmpty(metadata)) {
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
      for (const endpointFactory of METADATA_ENDPOINTS) {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
        const url = endpointFactory(mint)

        try {
          const response = await fetch(url, {
            cache: "no-store",
            signal: controller.signal,
          })

          if (!response.ok) {
            continue
          }

          const raw = await response.json().catch(() => null)
          const metadata = normalizeAndCache(mint, raw)
          if (metadata) {
            return metadata
          }
        } catch (error) {
          if ((error as Error).name !== "AbortError") {
            console.debug(`[v0] Metadata fetch failed for ${mint} via ${url}:`, error)
          }
        } finally {
          clearTimeout(timeout)
        }
      }

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
