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
