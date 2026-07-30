# Pump.Investments No-Visual-Change Improvement Audit

Date: 2026-07-29  
Audited version: 3.1.3  
Live target: `http://192.168.50.237:3000`

## Constraint

Keep the current layout, styling, card design, controls, and general interaction model. The recommendations below improve correctness, performance, reliability, security, accessibility, and maintainability without redesigning the application.

## Current Baseline

- Both PM2 services are online.
- Snapshot API, 25 local VM samples:
  - p50: 7.2 ms
  - p95: 10.3 ms
  - max: 11.5 ms
- Newest persisted trade lag during the audit: 1.823 seconds.
- Current database:
  - 1,314 tokens
  - 8,942 retained trades
  - 485 tokens without a stored image
  - 13 tokens with unresolved lifecycle
  - 17 queued lifecycle checks
- The `trades` table is currently about 20 MB.
- Host CPU, memory, swap, and disk have ample headroom.
- Production build succeeds and all 18 current unit tests pass.
- TypeScript validation passes.
- The lint command is not configured and opens an interactive setup prompt.
- Browser inspection found a healthy SSE connection, but also found missing alert-sound assets and two mounted notification regions.

## Priority 0: Correctness and Security

### 1. Make trade persistence atomic and retryable

The ingester currently catches some price and trade insert connection failures, resolves those promises, advances the in-memory "persisted" timestamp, and marks the token revision dirty. This can silently lose a trade while health logs claim it was persisted. Price and trade writes can also commit independently.

Recommended change:

- Write token, price, trade, and optional market-cap records in an idempotent transaction or durable staging pipeline.
- Retry the original complete batch on transient database failures.
- Advance `latestTradePersistedTimestampMs` only from confirmed inserted or already-existing signatures.
- Add a dead-letter or local disk spool after bounded retry exhaustion.
- Put a maximum size and backpressure policy on the in-memory trade queue.
- Test database disconnect, timeout, deadlock, partial-write, and restart recovery paths.

### 2. Patch vulnerable framework and websocket dependencies

`npm audit --omit=dev` reports 17 production-tree findings: 1 critical, 11 high, 1 moderate, and 4 low. Directly affected packages include Next.js 14.1.0 and `ws` 8.18.3.

Recommended change:

- First move Next.js to a patched compatible release and `ws` to a patched 8.x release.
- Then plan a tested move to a currently supported Next.js line.
- Pin dependency versions instead of using `"latest"`.
- Add automated dependency updates and a CI audit gate with an explicit exception file.
- Do not use a blind force-upgrade; run the existing UI and API regression suite at each step.

### 3. Make alerts monitor the intended tokens

The alert checker only sees the current 12-token result page. A favorited token that is not on the visible page is not checked. Alerts also stop when the browser is closed. The browser loads the alert-sound service on every page load even though no sound assets exist.

Recommended change:

- Maintain a small dedicated realtime subscription for enabled alert mints, independent of the visible page and sort.
- Prefer server-side alert evaluation if alerts are expected to work while the browser is closed.
- Load the sound service only when an alert is enabled or the user tests a sound.
- Add the intended local sound assets or remove the invalid fallback URL probes.
- Preserve the existing alert controls and presentation.

### 4. Validate and bound every public API

Token and SSE request bodies are normalized but not schema-validated or size-limited. A client can send a very large favorites list or create many unique SSE query groups. The chat endpoint has no prompt-size limit or rate limit.

Recommended change:

- Validate API input with the already-installed Zod dependency.
- Cap favorites, strings, arrays, page sizes, request bodies, concurrent streams per client, and total unique query groups.
- Add LAN-aware rate limits to chat, metadata, image, snapshot, and stream endpoints.
- Return consistent 400, 413, 429, and 503 responses.
- Add request timeouts and cancellation propagation.

### 5. Remove exposed and obsolete realtime proxy code

The unused Edge `/api/pump-ws` route contains subscriber credentials in source and duplicates the dedicated ingester connection. No client references the route.

Recommended change:

- Remove the unused route after confirming no external consumer depends on it.
- Move all upstream credentials to the VM environment and rotate them where possible.
- Keep one hardened upstream subscription in the ingester.

## Priority 1: Realtime and Data Efficiency

### 6. Stop unchanged lifecycle checks from invalidating every token query

Every successful lifecycle recheck updates the token row and public verification timestamp, sets the global revision dirty, and causes every active query group to recompute. This happens even when lifecycle, pool, and bonding data are unchanged.

Recommended change:

- Separate operational `lastCheckedAt` from user-visible lifecycle transition data.
- Update the token and public revision only when lifecycle, pool, completion, or relevant metadata actually changes.
- Record unchanged checks in lightweight verifier metrics instead of rewriting the token.
- Use conditional SQL updates to reduce dead tuples and vacuum work.

### 7. Fix the global SSE revision race

Creating a new stream group overwrites the process-wide `lastObservedRevision`. An existing group can miss a revision if a new group subscribes during the wrong timing window. Initial snapshot and revision reads are also not atomic.

Recommended change:

- Track the last applied revision per query group.
- Read revision before and after snapshot generation, or use one database transaction/snapshot.
- Recompute each stale group independently.
- Add integration tests for concurrent subscriptions, updates during subscribe, disconnects, and reconnect snapshots.

### 8. Replace broad revision invalidation with changed-mint invalidation

One global revision means an update to any token can trigger every unique query to rerun its full aggregation.

Recommended change:

- Persist a bounded changed-mint journal keyed by revision.
- Skip groups that cannot be affected where filters and page membership make that provable.
- Coalesce changes once per second and retain the current snapshot recovery endpoint.

### 9. Pre-aggregate the rolling trade windows before growth makes them expensive

The current SQL query is fast, but each unique query scans and aggregates retained raw trades twice: once by token and once by token/buyer. This cost scales with traffic, retained rows, and unique client filters.

Recommended change:

- Add minute-level token aggregates and token/buyer aggregates.
- Query the 1–60 minute windows from those compact tables.
- Keep raw trades for audit/recovery only.
- Add `EXPLAIN (ANALYZE, BUFFERS)` regression fixtures and latency gates.

### 10. Centralize SOL price delivery

Every browser fetches CoinGecko once per minute while the ingester independently performs the same fetch. Browser failures retain a hard-coded value, and the ingester also starts from a hard-coded fallback.

Recommended change:

- Fetch SOL/USD once in the ingester or a small server cache.
- Persist the last valid value and timestamp.
- Include it in snapshot/SSE data.
- Treat stale price explicitly rather than silently using a magic fallback.

### 11. Add shared positive and negative image caching

Successful IPFS responses are browser-cacheable, but the web process does not share a persistent cache across clients. Failed images can be retried after remounts, repeatedly exercising the same bad metadata URLs.

Recommended change:

- Add a bounded server or reverse-proxy cache for image bytes.
- Add short negative caching by mint and failed candidate.
- Store image resolution status and last attempt in PostgreSQL.
- Keep the existing same-origin image URL and current placeholder behavior.

## Priority 1: Data Semantics

### 12. Correct the trade-amount filter contract

The Settings copy says the trade amount range counts individual trades, but SQL applies the range to each buyer's summed buy amount during the entire window.

Recommended change:

- Decide whether the control means individual trade amount or cumulative buyer amount.
- Make SQL, help text, tests, and alert/analytics terminology agree.
- Preserve the existing control and layout.

### 13. Remove the silent time-range expansion

When a requested range under 30 minutes contains no trades, the API silently expands it to 30 minutes. The client ignores `effectiveTimeRangeMinutes`, so the UI can say "10 min" while showing 30-minute results.

Recommended change:

- Honor the requested range exactly and return an empty result when appropriate.
- If fallback behavior is retained, make the client consume the effective range; exact-range behavior avoids a visual change.

### 14. Preserve launch source separately from current venue

The live feed exposes useful `program` and sometimes `platform` data, but the schema discards it. Pump bonding, PumpSwap, Moonshot/Meteora, and Raydium activity cannot be accurately attributed later.

Recommended change:

- Add separate `launchSource` and `tradeVenue` fields.
- Treat unknown as unknown rather than inferring a launchpad from an AMM trade.
- Backfill only from authoritative evidence.
- Retain the current external provenance icon unless a later UI change is requested.

### 15. Remove retired KOTH logic

KOTH remains in schema, SQL, settings, onboarding, and card logic even though the production database has no KOTH values and the current Pump API does not expose the signal.

Recommended change:

- Remove the KOTH query predicate and dead data path first.
- Remove its UI only when approved, because that would be a visible cleanup.

### 16. Improve token creation-time accuracy

When the feed lacks a creation timestamp, a new token row uses the first observed trade time. Older external tokens can therefore appear newly created until metadata recovery corrects them.

Recommended change:

- Mark creation time as unknown until verified.
- Store creation-time source and verification state.
- Use an authoritative source or explicit venue metadata for backfill.

## Priority 2: Browser and Bundle Efficiency

### 17. Reduce unnecessary React rerenders

Every token patch replaces the Token Context value. Every card consumes that entire context, so all visible cards can rerender even when one token changed. The custom card comparator therefore cannot provide the intended isolation.

Recommended change:

- Split realtime data, favorites, connection, and settings contexts, or use selector-based subscriptions.
- Pass stable favorite and action props to cards.
- Compare every displayed field that can change.
- Keep the existing cards visually identical.

### 18. Make Pause actually pause ordering

The Pause control changes a flag used by pagination-reset logic, but SSE patches continue to replace the ordered mint list. It does not actually freeze auto-sorting.

Recommended change:

- While paused, continue updating token values but retain the current ordered mint list.
- Apply the latest server order when resumed.
- Preserve the current button and labels.

### 19. Lazy-load closed panels and remove duplicate global UI

The home route ships about 267 kB of first-load JavaScript. Changelog, roadmap, PI Bot, onboarding, alert dialogs, and settings code are loaded with the initial dashboard. Both `ClientWrapper` and `Dashboard` mount a Toaster, matching the two notification regions seen in the DOM.

Recommended change:

- Dynamically import closed dialogs, sheets, onboarding, alert management, and PI Bot.
- Mount exactly one Toaster.
- Remove unused client modules and dependencies.
- Keep loading behavior and appearance unchanged once a panel opens.

### 20. Add non-visual accessibility hardening

Several icon-only controls have no accessible name, the settings trigger is unlabeled, pagination is exposed as generic text, and mobile zoom is disabled.

Recommended change:

- Add `aria-label`, dialog descriptions, focus restoration, and proper pagination links/buttons.
- Restore user zoom.
- Verify keyboard-only operation and screen-reader names.
- Do not change styling or control placement.

## Priority 2: Maintainability and Operations

### 21. Split the ingester into focused modules

`server/ingest-trades.ts` is 2,186 lines and combines socket management, parsing, price conversion, SQL writes, metadata recovery, lifecycle verification, cleanup, candles, features, health logging, and shutdown.

Recommended change:

- Extract connection, queue, persistence, lifecycle, metadata, pricing, and maintenance modules.
- Keep one process initially; modularization does not require a deployment redesign.
- Remove dormant candle/feature code or move it to a separate optional worker.

### 22. Remove dead modules, packages, and lockfile ambiguity

The repository includes unused metadata/image caches, an unused websocket route, unused direct packages such as `socket.io-client` and `immer`, both npm and pnpm lockfiles, two global CSS files, and multiple overlapping metadata endpoints.

Recommended change:

- Confirm runtime references, then remove dead code.
- Standardize on npm and one lockfile.
- Consolidate metadata resolution behind one server service.
- Pin package versions.

### 23. Make linting and integration tests release gates

The build explicitly skips linting, `npm run lint` is interactive, and the test suite covers 18 unit cases but no API, SQL, SSE, ingestion-failure, alert, or browser integration paths.

Recommended change:

- Check in a non-interactive ESLint configuration.
- Make lint, typecheck, tests, and build required in CI.
- Add PostgreSQL integration tests and browser smoke tests.
- Add failure-injection tests for database and upstream outages.

### 24. Add operational health endpoints and alerts

The logs contain useful health fields, but there is no single machine-readable health view or alerting threshold.

Recommended change:

- Add a protected `/api/health` with process uptime, DB reachability, newest seen/persisted lag, queue depth, lifecycle backlog age, metadata backlog age, SSE group/client counts, and last SOL price age.
- Alert on sustained lag, reconnect loops, growing queues, lifecycle backlog age, image failure rate, and database disk growth.
- Schedule verified PostgreSQL backups and a restore drill.

### 25. Finish non-visual HTTP and metadata hardening

The app exposes `X-Powered-By`, lacks common security headers, references a missing favicon, and has placeholder search verification plus missing robots/sitemap files.

Recommended change:

- Disable the framework signature.
- Add CSP, frame, content-type, referrer, and permissions headers suitable for the app.
- Add the referenced favicon and generated robots/sitemap files.
- Remove placeholder verification metadata until a real value is configured.

## Recommended Delivery Order

1. Atomic ingestion and truthful persistence metrics.
2. Patched Next.js and websocket dependencies.
3. API validation, stream limits, and credential cleanup.
4. Alert correctness and sound-service lazy loading.
5. Lifecycle no-op suppression and SSE revision-race fix.
6. SOL price centralization and shared image caching.
7. Query pre-aggregation before traffic or retention grows.
8. React rerender, lazy-loading, duplicate Toaster, and Pause behavior fixes.
9. Data semantics, source/venue persistence, KOTH cleanup, and creation-time provenance.
10. Module cleanup, lint/CI, health endpoint, accessibility, and metadata/HTTP polish.

## Acceptance Targets

- No confirmed trade is lost during a simulated database outage or process restart.
- Persisted lag is calculated only from confirmed database state and remains below 2 seconds p95 during normal operation.
- Snapshot p95 remains below 150 ms with projected 24-hour production volume and ten distinct query groups.
- Unchanged lifecycle checks cause no public revision or SSE patch.
- Concurrent stream creation cannot make another stream miss a revision.
- Alerts evaluate every enabled mint, regardless of the visible page.
- No browser makes recurring CoinGecko or missing-sound probe requests.
- One mounted notification region and no duplicate toast delivery.
- No critical or high production dependency advisories without a documented exception.
- Lint, typecheck, unit tests, integration tests, build, and browser smoke checks are non-interactive release gates.

