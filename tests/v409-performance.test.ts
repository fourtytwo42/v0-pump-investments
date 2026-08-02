import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, stat, truncate, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { maintainImageCacheNow } from "@/lib/image-cache-manager"
import { normalizedTokenQueryKey } from "@/lib/token-query"

test("normalized query keys share equivalent favorite sets and filter order", () => {
  const first = normalizedTokenQueryKey({
    page: 1,
    favoriteMints: ["beta", "alpha", "alpha"],
    filters: { minUniqueTraders: 2, hideExternal: true },
  })
  const second = normalizedTokenQueryKey({
    page: 1,
    favoriteMints: ["alpha", "beta"],
    filters: { hideExternal: true, minUniqueTraders: 2 },
  })
  assert.equal(first, second)
})

test("Nginx rate limits use the trusted real-IP result and overwrite forwarded headers", async () => {
  const config = await readFile(new URL("../deploy/nginx/pump-investments.conf", import.meta.url), "utf8")
  assert.match(config, /limit_req_zone \$binary_remote_addr zone=pump_snapshots_v409:10m rate=5r\/s/)
  assert.doesNotMatch(config, /map \$http_cf_connecting_ip/)
  assert.match(config, /real_ip_header CF-Connecting-IP/)
  assert.match(config, /proxy_set_header CF-Connecting-IP \$remote_addr/)
  assert.match(config, /zone=pump_support_v411:10m rate=60r\/m/)
  assert.equal(config.match(/include \/etc\/nginx\/snippets\/pump-investments-security\.conf/g)?.length, 9)
})

test("VM release stays manual and creates neither backups nor GitHub Actions", async () => {
  const script = await readFile(new URL("../deploy/vm-release.sh", import.meta.url), "utf8")
  const support = await readFile(new URL("../lib/support-ticket.ts", import.meta.url), "utf8")
  assert.match(script, /git -C "\$CONTROL_REPO" fetch --prune origin main/)
  assert.match(script, /CANDIDATE_PORT=3002/)
  assert.match(script, /SUPPORT_TURNSTILE_LOOPBACK_TEST_BYPASS="1" npm start/)
  assert.match(support, /SUPPORT_TURNSTILE_LOOPBACK_TEST_BYPASS === "1"/)
  assert.match(support, /\["127\.0\.0\.1", "localhost", "::1"\]\.includes\(requestHostname\)/)
  assert.doesNotMatch(script, /pg_dump|github\/workflows|gh workflow/)
})

test("VM cutover recreates PM2 processes so immutable release paths take effect", async () => {
  const script = await readFile(new URL("../deploy/vm-release.sh", import.meta.url), "utf8")
  assert.match(script, /pm2 delete pump-investments-web pump-investments-ingest/)
  assert.match(script, /pm2 start \"\$release_dir\/ecosystem\.config\.cjs\"/)
  assert.doesNotMatch(script, /pm2 startOrReload/)
  assert.match(script, /Report-only CSP header missing/)
  assert.match(script, /HSTS header missing or incorrect/)
})

test("CSP permits Cloudflare analytics and the support Turnstile challenge", async () => {
  for (const file of ["security-report-only.conf", "security-enforced.conf"]) {
    const policy = await readFile(new URL(`../deploy/nginx/${file}`, import.meta.url), "utf8")
    assert.match(policy, /script-src[^;]+https:\/\/static\.cloudflareinsights\.com/)
    assert.match(policy, /connect-src[^;]+https:\/\/cloudflareinsights\.com/)
    assert.match(policy, /frame-src[^;]+https:\/\/challenges\.cloudflare\.com/)
  }
})

test("image cache verification removes temporary and orphan metadata files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pump-image-cache-"))
  try {
    await Promise.all([
      writeFile(path.join(root, "orphan.json"), "{}"),
      writeFile(path.join(root, "stale.tmp"), "partial"),
      writeFile(path.join(root, "valid.bin"), "image"),
      writeFile(path.join(root, "valid.json"), JSON.stringify({ contentType: "image/png", size: 5 })),
    ])
    const old = new Date(Date.now() - 2 * 60 * 60_000)
    const { utimes } = await import("node:fs/promises")
    await utimes(path.join(root, "stale.tmp"), old, old)
    await maintainImageCacheNow(root)
    await assert.rejects(stat(path.join(root, "orphan.json")))
    await assert.rejects(stat(path.join(root, "stale.tmp")))
    assert.equal(await readFile(path.join(root, "valid.bin"), "utf8"), "image")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("image cache evicts from 480 MiB to no more than 450 MiB", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pump-image-eviction-"))
  try {
    for (let index = 0; index < 3; index += 1) {
      const body = path.join(root, `${index}.bin`)
      await writeFile(body, "")
      await truncate(body, 170 * 1024 * 1024)
      await writeFile(path.join(root, `${index}.json`), "{}")
    }
    await maintainImageCacheNow(root)
    const sizes = await Promise.all([0, 1, 2].map((index) =>
      stat(path.join(root, `${index}.bin`)).then((value) => value.size).catch(() => 0),
    ))
    assert.ok(sizes.reduce((sum, size) => sum + size, 0) <= 450 * 1024 * 1024)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
