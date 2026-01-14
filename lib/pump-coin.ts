export const PUMP_HEADERS = {
  accept: "application/json, text/plain, */*",
  origin: "https://pump.fun",
  referer: "https://pump.fun",
  "user-agent": "PumpFunMockTrader/1.0 (+https://pump.fun)",
}

const FRONTEND_ENDPOINTS = [
  "https://frontend-api-v3.pump.fun",
  "https://frontend-api.pump.fun",
]

const COIN_CACHE = new Map<string, any | null>()
const COIN_FETCH_PROMISES = new Map<string, Promise<any | null>>()
// Cache failed requests (404, 530) to avoid retrying
const FAILED_CACHE = new Set<string>()

async function requestPumpCoin(mint: string): Promise<any | null> {
  // Check if we've already failed for this mint
  if (FAILED_CACHE.has(mint)) {
    return null
  }

  let lastError: Error | null = null

  for (const baseUrl of FRONTEND_ENDPOINTS) {
    const url = `${baseUrl}/coins/${mint}`

    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: PUMP_HEADERS,
      })

      if (!response.ok) {
        // Treat 404 and 530 as "token not found" - cache to avoid retrying
        if (response.status === 404 || response.status === 530) {
          FAILED_CACHE.add(mint)
          return null
        }
        // For other errors, log but don't cache (might be temporary)
        lastError = new Error(`pump.fun coin request failed with status ${response.status}`)
        // Only log non-530 errors to reduce noise
        if (response.status !== 530) {
          console.warn(`[pump-coin] ${url} responded with ${response.status}`)
        }
        continue
      }

      // Check if response has content before trying to parse JSON
      const contentType = response.headers.get("content-type") || ""
      const contentLength = response.headers.get("content-length")
      
      // If content-length is 0 or content-type doesn't indicate JSON, skip parsing
      if (contentLength === "0" || (!contentType.includes("json") && !contentType.includes("text"))) {
        continue
      }

      try {
        const text = await response.text()
        // If response is empty, treat as not found
        if (!text || text.trim().length === 0) {
          FAILED_CACHE.add(mint)
          return null
        }
        
        const json = JSON.parse(text)
        COIN_CACHE.set(mint, json)
        return json
      } catch (parseError) {
        // If response is not valid JSON (e.g., empty response from 530), treat as not found
        FAILED_CACHE.add(mint)
        return null
      }
    } catch (error) {
      lastError = error as Error
      // Don't log errors - they're usually network issues or tokens not on pump.fun
      // Silently continue to next endpoint
    }
  }

  // Cache failures silently - don't retry tokens that don't exist on pump.fun
  if (lastError) {
    FAILED_CACHE.add(mint)
  }

  return null
}

export async function fetchPumpCoin(mint: string | null | undefined): Promise<any | null> {
  if (!mint) {
    return null
  }

  if (COIN_CACHE.has(mint)) {
    const cached = COIN_CACHE.get(mint)
    if (cached != null) {
      return cached
    }
    COIN_CACHE.delete(mint)
  }

  if (COIN_FETCH_PROMISES.has(mint)) {
    return COIN_FETCH_PROMISES.get(mint)!
  }

  const promise = requestPumpCoin(mint)
  COIN_FETCH_PROMISES.set(mint, promise)
  return promise
}

