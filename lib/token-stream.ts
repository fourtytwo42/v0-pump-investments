import { getTokenDataRevision, normalizeTokenQuery, queryTokenSnapshot, type TokenSnapshot } from "@/lib/token-query"
import type { TokenData, TokenQueryRequest } from "@/types/token-data"

export type TokenStreamEvent =
  | { event: "snapshot"; data: TokenSnapshot & { revision: string } }
  | {
      event: "patch"
      data: {
        revision: string
        upserts: TokenData[]
        removedMints: string[]
        order: string[]
        total: number
        totalPages: number
        effectiveTimeRangeMinutes: number
      }
    }

type Listener = (event: TokenStreamEvent) => void

interface StreamGroup {
  query: TokenQueryRequest
  listeners: Set<Listener>
  snapshot: TokenSnapshot
  lastRunAt: number
}

const groups = new Map<string, StreamGroup>()
let pollTimer: ReturnType<typeof setInterval> | null = null
let pollInFlight = false
let lastObservedRevision = BigInt(-1)

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function tokenChanged(previous: TokenData | undefined, next: TokenData): boolean {
  return !previous || JSON.stringify(previous) !== JSON.stringify(next)
}

async function refreshGroup(group: StreamGroup, revision: bigint): Promise<void> {
  const next = await queryTokenSnapshot(group.query)
  const previous = group.snapshot
  const previousByMint = new Map(previous.tokens.map((token) => [token.mint, token]))
  const nextMints = new Set(next.tokens.map((token) => token.mint))
  const upserts = next.tokens.filter((token) => tokenChanged(previousByMint.get(token.mint), token))
  const removedMints = previous.tokens
    .filter((token) => !nextMints.has(token.mint))
    .map((token) => token.mint)

  group.snapshot = next
  group.lastRunAt = Date.now()
  if (
    upserts.length === 0 &&
    removedMints.length === 0 &&
    next.total === previous.total &&
    next.totalPages === previous.totalPages
  ) {
    return
  }

  const event: TokenStreamEvent = {
    event: "patch",
    data: {
      revision: revision.toString(),
      upserts,
      removedMints,
      order: next.tokens.map((token) => token.mint),
      total: next.total,
      totalPages: next.totalPages,
      effectiveTimeRangeMinutes: next.effectiveTimeRangeMinutes,
    },
  }
  group.listeners.forEach((listener) => listener(event))
}

async function pollRevision(): Promise<void> {
  if (pollInFlight || groups.size === 0) return
  pollInFlight = true
  try {
    const revision = await getTokenDataRevision()
    if (revision === lastObservedRevision) return
    lastObservedRevision = revision
    const now = Date.now()
    await Promise.all(
      Array.from(groups.values())
        .filter((group) => now - group.lastRunAt >= 1_000)
        .map((group) =>
          refreshGroup(group, revision).catch((error) =>
            console.error("[token-stream] Failed to refresh query group:", error),
          ),
        ),
    )
  } catch (error) {
    console.error("[token-stream] Revision poll failed:", error)
  } finally {
    pollInFlight = false
  }
}

function ensurePolling(): void {
  if (pollTimer) return
  pollTimer = setInterval(() => void pollRevision(), 250)
}

function stopPollingIfIdle(): void {
  if (groups.size > 0 || !pollTimer) return
  clearInterval(pollTimer)
  pollTimer = null
  lastObservedRevision = BigInt(-1)
}

export async function subscribeTokenStream(
  rawQuery: Partial<TokenQueryRequest>,
  listener: Listener,
): Promise<() => void> {
  const query = normalizeTokenQuery(rawQuery)
  const key = stableStringify(query)
  let group = groups.get(key)

  if (!group) {
    const [snapshot, revision] = await Promise.all([queryTokenSnapshot(query), getTokenDataRevision()])
    group = { query, listeners: new Set(), snapshot, lastRunAt: Date.now() }
    groups.set(key, group)
    lastObservedRevision = revision
  }

  group.listeners.add(listener)
  const revision = await getTokenDataRevision()
  listener({ event: "snapshot", data: { ...group.snapshot, revision: revision.toString() } })
  ensurePolling()

  return () => {
    const active = groups.get(key)
    if (!active) return
    active.listeners.delete(listener)
    if (active.listeners.size === 0) groups.delete(key)
    stopPollingIfIdle()
  }
}
