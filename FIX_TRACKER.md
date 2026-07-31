# Fix Tracker

This file is the durable work queue for repo maintenance and recovery. If chat context is lost, start here.

### P0: Stale 99% bonding state

#### T17. Promote confirmed PumpSwap trades to graduated
- Status: `in_progress`
- Goal:
  - Remove stale Bonding states when the live feed proves a token is trading through a concrete PumpSwap pool.
  - Preserve monotonic lifecycle behavior and never infer graduation from market cap.
- Verification:
  - Audit production mismatches, add transition tests, backfill confirmed mismatches, and verify public bonding/graduated responses after deployment.

### P0: Intermittent and incomplete live feed

#### T16. Diagnose missing tokens and undercounted buyers/volume
- Status: `done`
- Goal:
  - Reproduce the reported intermittent feed and determine whether trades are lost upstream, during ingestion, in aggregation, or during SSE delivery.
  - Correct and deploy any confirmed application defect without changing the visual design.
- Verification:
  - Compare retained trades with minute aggregates and API totals, inspect connection/spool health, and exercise live snapshot/SSE delivery.
- Notes:
  - Root cause: `unifiedTradeEvent.processed` is Pump's sampled market-wide ticker and supplied only about 52–56 events per minute during the reported period.
  - Pump's frontend uses per-mint subjects. A live credential probe confirmed `unifiedTradeEvent.processed.*` supplies the complete processed stream without requiring an RPC node.
  - Release v4.0.3 makes the subject configurable through `PUMP_NATS_SUBJECT` and defaults it to the complete per-mint wildcard.
  - The first complete post-deployment minute persisted 6,952 trades across 460 tokens and 2,940 unique buyers, versus 130 trades in the preceding sampled minute.
  - Post-deployment verification: zero complete-minute aggregate mismatches, zero pending/dead-letter spool files, no new ingestion errors, 1.351-second p50 and 2.001-second p95 write lag, 120.9 ms public snapshot p95, and working public SSE snapshots/patches.

### P0: Production lifecycle correction

#### T15. Reverify Dre. MAGA graduation
- Status: `done`
- Goal:
  - Identify the exact production mint, compare its stored lifecycle with Pump's authoritative response, and make the existing verifier apply any confirmed graduation.
- Verification:
  - Confirm Pump response, persisted lifecycle/compatibility fields, and the public token API after correction.
- Notes:
  - The exact token is Dr. MAGA (`ADzmJCZfwf5vFQ6y9EysRS7xWqFgRc33QAAnj7Mipump`).
  - Pump's batch API was stale (`complete=false`, no pool), but production retained 120 `pump_amm` trades and the token's live venue was already `PUMPSWAP`.
  - Promoted the lifecycle monotonically to `PUMPSWAP` using the observed pool `5xdVJp6rSZ3TnfcY2SCmefy74TdwhSGewkxJ3yGqkqE6`, updated compatibility fields, and journaled the lifecycle revision.
  - Verified the public API returns `lifecycle_status=pumpswap`, `is_completed=true`, and `is_bonding_curve=false`; no lifecycle check remains queued.

## How To Use
- Read `memory.md` first for current facts, decisions, and recent changes.
- Read this tracker second for prioritized work and open issues.
- Update the status, notes, and next action after every meaningful change.
- When closing an item, add a short note about what changed and how it was verified.

## Current State
- Production build currently succeeds with `npm run build`.
- Full TypeScript validation passes with `npm run typecheck`.
- GitHub auth on this machine is fixed.
- The ingester reconnect hardening was implemented, built, restarted under PM2, and pushed to `main`.
- The LAN VM deployment is live at `http://192.168.50.237:3000`.

## Priorities

### P0: Appliance-backed PI Bot

#### T30. Connect PI Bot to the GPU45 Ornith model
- Status: `done`
- Goal:
  - Route server-side PI Bot requests to the LAN GPU45 appliance using `ornith-1.0-35b-Q5_K_M-688b8d0a`.
  - Cap PI Bot context at 100,000 tokens without exposing the appliance directly to browsers.
- Verification:
  - Real appliance chat-completions smoke test, unit/type/lint/build checks, VM deployment, and public `/api/chat` response.
  - Implemented server-side OpenAI-compatible chat routing to exact Ornith model alias with a hard 100,000-token context ceiling and no browser-to-appliance access.
  - Added non-buffered JSON heartbeats through Nginx/Next.js so model swaps survive public proxy idle limits.
  - Disabled or stripped Ornith reasoning from visible answers and removed the unused Groq/AI SDK integration.
  - Passed 26 unit tests, TypeScript, ESLint, production build, and `npm audit --omit=dev` with zero findings.
  - VM smoke returned exactly `PI BOT READY` in 58 seconds. Public `/api/chat` returned HTTP 200 with `PUBLIC PI BOT READY` in 50.379 seconds.
  - v4.0.2 is live from `main` commit `e1fa692`; both PM2 services are online and `/api/health` reports version 4.0.2.

### P0: Coordinated internal improvement release

#### T28. Implement and deploy the complete internal improvement plan
- Status: `done`
- Goal:
  - Deliver the atomic ingestion, aggregate queries, source/venue data, realtime correctness, alert reliability, image/cache, dependency, client-efficiency, security, observability, and VM proxy improvements as one reversible release.
- Constraints:
  - Preserve the current visual design except for removal of obsolete KOTH surfaces.
  - Keep `http://192.168.50.237:3000` as the LAN entrypoint.
- Verification:
  - Unit, integration, lint, typecheck, production build, dependency audit, migration/backfill, PM2/Nginx, API/SSE, fault-path, and live browser checks.
  - Local release candidate passes ESLint, TypeScript, 22 unit tests, Prisma validation, Turbopack production build, and `npm audit --omit=dev` with zero findings.
  - VM preflight recorded commit `b6ea963`, PostgreSQL 43 MB / 1,971 tokens / 14,112 trades, PM2 state, API baseline, and backup `/home/hendo420/backups/pumpinvestments-pre-v4-20260730-034106.dump` (SHA-256 `4d9b8b1076e032d40f1cca439ed254492a9d0b0373ed0cc07b8b9b1fccc37a72`).
  - Additive migration completed a live-schema transaction dry run and rolled back cleanly.
  - V4 is deployed from commit `98725f8`: Nginx owns LAN port `3000`, Next.js listens on `3001`, and both PM2 services are online and saved.
  - The release was exercised live from the preflight backup at 03:41 UTC through the 04:41 UTC soak sample, including spool recovery and controlled PM2/Nginx restarts.
  - Final checks: snapshot p95 26.4 ms over 30 LAN samples; confirmed persisted-write delay p95 1.922 seconds; spool/dead-letter zero; no new ingester error-log writes after 04:13 UTC; 12 Chromium/Firefox/WebKit tests pass.
  - Returning-user initial JavaScript is 252.2 kB versus the 267 kB baseline. Production dependency audit reports zero findings.
  - Upstream Pump subscriber credentials are no longer in source and live only in the mode-600 VM environment. Provider-side credential rotation still requires a replacement credential from Pump.

#### T29. Publish production through Cloudflare Tunnel
- Status: `done`
- Goal:
  - Serve `https://pump.investments` through an outbound-only Cloudflare Tunnel while preserving the LAN endpoint.
- Configuration:
  - Publish one unrestricted HTTP route from `pump.investments` to `http://127.0.0.1:3000`.
  - Do not publish ports 3001, 4000, PostgreSQL, or SSH.
  - Browser realtime uses same-origin fetch-based SSE; no separate WebSocket service or hostname is required.
- Verification:
  - VM confirmed Ubuntu 24.04 x86-64, Nginx active on 3000, Next.js on 3001, PostgreSQL loopback-only, and no listener on 4000.
  - Installed `cloudflared` 2026.7.3 from Cloudflare's official APT repository.
  - VM-local `/api/health` returned `status=ok`.
  - Both `/api/tokens/stream` and `/api/alerts/stream` returned 200 `text/event-stream` through Nginx with `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`.
  - Installed the remotely managed tunnel token as an enabled systemd service; Cloudflare reports tunnel `Pump.Investments-4` and its Linux connector Healthy/Connected.
  - Published unrestricted hostname `pump.investments` to `http://127.0.0.1:3000`.
  - Public `/` and `/api/health` returned HTTP 200 through Cloudflare; browser verification loaded the expected Pump.Investments v4 page at `https://pump.investments/`.
  - Added the v4.0.1 in-app changelog entry and aligned package, badge, health, and browser-test versions.
  - PR #4 was promoted from draft, merged into `main` as `a0b9445`, and deployed to the VM.
  - Deployment passed TypeScript, 22 unit tests, and the production build. Both PM2 services remained online, and LAN/public health returned version `4.0.1`.
- Runbook:
  - `deploy/cloudflare/README.md`

### P1: Whole-app efficiency and reliability audit

#### T21. Identify no-visual-change improvements
- Status: `done`
- Goal:
  - Review the deployed application and repository for performance, reliability, maintainability, observability, security, and data-quality improvements without changing the current visual design.
- Constraints:
  - Report only; do not implement product changes during the audit.
  - Preserve the current layout, styling, and interaction model.
- Verification:
  - Repository architecture review, targeted checks, and live LAN browser/runtime inspection.
- Notes:
  - Added `APP_IMPROVEMENT_AUDIT.md` with a prioritized, no-redesign improvement plan.
  - Live baseline measured snapshot API at 7.2 ms p50 and 10.3 ms p95, with 1.823 seconds newest-trade lag.
  - Found silent trade-loss risk on swallowed database write errors, lifecycle no-op write/revision churn, an SSE revision race, visible-page-only alert evaluation, unbounded public query inputs, vulnerable dependencies, dead realtime/metadata paths, and avoidable browser work.
  - Verification passed: 18 unit tests, TypeScript, production build, live browser inspection, PM2/host/database checks, and API timing samples. Lint remains unconfigured and interactive.

### P0: Persistence correctness

#### T22. Make ingester batches atomic and retryable
- Status: `done`
- Goal:
  - Prevent silent trade loss and false persisted-lag health during partial or transient database failures.
- Verification:
  - Failure-injection tests for disconnects, timeouts, deadlocks, partial writes, and process restarts.
  - The cutover exposed an invalid atomic INSERT; 108 failed batches remained on disk, replayed idempotently after the fix, and drained to zero with no dead-letter files.
  - Active spool files are excluded from replay scans, eliminating the observed foreground/replay file race.

### P0: Dependency security

#### T23. Patch vulnerable production dependencies
- Status: `done`
- Goal:
  - Upgrade Next.js, `ws`, and affected transitive dependencies through staged regression-tested releases.
- Verification:
  - No critical/high production audit findings without documented exceptions; tests, typecheck, build, and live smoke test pass.
  - Next 16.2.12, React 19.2.8, Prisma 7.9.1, `ws` 8.21.1, `pg` 8.22.0, TypeScript 5.9.3, and the requested toolchain pins are live.
  - `npm audit --omit=dev` reports zero vulnerabilities.

### P0: Alert correctness

#### T24. Monitor all enabled alert mints
- Status: `done`
- Goal:
  - Evaluate alerts independently of the current visible token page and avoid eager missing-sound probes.
- Verification:
  - Off-page favorite alert test, closed-panel sound test, and browser-open/closed behavior specification.
  - `/api/alerts/stream` returns independent snapshot/patch SSE data for requested mints and the client retains the five-second fallback after repeated stream failures.
  - Alert audio uses Web Audio only; all three browser engines observed no sound-file or CoinGecko requests.

### P1: Realtime efficiency

#### T25. Suppress lifecycle no-op revisions and fix SSE revision races
- Status: `done`
- Goal:
  - Avoid database/SSE churn for unchanged verification and guarantee each query group applies every relevant revision.
- Verification:
  - Concurrent subscribe/update integration tests and no patch for unchanged lifecycle responses.
  - Lifecycle writes are conditional, verifier health has its own revision, query groups track applied revisions independently, and snapshot/revision reads use a stable handshake.

### P1: API and query hardening

#### T26. Bound API inputs, stream groups, and rolling aggregation cost
- Status: `done`
- Goal:
  - Add schema validation, request/stream limits, and minute-level aggregates before retained trade volume grows.
- Verification:
  - Abuse-limit tests, ten-query load test, and `EXPLAIN (ANALYZE, BUFFERS)` latency gate.
  - Zod/body/page/favorite/query-group bounds are live; invalid JSON returns 400, oversized bodies 413, and Nginx/app stream limits return 429.
  - Minute and buyer-minute aggregates are populated and shadow comparison is equivalent to retained raw trades.

### P2: Client and maintenance cleanup

#### T27. Reduce initial bundle and rerender work without redesign
- Status: `done`
- Goal:
  - Split realtime context updates, lazy-load closed panels, mount one Toaster, make Pause freeze ordering, and remove dead code/dependencies.
- Verification:
  - Bundle comparison, render-count test, Pause behavior test, and unchanged visual snapshots.
  - Cards subscribe to normalized Zustand slices; Pause defers ordering and query changes resume it.
  - Settings, PI Bot, onboarding, and alert settings load on demand; one notification region remains.
  - Returning-user initial JavaScript measured 252.2 kB, and 12 cross-browser tests passed without visual changes beyond KOTH removal.

### P1: Token source and venue attribution

#### T20. Persist launch source separately from trade venue
- Status: `done`
- Problem:
  - Live unified trades expose `program` and sometimes `platform`, but the token schema discards them and only retains Pump vs `NON_LAUNCHPAD`.
- Goal:
  - Persist verified launch source and latest trade venue separately so cards and filters can distinguish Pump, Moonshot/Meteora, Raydium, and unknown external tokens without guessing.
- Verification:
  - Fixture coverage for observed programs, migration/backfill audit, API fields, and live LAN source/venue labels.
  - Source and venue are stored separately and exposed through the API; unknown is retained when launch provenance is not authoritative.
  - Live counts include Pump/Pump bonding, Pump/PumpSwap, Moonshot/Meteora DBC, Raydium, external, and unknown combinations. No new card labels were added.

### P1: Deprecated KOTH surface

#### T19. Remove or replace dead KOTH UI
- Status: `done`
- Problem:
  - Current Pump v3 single and batch responses expose no KOTH field, and the production database has zero `king_of_the_hill_timestamp` values.
- Goal:
  - Remove the KOTH card icon, Hide KOTH setting/filter, and obsolete onboarding/help references unless a new authoritative Pump signal is identified.
- Verification:
  - Confirm no KOTH UI or query conditions remain, then run tests, typecheck/build, and live LAN inspection.
  - KOTH settings, card logic, query predicates, onboarding references, and asset are removed. The compatibility API field remains nullable and returns `null`.

### P1: User-facing release notes

#### T18. Expand recent v3.1.x changelog entries
- Status: `done`
- Goal:
  - Fully document the slider, image-recovery, and lifecycle-card cleanup work in the live changelog.
- Verification:
  - Typecheck/build, deployment, and live changelog inspection.
- Notes:
  - Expanded v3.1.2 with Pump vanity-mint recovery and active image-backfill details.
  - Expanded v3.1.3 with the final clean graduated-card treatment and retained external provenance icon.
  - Verified all new text plus the v3.1.1 slider notes in the live changelog panel.

### P1: Simplify lifecycle presentation

#### T17. Remove redundant lifecycle chips
- Status: `done`
- Goal:
  - Remove Bonding, Graduated, and Verifying chips from token cards; retain the bonding progress bar as the only lifecycle treatment on cards.
- Verification:
  - Tests, typecheck/build, deployment, and live LAN card inspection.
- Notes:
  - Removed Bonding, Graduated, and Verifying badges from all token cards.
  - Verified v3.1.3 live with no lifecycle-chip text in the card DOM; bonding progress-bar logic remains intact.

### P0: Reliable token images

#### T16. Eliminate avoidable default token images
- Status: `done`
- Goal:
  - Make token images resolve reliably from stored metadata without depending on fragile third-party browser access.
- Verification:
  - Image-path tests, typecheck/build, VM metadata audit, and live LAN card/image checks.
- Notes:
  - Added a same-origin `/api/token-image/[mint]` path with IPFS gateway fallback and successful-response browser caching.
  - Removed pre-load URL caching, made cards rerender when image metadata arrives, and made the ingester resolve stored metadata URIs before calling Pump again.
  - Fixed startup recovery to include the active metadata backlog and stopped rejecting valid Pump vanity mints ending in `pump`.
  - Live verification returned WebP/JPEG/PNG bytes through the new endpoint, reduced missing stored images from 879 to 524 while new tokens continued arriving, reached zero missing images among tokens active in the last 30 minutes, and showed 12 proxied card images with zero defaults on the visible page.

### P0: Cross-browser settings controls

#### T15. Harden settings sliders
- Status: `done`
- Goal:
  - Make all settings sliders reliable with mouse, touch, pen, and keyboard input without filter-query churn or controlled-value snapback.
- Verification:
  - Unit tests for normalization, typecheck/build, and live keyboard plus pointer/touch-oriented browser checks.
- Notes:
  - Added normalized local slider state, commit-on-release settings updates, explicit pointer-release handling, and duplicate-commit suppression.
  - Enlarged every thumb and interaction area, added accessible labels, and removed hover scaling that could shift pointer geometry.
  - Verified v3.1.1 live with single-value and range track clicks, keyboard changes, parent-setting synchronization, and restoration to the original 12-token/$3K settings.

### P1: User-facing release notes

#### T14. Expand the v3.1.0 in-app changelog
- Status: `done`
- Goal:
  - Document the verified lifecycle, realtime delivery, performance, filtering, and status-presentation changes on the live changelog page.
- Verification:
  - Typecheck, production build, deployment, and live changelog-dialog inspection.
- Notes:
  - Expanded v3.1.0 with seven user-facing entries covering verified graduation, corrected filters, binary lifecycle labels, SQL query performance, SSE delivery, asynchronous metadata, bounded caches, and out-of-order price protection.

### P0: Align lifecycle presentation

#### T13. Restore binary Bonding/Graduated status labels
- Status: `done`
- Goal:
  - Present PumpSwap, curve-complete, and non-launchpad tokens as `Graduated`, while retaining the existing external provenance icon.
- Constraint:
  - Keep `Verifying` for unresolved tokens rather than guessing.
- Verification:
  - Unit/type/build checks and live LAN filter/card validation.
- Notes:
  - Cards now label verified `BONDING` tokens as `Bonding` and all verified non-bonding states as `Graduated`.
  - `UNKNOWN` remains `Verifying`; external provenance continues to use the existing icon.
  - The Graduated filter now includes curve-complete, PumpSwap, and non-launchpad tokens.

### P0: Reliable lifecycle and realtime token delivery

#### T12. Replace market-cap graduation inference and 500 ms polling
- Status: `done`
- Files:
  - `prisma/schema.prisma`
  - `server/ingest-trades.ts`
  - `app/api/tokens/`
  - `contexts/token-context.tsx`
  - `components/token-card.tsx`
- Goal:
  - Verify lifecycle from Pump frontend endpoints without RPC, move token aggregation into PostgreSQL, and deliver realtime updates through SSE.
- Constraints:
  - Pump websocket/NATS fields are hints only.
  - Unknown lifecycle must remain explicit rather than inferred from market cap.
  - Existing API compatibility fields remain during rollout.
- Verification:
  - `npm test`
  - `npm run typecheck`
  - `npm run build`
  - Live VM backfill, PM2 health, API latency, SSE reconnect, and LAN browser checks.
- Notes:
  - Added explicit `UNKNOWN`, `BONDING`, `CURVE_COMPLETE`, `PUMPSWAP`, and `NON_LAUNCHPAD` states verified from Pump frontend batch responses; NATS fields only enqueue checks.
  - Removed the `$60k` completion write and guarded price upserts against out-of-order trade timestamps.
  - Added durable lifecycle checks, a full backfill command, bounded caches, 24-hour raw-trade retention, SQL aggregation, shared SSE query groups, and snapshot fallback.
  - The initial VM backfill resolved 728 of 736 stored tokens with zero transition conflicts; 8 unsupported/non-Pump mints remained explicit `UNKNOWN`.
  - Compatibility audit reports zero rows where `completed` disagrees with verified lifecycle.
  - Live counterexamples validate the fix: CUP remained bonding near `$97.9k`, DrTrump remained bonding near `$758k`, and multiple sub-dollar tokens were correctly identified as PumpSwap.
  - Twenty live `/api/tokens` requests measured 9 ms p95 and 44 ms maximum; SSE produced both snapshot and patch events.
  - Browser validation showed v3.1.0 connected, lifecycle labels, bonding-only and graduated-only filtering, and no stale status rendering.
  - VM ingestion was about 1.5 seconds behind at final sampling, with both PM2 processes online and no ingest errors.
  - Database backup: `/home/hendo420/pumpInvestments/backups/pre-lifecycle-20260730-015803.dump`.
  - Verification passed: 8 tests, `npm run typecheck`, `npm run build`, Prisma migrations, LAN API, SSE, browser filters, and PM2 persistence.

### P0: Restore TypeScript Baseline

#### T1. Fix API type errors in chat and websocket routes
- Status: `done`
- Files:
  - `app/api/chat/route.ts`
  - `app/api/pump-ws/route.ts`
- Problem:
  - `app/api/chat/route.ts` uses an invalid `maxTokens` property for the current SDK types.
  - `app/api/pump-ws/route.ts` is typed against WebSocket APIs that do not match the active Next.js/TypeScript environment.
- Goal:
  - Make both routes compile cleanly under `tsc`.
- Suggested approach:
  - Update the AI SDK call in `app/api/chat/route.ts` to the current typed option name.
  - Decide whether `app/api/pump-ws/route.ts` should remain an Edge-runtime proxy or move to a Node-compatible implementation.
  - If it stays Edge-specific, add the correct route/runtime typing instead of relying on unsupported DOM assumptions.
- Verification:
  - `npx tsc --noEmit --project tsconfig.json`
- Notes:
  - `app/api/chat/route.ts` was updated to use `maxOutputTokens`, which matches the installed AI SDK type surface.
  - `app/api/pump-ws/route.ts` now uses local Edge-specific socket and response init types so `accept()` and `{ webSocket }` compile cleanly without changing route behavior.
  - Route-specific verification should show no remaining errors for these two files even though broader repo TypeScript failures still exist.

#### T2. Repair token query types and imports
- Status: `done`
- Files:
  - `app/api/tokens/route.ts`
  - `types/token-data.ts`
  - `lib/token-query.ts`
  - `contexts/token-context.tsx`
- Problem:
  - `app/api/tokens/route.ts` references `TokenQueryOptions`, `TokenQueryFilters`, and `TokenQueryRequest`, but the current shared type exports do not line up.
  - `contexts/token-context.tsx` imports `@/lib/token-query`, and that path/type relationship needs to be reconciled with the current project layout.
- Goal:
  - Re-establish one canonical token-query type surface shared by API and client code.
- Suggested approach:
  - Inspect `types/token-data.ts` and `lib/token-query.ts`.
  - Export a stable set of request/filter/result types from one place.
  - Update both API and context consumers to use the same imports.
- Verification:
  - `npx tsc --noEmit --project tsconfig.json`
- Notes:
  - `types/token-data.ts` is now the canonical in-app home for `TokenQueryFilters`, `TokenQueryOptions`, `TokenQueryRequest`, `TokenSortBy`, and `GraduatedFilterValue`.
  - `contexts/token-context.tsx` no longer imports from the nonexistent `@/lib/token-query`.
  - `app/api/tokens/route.ts` now imports and uses the shared token-query types directly, and favorite mint filtering is typed as `Set<string>`.

#### T3. Fix onboarding typing drift
- Status: `done`
- Files:
  - `components/onboarding/onboarding-guide.tsx`
- Problem:
  - The step objects include fields and placement values that do not match the declared type.
- Goal:
  - Make the onboarding step schema explicit and correct.
- Suggested approach:
  - Define a single typed interface for onboarding steps including optional `action`.
  - Narrow `placement` to the actual supported string union, or broaden the type intentionally if the runtime allows it.
- Verification:
  - `npx tsc --noEmit --project tsconfig.json`
- Notes:
  - `components/onboarding/onboarding-step.tsx` now exports the canonical onboarding step schema, including `OnboardingPlacement`, `OnboardingAction`, and `OnboardingGuideStep`.
  - `components/onboarding/onboarding-guide.tsx` now types its `steps` array explicitly and keeps `action` support optional for dormant changelog/roadmap flows.

#### T4. Fix missing UI module
- Status: `done`
- Files:
  - `components/alert-management.tsx`
  - `components/ui/`
- Problem:
  - `@/components/ui/tabs` is imported but the module does not exist.
- Goal:
  - Either add the missing Tabs component or remove/replace the dependency.
- Suggested approach:
  - Search for intended shadcn/Radix tabs usage and add the missing file if the feature depends on it.
- Verification:
  - `npx tsc --noEmit --project tsconfig.json`
- Notes:
  - Added `@radix-ui/react-tabs` and a standard shadcn-style `components/ui/tabs.tsx` wrapper.
  - `components/alert-management.tsx` can now keep its existing tabbed UI without refactor.

#### T5. Add `ws` TypeScript declarations
- Status: `done`
- Files:
  - `package.json`
  - `server/ingest-trades.ts`
- Problem:
  - `server/ingest-trades.ts` still reports missing types for the `ws` package.
- Goal:
  - Remove the `ws` declaration error cleanly.
- Suggested approach:
  - Prefer installing `@types/ws` if compatible with the current version.
  - Fallback: add a local declaration file only if needed.
- Verification:
  - `npx tsc --noEmit --project tsconfig.json`
- Notes:
  - Installed `@types/ws` as a dev dependency.
  - The `TS7016` declaration error for `server/ingest-trades.ts` was resolved without needing a local fallback declaration file or source edits.

### P1: Operational Consistency

#### T10. Provision LAN production VM
- Status: `done`
- Target:
  - `192.168.50.237` (`pumpinvestments-4`)
- Goal:
  - Run the web tracker and live trade ingester persistently on the new Ubuntu VM.
- Notes:
  - Installed Node.js 22, PostgreSQL 16, build tools, and PM2.
  - Cloned the app to `/home/hendo420/pumpInvestments/v0-pump-investments`.
  - Created the PostgreSQL database and app role, wrote a mode-600 production `.env`, pushed the Prisma schema, and built the production app.
  - Registered and started `pm2-hendo420.service`; `pump-investments-web` and `pump-investments-ingest` are online.
  - Verified the homepage and POST `/api/tokens` from another LAN machine; the ingester also populated PostgreSQL with live tokens and trades.
  - Pi Bot chat remains unconfigured because no `GROQ_API_KEY` was supplied.
  - `npm ci` reported 25 audit findings; dependency remediation is follow-up work and was not mixed into deployment.

#### T11. Monitor third-party metadata failures
- Status: `monitor`
- Problem:
  - Some token metadata URLs return upstream 403 or 404 responses.
- Notes:
  - Observed in `logs/web-error.log` during final LAN verification.
  - Homepage and POST `/api/tokens` still return 200, and live ingestion continues.
  - Existing metadata fallback and cooldown behavior remains active; investigate only if missing token artwork becomes materially disruptive.

#### T6. Make PM2 env reload behavior explicit
- Status: `done`
- Files:
  - `ecosystem.config.js`
  - deployment/runbook docs
- Problem:
  - PM2 restart warns that env changes are not reloaded without `--update-env`.
- Goal:
  - Prevent future confusion when `.env` changes are made.
- Suggested approach:
  - Document the correct PM2 restart command for env changes.
  - Optionally add a package script or deploy note for `pm2 restart <app> --update-env`.
- Verification:
  - Manual PM2 restart after an env change.
- Notes:
  - Added PM2 restart scripts to `package.json` for both normal restarts and env-refresh restarts.
  - Added a PM2 runbook section to `README.md` documenting the two app names and when `--update-env` is required.
  - Added a short reminder comment to `ecosystem.config.js` so the env reload behavior is visible near the PM2 app definitions.

#### T7. Confirm runtime log handling
- Status: `done`
- Files:
  - `.gitignore`
  - `logs/`
- Problem:
  - `logs/` was seen as untracked from outside the repo root during earlier checks, but repo-local `.gitignore` already includes `/logs`.
- Goal:
  - Confirm there is no lingering git-ignore mismatch.
- Suggested approach:
  - Re-check status from repo root when needed.
  - If nested logs exist outside the ignored path, update ignore rules intentionally.
- Verification:
  - `git status --short`
  - `git check-ignore -v logs logs/web-out.log logs/ingest-out.log`
- Notes:
  - Confirmed `v0-pump-investments/.gitignore` already ignores `/logs`.
  - Confirmed PM2 log files configured in `ecosystem.config.js` write into the repo-local `logs/` directory.
  - Confirmed `git status --short` is clean from the app repo root and `git check-ignore -v` reports `.gitignore:12:/logs` for the active PM2 log files.
  - No `.gitignore` change was needed; the earlier concern appears to have come from checking outside the repo root or before verification.

### P2: Cleanup and Hardening

#### T8. Re-enable meaningful type validation in regular workflow
- Status: `done`
- Files:
  - project scripts / CI config
- Problem:
  - The build passes while type errors still exist, which hides regressions.
- Goal:
  - Make type safety part of normal development again after T1-T5 are complete.
- Suggested approach:
  - Add a dedicated `typecheck` script.
  - Decide whether CI or release steps should enforce it.
- Verification:
  - `npm run typecheck`
- Notes:
  - Added `npm run typecheck` as the canonical explicit TypeScript validation command.
  - Fixed the remaining TypeScript errors in `components/dashboard.tsx` and `components/alert-settings-dialog.tsx`.
  - Removed `typescript.ignoreBuildErrors` from `next.config.mjs`, so `npm run build` now fails on TypeScript errors again.

#### T9. Fix metadata backlog staleness
- Status: `done`
- Files:
  - `server/ingest-trades.ts`
  - `lib/pump-coin.ts`
  - `app/api/tokens/route.ts`
- Problem:
  - Long-running freshness could degrade because metadata retries were low-throughput, permanent failures could get pinned, and API fallback hydration was doing too much work per request.
- Goal:
  - Keep active tokens eligible for metadata recovery over long uptime and reduce backlog pressure from both the ingester and API route.
- Verification:
  - `npm run typecheck`
  - `npm run build`
- Notes:
  - Replaced permanent pump-coin failure caching with expiring cooldowns and clear-on-settle inflight promise handling.
  - Reworked the ingester metadata queue to prioritize active tokens, keep retry state over time, and emit explicit metadata backlog health logs.
  - Limited `/api/tokens` metadata fallback hydration to returned page items with bounded concurrency instead of the full aggregated token list.

## Known Good Changes
- Ingester reconnect hardening is live and pushed.
- GitHub CLI auth is valid for account `fourtytwo42`.

## Recent Commands Worth Reusing
- `npm run build`
- `npx tsc --noEmit --project tsconfig.json`
- `pm2 restart pump-investments-ingest --update-env`
- `pm2 restart pump-investments-web --update-env`
