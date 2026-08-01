import {
  getTokenDataRevision,
  getTokenRevisionChanges,
  getConsistentTokenSnapshot,
  normalizedTokenQueryKey,
  normalizeTokenQuery,
  type TokenSnapshot,
} from "@/lib/token-query"
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
        sol_price_usd: number
        sol_price_updated_at: string | null
      }
    }

type Listener = (event: TokenStreamEvent) => void

interface StreamGroup {
  query: TokenQueryRequest
  listeners: Set<Listener>
  snapshot: TokenSnapshot
  lastRunAt: number
  appliedRevision: bigint
}

const groups = new Map<string, StreamGroup>()
const MAX_QUERY_GROUPS = Number.parseInt(process.env.TOKEN_SSE_MAX_QUERY_GROUPS ?? "100", 10)
let pollTimer: ReturnType<typeof setInterval> | null = null
let pollInFlight = false
let lastObservedRevision = BigInt(-1)
const streamMetrics = { polls: 0, recomputations: 0, patches: 0 }

function tokenChanged(previous: TokenData | undefined, next: TokenData): boolean {
  return !previous || JSON.stringify(previous) !== JSON.stringify(next)
}

export function canSubscribeTokenStream(rawQuery: Partial<TokenQueryRequest>): boolean {
  const key = normalizedTokenQueryKey(rawQuery)
  return groups.has(key) || groups.size < MAX_QUERY_GROUPS
}

async function refreshGroup(group: StreamGroup, _revision: bigint): Promise<void> {
  streamMetrics.recomputations += 1
  const consistent = await getConsistentTokenSnapshot(group.query)
  const { revision, ...next } = consistent
  const previous = group.snapshot
  const previousByMint = new Map(previous.tokens.map((token) => [token.mint, token]))
  const nextMints = new Set(next.tokens.map((token) => token.mint))
  const upserts = next.tokens.filter((token) => tokenChanged(previousByMint.get(token.mint), token))
  const removedMints = previous.tokens
    .filter((token) => !nextMints.has(token.mint))
    .map((token) => token.mint)

  group.snapshot = next
  group.lastRunAt = Date.now()
  group.appliedRevision = revision
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
      sol_price_usd: next.sol_price_usd,
      sol_price_updated_at: next.sol_price_updated_at,
    },
  }
  streamMetrics.patches += 1
  group.listeners.forEach((listener) => listener(event))
}

async function pollRevision(): Promise<void> {
  if (pollInFlight || groups.size === 0) return
  pollInFlight = true
  try {
    streamMetrics.polls += 1
    const revision = await getTokenDataRevision()
    if (
      revision === lastObservedRevision &&
      Array.from(groups.values()).every((group) => group.appliedRevision === revision)
    ) return
    const minimumAppliedRevision = Array.from(groups.values()).reduce(
      (minimum, group) => group.appliedRevision < minimum ? group.appliedRevision : minimum,
      revision,
    )
    const { changes, hasGap } = await getTokenRevisionChanges(minimumAppliedRevision, revision)
    lastObservedRevision = revision
    const now = Date.now()
    await Promise.all(
      Array.from(groups.values())
        .filter((group) => now - group.lastRunAt >= 1_000)
        .filter((group) => group.appliedRevision !== revision)
        .filter((group) => {
          if (hasGap) return true
          if (changes.length === 0) return true
          if (changes.some((change) => change.changeKind !== "metadata")) return true
          const visible = new Set(group.snapshot.tokens.map((token) => token.mint))
          return changes.some((change) => visible.has(change.mintAddress))
        })
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
  pollTimer = setInterval(() => void pollRevision(), 1_000)
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
  const key = normalizedTokenQueryKey(query)
  if (!groups.has(key) && groups.size >= MAX_QUERY_GROUPS) {
    throw new Error("Token stream query-group capacity reached")
  }
  let group = groups.get(key)

  if (!group) {
    const consistent = await getConsistentTokenSnapshot(query)
    const { revision, ...snapshot } = consistent
    group = {
      query,
      listeners: new Set(),
      snapshot,
      lastRunAt: Date.now(),
      appliedRevision: revision,
    }
    groups.set(key, group)
  }

  group.listeners.add(listener)
  listener({
    event: "snapshot",
    data: { ...group.snapshot, revision: group.appliedRevision.toString() },
  })
  ensurePolling()

  return () => {
    const active = groups.get(key)
    if (!active) return
    active.listeners.delete(listener)
    if (active.listeners.size === 0) groups.delete(key)
    stopPollingIfIdle()
  }
}

export function getTokenStreamMetrics() {
  return {
    groups: groups.size,
    listeners: Array.from(groups.values()).reduce((total, group) => total + group.listeners.size, 0),
    ...streamMetrics,
  }
}
