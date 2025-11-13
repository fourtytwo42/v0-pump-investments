const COIN_CACHE = new Map<string, any | null>()
const COIN_FETCH_PROMISES = new Map<string, Promise<any | null>>()

async function requestPumpCoin(mint: string): Promise<any | null> {
  const url = `https://frontend-api.pump.fun/coins/${mint}`

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
      },
    })

    if (!response.ok) {
      if (response.status === 404) {
        COIN_CACHE.set(mint, null)
        return null
      }
      throw new Error(`pump.fun coin request failed with status ${response.status}`)
    }

    const json = await response.json()
    COIN_CACHE.set(mint, json)
    return json
  } catch (error) {
    console.warn(`[pump-coin] Failed to fetch coin ${mint}:`, (error as Error).message)
    return null
  } finally {
    COIN_FETCH_PROMISES.delete(mint)
  }
}

export async function fetchPumpCoin(mint: string | null | undefined): Promise<any | null> {
  if (!mint) {
    return null
  }

  if (COIN_CACHE.has(mint)) {
    return COIN_CACHE.get(mint) ?? null
  }

  if (COIN_FETCH_PROMISES.has(mint)) {
    return COIN_FETCH_PROMISES.get(mint)!
  }

  const promise = requestPumpCoin(mint)
  COIN_FETCH_PROMISES.set(mint, promise)
  return promise
}

