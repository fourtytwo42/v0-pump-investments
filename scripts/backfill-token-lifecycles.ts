import { createPrismaClient } from "@/lib/prisma-client"

import { fetchPumpLifecycleBatch } from "@/lib/pump-lifecycle"
import {
  classifyPumpLifecycle,
  isCompletedLifecycle,
  reduceLifecycle,
} from "@/lib/token-lifecycle"

const prisma = createPrismaClient("utility")
const batchSize = Math.min(50, Math.max(1, Number(process.env.LIFECYCLE_BATCH_SIZE ?? 50)))
const requestSpacingMs = 2_200

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  const tokens = await prisma.token.findMany({
    orderBy: { mintAddress: "asc" },
    select: {
      id: true,
      mintAddress: true,
      lifecycleStatus: true,
      graduatedAt: true,
      pumpSwapPool: true,
      bondingProgress: true,
      bondingCurve: true,
      associatedBondingCurve: true,
    },
  })

  const counts = new Map<string, number>()
  const unresolved: string[] = []
  const conflicts: string[] = []

  for (let offset = 0; offset < tokens.length; offset += batchSize) {
    const batch = tokens.slice(offset, offset + batchSize)
    const payloads = await fetchPumpLifecycleBatch(batch.map((token) => token.mintAddress))
    const byMint = new Map(
      payloads
        .filter((payload) => typeof payload.mint === "string")
        .map((payload) => [payload.mint as string, payload]),
    )

    for (const token of batch) {
      const payload = byMint.get(token.mintAddress)
      const verified = payload ? classifyPumpLifecycle(payload) : null
      if (!verified) {
        unresolved.push(token.mintAddress)
        continue
      }
      const transition = reduceLifecycle(token.lifecycleStatus, verified)
      if (transition.conflict) conflicts.push(token.mintAddress)
      counts.set(transition.next, (counts.get(transition.next) ?? 0) + 1)
      const now = new Date()
      const bondingProgress = isCompletedLifecycle(transition.next)
        ? 100
        : verified.bondingProgress ?? token.bondingProgress
      await prisma.token.update({
        where: { id: token.id },
        data: {
          lifecycleStatus: transition.next,
          lifecycleVerifiedAt: now,
          completed: isCompletedLifecycle(transition.next),
          pumpSwapPool: verified.pumpSwapPool ?? token.pumpSwapPool,
          bondingProgress,
          graduatedAt:
            isCompletedLifecycle(transition.next) && !token.graduatedAt
              ? now
              : token.graduatedAt,
          bondingCurve: verified.bondingCurve ?? token.bondingCurve,
          associatedBondingCurve:
            verified.associatedBondingCurve ?? token.associatedBondingCurve,
        },
      })
    }

    console.log(`[backfill] processed=${Math.min(offset + batch.length, tokens.length)} total=${tokens.length}`)
    if (offset + batch.length < tokens.length) await delay(requestSpacingMs)
  }

  await prisma.tokenDataRevision.upsert({
    where: { key: "tokens" },
    create: { key: "tokens", revision: BigInt(1) },
    update: { revision: { increment: BigInt(1) } },
  })
  await prisma.token.updateMany({
    where: { lifecycleStatus: { notIn: ["CURVE_COMPLETE", "PUMPSWAP"] } },
    data: { completed: false },
  })
  await prisma.token.updateMany({
    where: { lifecycleStatus: { in: ["CURVE_COMPLETE", "PUMPSWAP"] } },
    data: { completed: true },
  })

  console.log(
    JSON.stringify(
      {
        total: tokens.length,
        statuses: Object.fromEntries(counts),
        unresolvedCount: unresolved.length,
        unresolved,
        conflictCount: conflicts.length,
        conflicts,
      },
      null,
      2,
    ),
  )
}

main()
  .catch((error) => {
    console.error("[backfill] failed", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
