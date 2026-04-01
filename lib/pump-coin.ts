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
const FAILURE_COOLDOWNS = new Map<string, { until: number; type: "not_found" | "transient" }>()

const NOT_FOUND_COOLDOWN_MS = parseEnvNumber("INGEST_METADATA_NOT_FOUND_COOLDOWN_MS", 30 * 60 * 1000)
const TRANSIENT_COOLDOWN_MS = parseEnvNumber("INGEST_METADATA_TRANSIENT_COOLDOWN_MS", 2 * 60 * 1000)

function parseEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function getActiveCooldown(mint: string): { until: number; type: "not_found" | "transient" } | null {
  const cooldown = FAILURE_COOLDOWNS.get(mint)
  if (!cooldown) return null
  if (cooldown.until <= Date.now()) {
    FAILURE_COOLDOWNS.delete(mint)
    return null
  }
  return cooldown
}

function setCooldown(mint: string, type: "not_found" | "transient"): void {
  const duration = type === "not_found" ? NOT_FOUND_COOLDOWN_MS : TRANSIENT_COOLDOWN_MS
  FAILURE_COOLDOWNS.set(mint, { until: Date.now() + duration, type })
}

function clearCooldown(mint: string): void {
  FAILURE_COOLDOWNS.delete(mint)
}

export function shouldSkipPumpCoinFetch(mint: string): boolean {
  return getActiveCooldown(mint) !== null
}

async function requestPumpCoin(mint: string): Promise<any | null> {
  if (getActiveCooldown(mint)) {
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
        if (response.status === 404) {
          setCooldown(mint, "not_found")
          return null
        }
        if (response.status === 530 || response.status >= 500 || response.status === 429) {
          setCooldown(mint, "transient")
          lastError = new Error(`pump.fun coin request failed with status ${response.status}`)
          continue
        }
        lastError = new Error(`pump.fun coin request failed with status ${response.status}`)
        console.warn(`[pump-coin] ${url} responded with ${response.status}`)
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
        if (!text || text.trim().length === 0) {
          setCooldown(mint, "transient")
          return null
        }
        
        const json = JSON.parse(text)
        COIN_CACHE.set(mint, json)
        clearCooldown(mint)
        return json
      } catch (parseError) {
        lastError = parseError as Error
        setCooldown(mint, "transient")
        continue
      }
    } catch (error) {
      lastError = error as Error
      setCooldown(mint, "transient")
    }
  }

  if (lastError) {
    setCooldown(mint, "transient")
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

  const promise = requestPumpCoin(mint).finally(() => {
    COIN_FETCH_PROMISES.delete(mint)
  })
  COIN_FETCH_PROMISES.set(mint, promise)
  return promise
}
