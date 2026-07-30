import { readdir, stat } from "node:fs/promises"
import path from "node:path"
import { prisma } from "@/lib/prisma"

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
    lifecycleBacklog,
    metadataMissing,
    revisions,
    sol,
    dirtyMints,
    spool,
    deadLetter,
    images,
  ] = await Promise.all([
    prisma.trade.findFirst({
      orderBy: { createdAt: "desc" },
      select: { timestamp: true, createdAt: true },
    }),
    prisma.tokenLifecycleCheck.count(),
    prisma.token.count({ where: { OR: [{ imageUri: null }, { metadataUri: null }] } }),
    prisma.tokenDataRevision.findMany(),
    prisma.solPriceState.findUnique({ where: { key: "sol-usd" } }),
    prisma.tokenDirtyMint.count(),
    directoryMetrics(path.join(spoolRoot, "pending")),
    directoryMetrics(path.join(spoolRoot, "dead-letter")),
    directoryMetrics(imageRoot),
  ])
  const latestTimestamp = Number(latestTrade?.timestamp ?? 0)
  const persistedLagMs =
    latestTrade && latestTimestamp
      ? Math.max(0, latestTrade.createdAt.getTime() - latestTimestamp)
      : null

  return Response.json({
    version: process.env.APP_VERSION ?? "4.0.1",
    database: { status: "ok" },
    ingestion: {
      persisted_lag_ms: persistedLagMs,
      source_idle_ms: latestTimestamp ? Math.max(0, Date.now() - latestTimestamp) : null,
      spool,
      dead_letter: deadLetter,
    },
    lifecycle: { backlog: lifecycleBacklog },
    metadata: { missing: metadataMissing },
    realtime: {
      revisions: Object.fromEntries(revisions.map((row) => [row.key, row.revision.toString()])),
      dirty_mints: dirtyMints,
    },
    image_cache: images,
    sol_price: {
      value_usd: sol ? Number(sol.priceUsd) : null,
      updated_at: sol?.updatedAt.toISOString() ?? null,
    },
  })
}
