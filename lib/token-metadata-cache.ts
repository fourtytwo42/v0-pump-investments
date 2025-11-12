import { isMetadataEmpty, normalizeTokenMetadata, type TokenMetadata } from "./token-metadata"

const metadataCache = new Map<string, TokenMetadata | null>()
const inflightRequests = new Map<string, Promise<TokenMetadata | null>>()
const lastAttemptTimestamps = new Map<string, number>()

const METADATA_ENDPOINT = (mint: string) => `https://frontend-api.pump.fun/coins/${mint}`
const REQUEST_TIMEOUT_MS = 12_000
const RETRY_COOLDOWN_MS = 60_000

function logDebug(message: string, ...args: unknown[]) {
  if (process.env.NEXT_PUBLIC_LOG_METADATA !== "true") {
    return
  }
  console.log(message, ...args)
}

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
  logDebug("[metadata] cacheTokenMetadata", mint, metadata ? "value" : "null")

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

  logDebug("[metadata] prime cache for", mint)
  metadataCache.set(mint, metadata)
}

export async function fetchTokenMetadataWithCache(mint: string): Promise<TokenMetadata | null> {
  if (!mint) {
    logDebug("[metadata] skip fetch (empty mint)")
    return null
  }

  if (metadataCache.has(mint)) {
    logDebug("[metadata] cache hit", mint)
    return metadataCache.get(mint) ?? null
  }

  if (inflightRequests.has(mint)) {
    logDebug("[metadata] join inflight request", mint)
    return inflightRequests.get(mint) ?? null
  }

  const lastAttempt = lastAttemptTimestamps.get(mint) ?? 0
  if (Date.now() - lastAttempt < RETRY_COOLDOWN_MS) {
    logDebug("[metadata] cooldown active, skipping fetch", mint)
    return null
  }

  const request = (async () => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    logDebug("[metadata] fetching from Pump.fun", mint)

    try {
      const response = await fetch(METADATA_ENDPOINT(mint), {
        cache: "no-store",
        signal: controller.signal,
      })

      if (!response.ok) {
        logDebug("[metadata] Pump.fun response not ok", mint, response.status)
        metadataCache.set(mint, null)
        return null
      }

      const raw = await response.json().catch((error) => {
        logDebug("[metadata] Pump.fun JSON parse failed", mint, error)
        return null
      })

      const normalized = normalizeAndCache(mint, raw)
      logDebug("[metadata] Pump.fun normalized", mint, normalized ? "value" : "null")
      return normalized
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        console.debug(`[metadata] Fetch failed for ${mint}:`, error)
      }
      metadataCache.set(mint, null)
      return null
    } finally {
      clearTimeout(timeout)
      lastAttemptTimestamps.set(mint, Date.now())
      inflightRequests.delete(mint)
    }
  })()

  inflightRequests.set(mint, request)
  return request
}

export function clearTokenMetadataCache(): void {
  metadataCache.clear()
  inflightRequests.clear()
  lastAttemptTimestamps.clear()
}
