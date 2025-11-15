const DEXSCREENER_BASE_URL = "https://api.dexscreener.com/latest/dex/tokens"
const DEXSCREENER_HEADERS = {
  accept: "application/json, text/plain, */*",
  "user-agent": "PumpInvestmentsBot/1.0 (+https://pump.investments)",
}

interface DexScreenerPair {
  pairCreatedAt?: number
}

interface DexScreenerResponse {
  pairs?: DexScreenerPair[]
}

const dexCache = new Map<string, { value: number | null; expiresAt: number }>()
const CACHE_TTL_MS = 10 * 60 * 1000

export async function getDexPairCreatedAt(mint: string): Promise<number | null> {
  const now = Date.now()
  const cached = dexCache.get(mint)
  if (cached && cached.expiresAt > now) {
    return cached.value
  }

  const url = `${DEXSCREENER_BASE_URL}/${encodeURIComponent(mint)}`

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: DEXSCREENER_HEADERS,
    })

    if (!response.ok) {
      console.warn(`[dexscreener] Request failed ${response.status} for ${mint}`)
      dexCache.set(mint, { value: null, expiresAt: now + CACHE_TTL_MS })
      return null
    }

    const json = (await response.json()) as DexScreenerResponse
    const timestamps =
      json.pairs
        ?.map((pair) => pair.pairCreatedAt)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value)) ?? []

    const earliest = timestamps.length > 0 ? Math.min(...timestamps) : null
    dexCache.set(mint, { value: earliest, expiresAt: now + CACHE_TTL_MS })
    return earliest
  } catch (error) {
    console.warn(`[dexscreener] Request error for ${mint}:`, (error as Error).message)
    dexCache.set(mint, { value: null, expiresAt: now + CACHE_TTL_MS })
    return null
  }
}

