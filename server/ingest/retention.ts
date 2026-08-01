import { normalizeRetentionHours, normalizeRetentionMinutes } from "@/lib/data-retention"
import { prisma } from "@/lib/prisma-ingest"

export const retentionConfig = {
  tradeHours: normalizeRetentionHours(process.env.TRADE_RETENTION_HOURS, 2),
  aggregateHours: normalizeRetentionHours(process.env.AGGREGATE_RETENTION_HOURS, 2),
  revisionMinutes: normalizeRetentionMinutes(process.env.REVISION_STATE_RETENTION_MINUTES, 15),
  intervalMs: 10 * 60_000,
  batchSize: 10_000,
}

export interface RetentionResult {
  runAt: number
  durationMs: number
  deletedRows: number
}

async function deleteBatches(label: string, table: string, predicate: string): Promise<number> {
  let total = 0
  let deleted = 0
  do {
    deleted = Number(await prisma.$executeRawUnsafe(`
      DELETE FROM ${table} WHERE ctid IN (
        SELECT ctid FROM ${table} WHERE ${predicate} LIMIT ${retentionConfig.batchSize}
      )
    `))
    total += deleted
    if (deleted > 0) await new Promise((resolve) => setTimeout(resolve, 50))
  } while (deleted === retentionConfig.batchSize)
  if (total > 0) console.log(`[cleanup] ${label}: deleted ${total}`)
  return total
}

export async function runRetention(): Promise<RetentionResult> {
  const startedAt = Date.now()
  let deletedRows = 0
  const tradeCutoff = BigInt(startedAt - retentionConfig.tradeHours * 60 * 60_000)
  const aggregateCutoff = new Date(startedAt - retentionConfig.aggregateHours * 60 * 60_000).toISOString().replaceAll("'", "''")
  const revisionCutoff = new Date(startedAt - retentionConfig.revisionMinutes * 60_000).toISOString().replaceAll("'", "''")
  deletedRows += await deleteBatches("trades", "trades", `timestamp < ${tradeCutoff}`)
  deletedRows += await deleteBatches("token minute aggregates", "token_minute_aggregates", `minute < '${aggregateCutoff}'::timestamptz`)
  deletedRows += await deleteBatches("buyer minute aggregates", "token_buyer_minute_aggregates", `minute < '${aggregateCutoff}'::timestamptz`)
  deletedRows += await deleteBatches("legacy revision journal", "token_revision_journal", `created_at < '${revisionCutoff}'::timestamptz`)
  deletedRows += await deleteBatches("dirty mint state", "token_dirty_mints", `updated_at < '${revisionCutoff}'::timestamptz`)
  return { runAt: Date.now(), durationMs: Date.now() - startedAt, deletedRows }
}

export function startRetention(onResult: (result: RetentionResult) => void): void {
  const execute = async () => {
    try {
      onResult(await runRetention())
    } catch (error) {
      console.error("[cleanup] Failed:", (error as Error).message)
    }
  }
  setTimeout(() => void execute(), 60_000)
  setInterval(() => void execute(), retentionConfig.intervalMs)
}
