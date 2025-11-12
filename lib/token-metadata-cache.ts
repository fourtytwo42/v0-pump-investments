import { isMetadataEmpty, normalizeTokenMetadata, type TokenMetadata } from "./token-metadata"

const metadataCache = new Map<string, TokenMetadata | null>()
const inflightRequests = new Map<string, Promise<TokenMetadata | null>>()
const lastPumpAttemptTimestamps = new Map<string, number>()
const lastUriAttemptTimestamps = new Map<string, number>()

const METADATA_ENDPOINT = (mint: string) => `https://frontend-api.pump.fun/coins/${mint}`
const REQUEST_TIMEOUT_MS = 12_000
const PUMP_RETRY_COOLDOWN_MS = 60_000
const URI_RETRY_COOLDOWN_MS = 5 * 60 * 1000

function logDebug(message: string, ...args: unknown[]) {
  if (process.env.NEXT_PUBLIC_LOG_METADATA !== "true") {
    return
  }
  console.log(message, ...args)
}

function normalizeMetadataUriForFetch(uri: string | null | undefined): string | null {
  if (!uri) return null
  const trimmed = uri.trim()
  if (trimmed.length === 0) return null
  if (trimmed.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${trimmed.slice("ipfs://".length)}`
  }
  return trimmed
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

async function fetchFromMetadataUri(mint: string, metadataUri: string | null): Promise<TokenMetadata | null | undefined> {
  const normalized = normalizeMetadataUriForFetch(metadataUri)
  if (!normalized) {
    return undefined
  }

  const lastAttempt = lastUriAttemptTimestamps.get(mint) ?? 0
  if (Date.now() - lastAttempt < URI_RETRY_COOLDOWN_MS) {
    logDebug("[metadata] URI cooldown active", mint)
    return undefined
  }

  logDebug("[metadata] fetching metadata URI", mint, normalized)
  lastUriAttemptTimestamps.set(mint, Date.now())

  try {
    const response = await fetch(normalized, {
      cache: "force-cache",
      headers: { Accept: "application/json" },
    })

    if (!response.ok) {
      logDebug("[metadata] metadata URI error", mint, response.status)
      metadataCache.set(mint, null)
      return null
    }

    const raw = await response.json().catch((error) => {
      logDebug("[metadata] metadata URI parse failed", mint, error)
      return null
    })

    const normalizedMetadata = normalizeAndCache(mint, raw)
    logDebug("[metadata] metadata URI normalized", mint, normalizedMetadata ? "value" : "null")
    return normalizedMetadata
  } catch (error) {
    console.debug(`[metadata] Metadata URI fetch failed for ${mint}:`, error)
    metadataCache.set(mint, null)
    return null
  }
}

async function fetchFromPumpEndpoint(mint: string): Promise<TokenMetadata | null> {
  const lastAttempt = lastPumpAttemptTimestamps.get(mint) ?? 0
  if (Date.now() - lastAttempt < PUMP_RETRY_COOLDOWN_MS) {
    logDebug("[metadata] Pump.fun cooldown active", mint)
    return metadataCache.get(mint) ?? null
  }

  lastPumpAttemptTimestamps.set(mint, Date.now())
  logDebug("[metadata] fetching Pump.fun endpoint", mint)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

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
      logDebug("[metadata] Pump.fun parse failed", mint, error)
      return null
    })

    const normalizedMetadata = normalizeAndCache(mint, raw)
    logDebug("[metadata] Pump.fun normalized", mint, normalizedMetadata ? "value" : "null")
    return normalizedMetadata
  } catch (error) {
    if ((error as Error).name !== "AbortError") {
      console.debug(`[metadata] Pump.fun fetch failed for ${mint}:`, error)
    }
    metadataCache.set(mint, null)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

export async function fetchTokenMetadataWithCache(mint: string, metadataUri?: string | null): Promise<TokenMetadata | null> {
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

  const request = (async () => {
    const uriResult = await fetchFromMetadataUri(mint, metadataUri ?? null)
    if (uriResult !== undefined) {
      return uriResult
    }

    return await fetchFromPumpEndpoint(mint)
  })()

  inflightRequests.set(mint, request)
  const result = await request
  inflightRequests.delete(mint)
  return result
}

export function clearTokenMetadataCache(): void {
  metadataCache.clear()
  inflightRequests.clear()
  lastPumpAttemptTimestamps.clear()
  lastUriAttemptTimestamps.clear()
}
