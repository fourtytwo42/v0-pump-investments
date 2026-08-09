import { readdir, stat, statfs } from "node:fs/promises"
import path from "node:path"
import { prisma } from "@/lib/prisma"
import { getTokenQueryMetrics } from "@/lib/token-query"
import { getTokenStreamMetrics } from "@/lib/token-stream"
import { getAlertStreamMetrics } from "@/lib/alert-stream"
import { getImageCacheProcessMetrics } from "@/lib/image-cache-manager"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

async function directoryMetrics(directory: string): Promise<{ files: number; bytes: number }> {
  try {
    const names = await readdir(directory)
    const stats = await Promise.all(names.map((name) => stat(path.join(directory, name))))
    return {
      files: stats.filter((item) => item.isFile()).length,
      bytes: stats.reduce((total, item) => total + (item.isFile() ? item.size : 0), 0),
    }
  } catch {
    return { files: 0, bytes: 0 }
  }
}

async function diskMetrics(directory: string) {
  try {
    const info = await statfs(directory)
    const total = Number(info.blocks) * Number(info.bsize)
    const available = Number(info.bavail) * Number(info.bsize)
    return { total_bytes: total, available_bytes: available, used_percent: total ? ((total - available) / total) * 100 : 0 }
  } catch {
    return { total_bytes: null, available_bytes: null, used_percent: null }
  }
}

export async function GET(request: Request): Promise<Response> {
  const expected = process.env.HEALTH_DETAILS_TOKEN
  const supplied = request.headers.get("authorization")
  if (!expected || supplied !== `Bearer ${expected}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const spoolRoot =
    process.env.INGEST_SPOOL_DIR ??
    path.join(/* turbopackIgnore: true */ process.cwd(), "server", "data", "spool")
  const imageRoot =
    process.env.TOKEN_IMAGE_CACHE_DIR ??
    path.join(/* turbopackIgnore: true */ process.cwd(), "server", "data", "images")
  const [
    latestTrade,
    lifecycleCounts,
    metadataCounts,
    revisions,
    sol,
    dirtyMints,
    spool,
    deadLetter,
    images,
    runtimeHealth,
    databaseSize,
    tableHealth,
    retainedAges,
    disk,
    supportCounts,
    supportAttachments,
  ] = await Promise.all([
    prisma.trade.findFirst({
      orderBy: { createdAt: "desc" },
      select: { timestamp: true, createdAt: true },
    }),
    prisma.$queryRaw<Array<{
      total: bigint
      due: bigint
      cooling: bigint
      high_priority_due: bigint
      oldest_overdue_ms: number | null
    }>>`
      SELECT COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE next_attempt_at <= NOW())::bigint AS due,
        COUNT(*) FILTER (WHERE next_attempt_at > NOW())::bigint AS cooling,
        COUNT(*) FILTER (WHERE next_attempt_at <= NOW() AND priority >= 80)::bigint AS high_priority_due,
        MAX(EXTRACT(EPOCH FROM (NOW() - next_attempt_at)) * 1000)
          FILTER (WHERE next_attempt_at <= NOW())::double precision AS oldest_overdue_ms
      FROM token_lifecycle_checks
    `,
    prisma.$queryRaw<Array<{ total: bigint; active: bigint }>>`
      SELECT COUNT(*) FILTER (WHERE t.image_uri IS NULL OR t.metadata_uri IS NULL)::bigint AS total,
        COUNT(*) FILTER (
          WHERE (t.image_uri IS NULL OR t.metadata_uri IS NULL)
            AND p.last_trade_timestamp >= ${(BigInt(Date.now() - 60 * 60_000))}
        )::bigint AS active
      FROM tokens t LEFT JOIN token_prices p ON p.token_id=t.id
    `,
    prisma.tokenDataRevision.findMany(),
    prisma.solPriceState.findUnique({ where: { key: "sol-usd" } }),
    prisma.tokenDirtyMint.count(),
    directoryMetrics(path.join(spoolRoot, "pending")),
    directoryMetrics(path.join(spoolRoot, "dead-letter")),
    directoryMetrics(imageRoot),
    prisma.runtimeHealthState.findUnique({ where: { key: "ingester" } }),
    prisma.$queryRaw<Array<{ bytes: bigint }>>`SELECT pg_database_size(current_database())::bigint AS bytes`,
    prisma.$queryRaw<Array<{ table_name: string; live_rows: bigint; dead_rows: bigint; dead_percent: number }>>`
      SELECT relname AS table_name,n_live_tup::bigint AS live_rows,n_dead_tup::bigint AS dead_rows,
        CASE WHEN n_live_tup+n_dead_tup=0 THEN 0 ELSE (n_dead_tup::double precision/(n_live_tup+n_dead_tup))*100 END AS dead_percent
      FROM pg_stat_user_tables
      WHERE relname IN ('trades','token_minute_aggregates','token_buyer_minute_aggregates','token_dirty_mints')
    `,
    prisma.$queryRaw<Array<{ oldest_trade_ms: bigint | null; newest_trade_ms: bigint | null }>>`
      SELECT MIN(timestamp)::bigint AS oldest_trade_ms,MAX(timestamp)::bigint AS newest_trade_ms FROM trades
    `,
    diskMetrics(process.cwd()),
    prisma.supportTicket.groupBy({ by: ["status"], _count: true }),
    prisma.supportAttachment.aggregate({ _count: true, _sum: { byteSize: true } }),
  ])
  const latestTimestamp = Number(latestTrade?.timestamp ?? 0)
  const persistedLagMs =
    latestTrade && latestTimestamp
      ? Math.max(0, latestTrade.createdAt.getTime() - latestTimestamp)
      : null

  return Response.json({
    version: process.env.APP_VERSION ?? "4.0.9",
    database: {
      status: "ok",
      size_bytes: Number(databaseSize[0]?.bytes ?? 0),
      retained_rows: retainedAges[0] ? {
        oldest_trade_at: retainedAges[0].oldest_trade_ms ? new Date(Number(retainedAges[0].oldest_trade_ms)).toISOString() : null,
        newest_trade_at: retainedAges[0].newest_trade_ms ? new Date(Number(retainedAges[0].newest_trade_ms)).toISOString() : null,
      } : null,
      tables: tableHealth.map((row) => ({
        name: row.table_name,
        live_rows: Number(row.live_rows),
        dead_rows: Number(row.dead_rows),
        dead_percent: row.dead_percent,
      })),
    },
    disk,
    ingestion: {
      persisted_lag_ms: persistedLagMs,
      source_idle_ms: latestTimestamp ? Math.max(0, Date.now() - latestTimestamp) : null,
      spool,
      dead_letter: deadLetter,
      runtime: runtimeHealth ? { payload: runtimeHealth.payload, updated_at: runtimeHealth.updatedAt.toISOString() } : null,
    },
    lifecycle: {
      backlog: Number(lifecycleCounts[0]?.total ?? 0),
      due: Number(lifecycleCounts[0]?.due ?? 0),
      cooling: Number(lifecycleCounts[0]?.cooling ?? 0),
      high_priority_due: Number(lifecycleCounts[0]?.high_priority_due ?? 0),
      oldest_overdue_ms: lifecycleCounts[0]?.oldest_overdue_ms ?? null,
    },
    metadata: {
      missing: Number(metadataCounts[0]?.total ?? 0),
      active_window_missing: Number(metadataCounts[0]?.active ?? 0),
    },
    realtime: {
      revisions: Object.fromEntries(revisions.map((row) => [row.key, row.revision.toString()])),
      dirty_mints: dirtyMints,
      token_stream: getTokenStreamMetrics(),
      alert_stream: getAlertStreamMetrics(),
    },
    snapshots: getTokenQueryMetrics(),
    image_cache: { ...images, ...getImageCacheProcessMetrics() },
    sol_price: {
      value_usd: sol ? Number(sol.priceUsd) : null,
      updated_at: sol?.updatedAt.toISOString() ?? null,
    },
    support: {
      tickets: Object.fromEntries(supportCounts.map((row) => [row.status.toLowerCase(), row._count])),
      attachments: Number(supportAttachments._count),
      attachment_bytes: Number(supportAttachments._sum.byteSize ?? 0),
    },
  })
}
