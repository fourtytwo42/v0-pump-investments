const STORAGE_KEY = "pump-investments-token-image-cache-v1"

let inMemoryCache: Record<string, string> | null = null

function ensureCache(): Record<string, string> | null {
  if (typeof window === "undefined") {
    return null
  }

  if (!inMemoryCache) {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      inMemoryCache = raw ? (JSON.parse(raw) as Record<string, string>) : {}
    } catch (error) {
      console.warn("[token-image-cache] Failed to read cache:", (error as Error).message)
      inMemoryCache = {}
    }
  }

  return inMemoryCache
}

function persistCache(cache: Record<string, string>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch (error) {
    console.warn("[token-image-cache] Failed to persist cache:", (error as Error).message)
  }
}

export function getCachedTokenImage(mint: string): string | null {
  const cache = ensureCache()
  if (!cache) return null
  return cache[mint] ?? null
}

export function setCachedTokenImage(mint: string, imageUrl: string) {
  if (!imageUrl) return

  const cache = ensureCache()
  if (!cache) return

  if (cache[mint] === imageUrl) return

  cache[mint] = imageUrl

  const MAX_ENTRIES = 500
  const keys = Object.keys(cache)
  if (keys.length > MAX_ENTRIES) {
    const pruneCount = keys.length - MAX_ENTRIES
    for (let i = 0; i < pruneCount; i += 1) {
      const key = keys[i]
      delete cache[key]
    }
  }

  persistCache(cache)
}
