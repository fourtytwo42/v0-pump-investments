import { readdir } from "node:fs/promises"
import path from "node:path"
import type { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma-ingest"

export interface IngesterRuntimeSnapshot {
  connection_state: string
  queue_depth: number
  active_processors: number
  latest_trade_seen_ms: number
  latest_trade_persisted_ms: number
  last_trade_message_at: number
  metadata: Record<string, number | string>
  retention: Record<string, number | string | null>
}

async function countFiles(directory: string): Promise<number> {
  return (await readdir(directory, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile()).length
}

export function startRuntimeHealthPublisher(
  spoolRoot: string,
  readSnapshot: () => IngesterRuntimeSnapshot,
  intervalMs = 5_000,
): ReturnType<typeof setInterval> {
  let publishing = false
  const publish = async () => {
    if (publishing) return
    publishing = true
    try {
      const payload = {
        ...readSnapshot(),
        spool: {
          pending_files: await countFiles(path.join(spoolRoot, "pending")),
          dead_letter_files: await countFiles(path.join(spoolRoot, "dead-letter")),
        },
        reported_at: new Date().toISOString(),
      }
      await prisma.runtimeHealthState.upsert({
        where: { key: "ingester" },
        create: { key: "ingester", payload: payload as unknown as Prisma.InputJsonValue },
        update: { payload: payload as unknown as Prisma.InputJsonValue },
      })
    } catch (error) {
      console.warn("[health] runtime-state publish failed:", (error as Error).message)
    } finally {
      publishing = false
    }
  }
  void publish()
  return setInterval(() => void publish(), intervalMs)
}
