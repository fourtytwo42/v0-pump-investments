import type { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma-ingest"

type RevisionClient = Prisma.TransactionClient

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

export function revisionCoalescingEnabled(): boolean {
  return process.env.TOKEN_REVISION_COALESCING_ENABLED !== "false"
}

async function reserveRevision(client: RevisionClient): Promise<bigint> {
  if (!revisionCoalescingEnabled()) {
    const rows = await client.$queryRawUnsafe<Array<{ revision: bigint }>>(`
      INSERT INTO token_data_revisions (key,revision,updated_at) VALUES ('tokens',1,NOW())
      ON CONFLICT (key) DO UPDATE SET revision=token_data_revisions.revision+1,updated_at=NOW()
      RETURNING revision
    `)
    return rows[0]?.revision ?? BigInt(0)
  }

  await client.$executeRawUnsafe(`
    INSERT INTO token_data_revisions (key,revision,updated_at) VALUES ('tokens',0,NOW())
    ON CONFLICT (key) DO NOTHING
  `)
  await client.$executeRawUnsafe(`
    INSERT INTO token_data_revisions (key,revision,updated_at) VALUES ('tokens-pending',0,NOW())
    ON CONFLICT (key) DO NOTHING
  `)
  const rows = await client.$queryRawUnsafe<Array<{ public_revision: bigint; pending_revision: bigint }>>(`
    SELECT public.revision AS public_revision,pending.revision AS pending_revision
    FROM token_data_revisions public
    JOIN token_data_revisions pending ON pending.key='tokens-pending'
    WHERE public.key='tokens'
    FOR UPDATE OF public,pending
  `)
  const state = rows[0]
  const target = state
    ? (state.pending_revision > state.public_revision ? state.pending_revision : state.public_revision + BigInt(1))
    : BigInt(1)
  await client.$executeRawUnsafe(`
    UPDATE token_data_revisions SET revision=${target},updated_at=NOW() WHERE key='tokens-pending'
  `)
  return target
}

export async function recordDirtyMintsInTransaction(
  client: RevisionClient,
  mints: string[],
  changeKinds: string[],
  journalEnabled = true,
): Promise<bigint> {
  const revision = await reserveRevision(client)
  const uniqueMints = [...new Set(mints)]
  if (!journalEnabled || uniqueMints.length === 0 || changeKinds.length === 0) return revision
  const values = uniqueMints.map((mintAddress) =>
    `(${sqlString(mintAddress)},ARRAY[${changeKinds.map(sqlString).join(",")}]::text[],${revision},NOW())`,
  ).join(",")
  await client.$executeRawUnsafe(`
    INSERT INTO token_dirty_mints (mint_address,change_kinds,revision,updated_at)
    VALUES ${values}
    ON CONFLICT (mint_address) DO UPDATE SET
      change_kinds=(SELECT ARRAY(SELECT DISTINCT unnest(token_dirty_mints.change_kinds || EXCLUDED.change_kinds))),
      revision=EXCLUDED.revision,updated_at=NOW()
  `)
  return revision
}

export async function recordDirtyMints(
  mints: string[],
  changeKinds: string[],
  journalEnabled = true,
): Promise<void> {
  await prisma.$transaction((tx) =>
    recordDirtyMintsInTransaction(tx, mints, changeKinds, journalEnabled),
  )
}

export async function publishPendingRevision(): Promise<boolean> {
  if (!revisionCoalescingEnabled()) return false
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<Array<{ public_revision: bigint; pending_revision: bigint }>>(`
      SELECT public.revision AS public_revision, pending.revision AS pending_revision
      FROM token_data_revisions public
      JOIN token_data_revisions pending ON pending.key='tokens-pending'
      WHERE public.key='tokens'
      FOR UPDATE OF public, pending
    `)
    const state = rows[0]
    if (!state || state.pending_revision <= state.public_revision) return false
    await tx.$executeRawUnsafe(`
      UPDATE token_data_revisions SET revision=${state.pending_revision},updated_at=NOW()
      WHERE key='tokens'
    `)
    return true
  })
}

export async function markRevisionPending(): Promise<void> {
  await prisma.$transaction((tx) => recordDirtyMintsInTransaction(tx, [], [], false))
}
