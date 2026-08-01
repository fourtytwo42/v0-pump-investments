import { readdir, rm, stat } from "node:fs/promises"
import path from "node:path"

const EVICT_AT_BYTES = 480 * 1024 * 1024
const EVICT_TO_BYTES = 450 * 1024 * 1024
const VERIFY_INTERVAL_MS = 10 * 60_000
const NEGATIVE_MAX_AGE_MS = 24 * 60 * 60_000
const TEMP_MAX_AGE_MS = 60 * 60_000

interface CacheEntry { size: number; lastAccess: number }
const index = new Map<string, CacheEntry>()
let indexedRoot: string | null = null
let totalBytes = 0
let lastVerifiedAt = 0
let work: Promise<void> | null = null
let evictions = 0

async function verify(root: string): Promise<void> {
  const now = Date.now()
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const names = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name))
  const next = new Map<string, CacheEntry>()
  let nextTotal = 0
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const fullPath = path.join(root, entry.name)
    const info = await stat(fullPath).catch(() => null)
    if (!info) continue
    if (entry.name.endsWith(".tmp") && now - info.mtimeMs > TEMP_MAX_AGE_MS) {
      await rm(fullPath, { force: true })
      continue
    }
    if (entry.name.endsWith(".negative") && now - info.mtimeMs > NEGATIVE_MAX_AGE_MS) {
      await rm(fullPath, { force: true })
      continue
    }
    if (entry.name.endsWith(".json") && !names.has(entry.name.replace(/\.json$/, ".bin"))) {
      await rm(fullPath, { force: true })
      continue
    }
    if (!entry.name.endsWith(".bin")) continue
    if (!names.has(entry.name.replace(/\.bin$/, ".json"))) {
      await rm(fullPath, { force: true })
      continue
    }
    const cached = index.get(fullPath)
    const item = { size: info.size, lastAccess: cached?.lastAccess ?? info.mtimeMs }
    next.set(fullPath, item)
    nextTotal += item.size
  }
  index.clear()
  next.forEach((value, key) => index.set(key, value))
  totalBytes = nextTotal
  indexedRoot = root
  lastVerifiedAt = now

  if (totalBytes <= EVICT_AT_BYTES) return
  for (const [body, entry] of [...index.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess)) {
    if (totalBytes <= EVICT_TO_BYTES) break
    await Promise.all([
      rm(body, { force: true }),
      rm(body.replace(/\.bin$/, ".json"), { force: true }),
    ])
    index.delete(body)
    totalBytes -= entry.size
    evictions += 1
  }
}

export function noteImageCacheHit(bodyPath: string): void {
  const entry = index.get(bodyPath)
  if (entry) entry.lastAccess = Date.now()
}

export function registerImageCacheWrite(bodyPath: string, size: number): void {
  const previous = index.get(bodyPath)
  totalBytes += size - (previous?.size ?? 0)
  index.set(bodyPath, { size, lastAccess: Date.now() })
}

export function scheduleImageCacheMaintenance(root: string): void {
  const due = indexedRoot !== root || Date.now() - lastVerifiedAt >= VERIFY_INTERVAL_MS || totalBytes > EVICT_AT_BYTES
  if (!due || work) return
  work = verify(root)
    .catch((error) => console.warn("[token-image] cache maintenance failed", error))
    .finally(() => { work = null })
}

export async function maintainImageCacheNow(root: string): Promise<void> {
  if (!work) {
    work = verify(root).finally(() => { work = null })
  }
  await work
}

export function getImageCacheProcessMetrics() {
  return {
    indexed_files: index.size,
    indexed_bytes: totalBytes,
    last_verified_at: lastVerifiedAt ? new Date(lastVerifiedAt).toISOString() : null,
    maintenance_running: work !== null,
    evictions,
    evict_at_bytes: EVICT_AT_BYTES,
    evict_to_bytes: EVICT_TO_BYTES,
  }
}
