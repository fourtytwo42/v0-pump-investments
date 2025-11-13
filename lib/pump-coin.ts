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

async function requestPumpCoin(mint: string): Promise<any | null> {
  let lastError: Error | null = null

  for (const baseUrl of FRONTEND_ENDPOINTS) {
    const url = `${baseUrl}/coins/${mint}`

    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: PUMP_HEADERS,
      })

        if (!response.ok) {
          if (response.status === 404) {
            return null
          }
        lastError = new Error(`pump.fun coin request failed with status ${response.status}`)
        console.warn(`[pump-coin] ${url} responded with ${response.status}`)
        continue
      }

      const json = await response.json()
      COIN_CACHE.set(mint, json)
      return json
    } catch (error) {
      lastError = error as Error
      console.warn(`[pump-coin] Failed to fetch coin ${mint} from ${baseUrl}:`, (error as Error).message)
    }
  }

  if (lastError) {
    console.warn(`[pump-coin] All endpoints failed for ${mint}:`, lastError.message)
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

