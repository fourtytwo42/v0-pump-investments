import { prisma } from "@/lib/prisma"
import { getTokenDataRevision } from "@/lib/token-query"

export interface AlertRecord {
  mint: string
  name: string
  symbol: string
  market_cap: number
  last_trade_timestamp: number
  revision: string
}

export type AlertStreamEvent =
  | { event: "snapshot"; data: { records: AlertRecord[]; revision: string } }
  | { event: "patch"; data: { records: AlertRecord[]; revision: string } }

type Listener = (event: AlertStreamEvent) => void
interface AlertGroup {
  mints: string[]
  listeners: Set<Listener>
  lastRevision: bigint
  records: Map<string, AlertRecord>
}

const groups = new Map<string, AlertGroup>()
const metrics = { polls: 0, reads: 0, patches: 0 }
let timer: ReturnType<typeof setInterval> | null = null
let polling = false

function groupKey(mints: string[]): string {
  return [...new Set(mints)].sort().join(",")
}

async function readRecords(mints: string[], revision: bigint): Promise<AlertRecord[]> {
  metrics.reads += 1
  const rows = await prisma.token.findMany({
    where: { mintAddress: { in: mints } },
    select: {
      mintAddress: true,
      name: true,
      symbol: true,
      price: { select: { marketCapUsd: true, lastTradeTimestamp: true } },
    },
  })
  return rows.map((row) => ({
    mint: row.mintAddress,
    name: row.name,
    symbol: row.symbol,
    market_cap: Number(row.price?.marketCapUsd ?? 0),
    last_trade_timestamp: Number(row.price?.lastTradeTimestamp ?? 0),
    revision: revision.toString(),
  }))
}

function changed(previous: AlertRecord | undefined, next: AlertRecord): boolean {
  return !previous ||
    previous.market_cap !== next.market_cap ||
    previous.last_trade_timestamp !== next.last_trade_timestamp
}

async function refreshGroup(group: AlertGroup, revision: bigint): Promise<void> {
  if (revision === group.lastRevision) return
  const records = await readRecords(group.mints, revision)
  const updates = records.filter((record) => changed(group.records.get(record.mint), record))
  group.records = new Map(records.map((record) => [record.mint, record]))
  group.lastRevision = revision
  if (updates.length === 0) return
  metrics.patches += 1
  const event: AlertStreamEvent = {
    event: "patch",
    data: { records: updates, revision: revision.toString() },
  }
  group.listeners.forEach((listener) => listener(event))
}

async function poll(): Promise<void> {
  if (polling || groups.size === 0) return
  polling = true
  metrics.polls += 1
  try {
    const revision = await getTokenDataRevision()
    await Promise.all(Array.from(groups.values()).map((group) =>
      refreshGroup(group, revision).catch((error) =>
        console.error("[alert-stream] group refresh failed", error),
      ),
    ))
  } finally {
    polling = false
  }
}

function ensureTimer(): void {
  if (!timer) timer = setInterval(() => void poll(), 1_000)
}

function stopTimerIfIdle(): void {
  if (groups.size > 0 || !timer) return
  clearInterval(timer)
  timer = null
}

export async function subscribeAlertStream(mints: string[], listener: Listener): Promise<() => void> {
  const key = groupKey(mints)
  let group = groups.get(key)
  if (!group) {
    const revision = await getTokenDataRevision()
    const records = await readRecords([...new Set(mints)].sort(), revision)
    group = {
      mints: [...new Set(mints)].sort(),
      listeners: new Set(),
      lastRevision: revision,
      records: new Map(records.map((record) => [record.mint, record])),
    }
    groups.set(key, group)
  }
  group.listeners.add(listener)
  listener({
    event: "snapshot",
    data: { records: [...group.records.values()], revision: group.lastRevision.toString() },
  })
  ensureTimer()
  return () => {
    const active = groups.get(key)
    active?.listeners.delete(listener)
    if (active?.listeners.size === 0) groups.delete(key)
    stopTimerIfIdle()
  }
}

export function getAlertStreamMetrics() {
  return {
    groups: groups.size,
    listeners: Array.from(groups.values()).reduce((sum, group) => sum + group.listeners.size, 0),
    ...metrics,
  }
}
