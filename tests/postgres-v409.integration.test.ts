import "dotenv/config"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import test from "node:test"
import pg from "pg"

const enabled = process.env.RUN_POSTGRES_INTEGRATION_TESTS === "true"
const databaseUrl = process.env.DATABASE_URL

test("PostgreSQL revision coalescing and repeatable-read characterization", { skip: !enabled }, async () => {
  assert.ok(databaseUrl, "DATABASE_URL is required for PostgreSQL integration tests")
  const schema = `v409_${randomUUID().replaceAll("-", "")}`
  const first = new pg.Client({ connectionString: databaseUrl })
  const second = new pg.Client({ connectionString: databaseUrl })
  await Promise.all([first.connect(), second.connect()])
  try {
    await first.query(`CREATE SCHEMA "${schema}"`)
    await first.query(`CREATE TABLE "${schema}".revisions (key text PRIMARY KEY, revision bigint NOT NULL)`)
    await first.query(`CREATE TABLE "${schema}".items (id integer PRIMARY KEY)`)
    await first.query(`INSERT INTO "${schema}".revisions VALUES ('tokens',0),('tokens-pending',0)`)
    for (let index = 0; index < 10; index += 1) {
      await first.query("BEGIN")
      const state = await first.query(`SELECT key,revision FROM "${schema}".revisions FOR UPDATE`)
      const revisions = new Map(state.rows.map((row) => [row.key, Number(row.revision)]))
      const target = Math.max(revisions.get("tokens-pending") ?? 0, (revisions.get("tokens") ?? 0) + 1)
      await first.query(`UPDATE "${schema}".revisions SET revision=$1 WHERE key='tokens-pending'`, [target])
      await first.query("COMMIT")
    }
    const pending = await first.query(`SELECT revision FROM "${schema}".revisions WHERE key='tokens-pending'`)
    assert.equal(Number(pending.rows[0].revision), 1)
    await first.query(`UPDATE "${schema}".revisions SET revision=(SELECT revision FROM "${schema}".revisions WHERE key='tokens-pending') WHERE key='tokens'`)

    await first.query("BEGIN ISOLATION LEVEL REPEATABLE READ")
    await first.query(`SELECT COUNT(*) FROM "${schema}".items`)
    await second.query(`INSERT INTO "${schema}".items VALUES (1)`)
    const stable = await first.query(`SELECT COUNT(*)::int AS count FROM "${schema}".items`)
    assert.equal(stable.rows[0].count, 0)
    await first.query("COMMIT")
    const after = await first.query(`SELECT COUNT(*)::int AS count FROM "${schema}".items`)
    assert.equal(after.rows[0].count, 1)
  } finally {
    await first.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined)
    await Promise.all([first.end(), second.end()])
  }
})

test("PostgreSQL lifecycle queue promotion preserves retry backoff", { skip: !enabled }, async () => {
  assert.ok(databaseUrl, "DATABASE_URL is required for PostgreSQL integration tests")
  const schema = `lifecycle_${randomUUID().replaceAll("-", "")}`
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`
      CREATE TABLE "${schema}".checks (
        token_id text PRIMARY KEY,
        requested_at timestamptz NOT NULL,
        next_attempt_at timestamptz NOT NULL,
        attempts integer NOT NULL,
        priority integer NOT NULL,
        reason text NOT NULL,
        updated_at timestamptz NOT NULL
      )
    `)
    await client.query(`
      INSERT INTO "${schema}".checks
      VALUES ('mint',NOW()-interval '1 minute',NOW()+interval '5 minutes',1,99,'active_unknown_trade',NOW())
    `)

    const upsert = async (priority: number, reason: string) => client.query(`
      INSERT INTO "${schema}".checks
        (token_id,requested_at,next_attempt_at,attempts,priority,reason,updated_at)
      VALUES ('mint',NOW(),NOW(),0,$1,$2,NOW())
      ON CONFLICT (token_id) DO UPDATE SET
        requested_at=CASE
          WHEN EXCLUDED.priority>checks.priority AND EXCLUDED.reason IS DISTINCT FROM checks.reason
            THEN NOW() ELSE checks.requested_at END,
        next_attempt_at=CASE
          WHEN EXCLUDED.priority>checks.priority AND EXCLUDED.reason IS DISTINCT FROM checks.reason
            THEN LEAST(checks.next_attempt_at,NOW()) ELSE checks.next_attempt_at END,
        priority=GREATEST(checks.priority,EXCLUDED.priority),
        reason=CASE WHEN EXCLUDED.priority>checks.priority THEN EXCLUDED.reason ELSE checks.reason END,
        updated_at=NOW()
      RETURNING requested_at,next_attempt_at,priority,reason
    `, [priority, reason])

    const sameReason = await upsert(110, "active_unknown_trade")
    assert.equal(sameReason.rows[0].priority, 110)
    assert.equal(sameReason.rows[0].reason, "active_unknown_trade")
    assert.ok(new Date(sameReason.rows[0].next_attempt_at).getTime() > Date.now())

    const promoted = await upsert(120, "trade_graduation_hint")
    assert.equal(promoted.rows[0].priority, 120)
    assert.equal(promoted.rows[0].reason, "trade_graduation_hint")
    assert.ok(new Date(promoted.rows[0].next_attempt_at).getTime() <= Date.now() + 1_000)
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined)
    await client.end()
  }
})
