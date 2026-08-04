# Working Memory

This file stores durable project memory for recovery after context compression or chat loss.

## Recovery Procedure
1. Read `AGENTS.md`.
2. Read this file.
3. Read `FIX_TRACKER.md`.
4. Run `git status --short`, `git log --oneline --max-count=10`, and any targeted checks needed for the active item.

## Project Facts
- Repo path: `/home/hendo420/pumpInvestments/v0-pump-investments`
- Primary branch: `main`
- Git remote: `origin https://github.com/fourtytwo42/v0-pump-investments.git`
- Process manager: PM2
- LAN deployment:
  - VM: `192.168.50.237` (`pumpinvestments-4`, Ubuntu 24.04)
  - Web URL: `http://192.168.50.237:3000`
  - Runtime: Node.js 22
  - Database: PostgreSQL 16 on localhost
  - Boot service: `pm2-hendo420.service`
- Main PM2 app names:
  - `pump-investments-web`
  - `pump-investments-ingest`

## Current Operational State
- Version 4.0.12 is deployed from immutable `main` release `f194aa2c449abdd6195a59a857b0d57f6e40a9b2`. The privacy-preserving active-browser header count is live alongside the v4.0.11 support system.
- The previous lifecycle-correction v4.0.10 release was `f7266aced8cb92e2943ee784adb5f78fa84b324a`.
- `/home/hendo420/pumpInvestments/current` points to the immutable v4.0.11 release. Both PM2 services are online from that directory, exactly three releases are retained, and shared environment/spool/image/support/log state remains under `/var/lib/pump-investments`.
- V4.0.9 live query p95 was 60.2 ms LAN / 178.8 ms public for the common 10-minute snapshot and 286.0 ms LAN / 448.2 ms public for a 60-minute Unique Buyers query. All 20 requests in each sample returned 200.
- The final five-minute CSP report-only soak produced zero violations after narrowly allowing the existing Cloudflare Web Analytics origins. CSP is enforced, HSTS is `max-age=31536000`, and the rate-limit zones are versioned so the trusted-real-IP key can reload without conflicting with legacy shared memory.
- Final v4.0.9 health showed database/feed/SOL status `ok`, about 1.3 s persisted feed lag, connected ingestion, empty spool/dead-letter, a 27.5 MB image cache, and zero active `BONDING` tokens at 99% or higher. The protected health credential was rotated after deployment verification.
- The VM root LV/filesystem now uses the full 64 GB virtual disk: 61 GB usable, about 45 GB free after v4.0.8 maintenance.
- Token lifecycle is verified without RPC from Pump frontend batch responses. A live `pump_amm` trade with a concrete pool address is also definitive, monotonic PumpSwap evidence; incomplete venue hints alone never graduate a token.
- Nginx owns LAN port `3000` and proxies Next.js on `3001`; SSE buffering is disabled and successful token images are proxy-cached.
- The token client uses a fetch-based SSE stream with SQL-backed snapshots instead of 500 ms full polling.
- Prisma migrations are now baselined and deployed through `prisma migrate deploy`.
- The LAN deployment at `192.168.50.237:3000` was provisioned and verified on 2026-07-29.
- `pm2-hendo420.service` is enabled and active; both PM2 processes are online.
- The homepage and POST `/api/tokens` respond successfully over the LAN, and the ingester is writing live token/trade data.
- The production `.env` exists only on the VM with mode `600`; do not commit it.
- GitHub auth is working for `fourtytwo42` through `gh` and HTTPS Git.
- Production build succeeded after the ingester reconnect changes.
- PM2 web and ingest processes were restarted successfully after that build.
- The reconnect hardening commit was pushed to `main`.

## Important Recent Changes
- V4.0.13 candidate persists only aggregate audience history: the peak active-browser count for each completed UTC-aligned five-minute interval, plus the 75-second active-window definition. Browser IDs and IP addresses remain unpersisted, failed writes retry idempotently, and Playwright stubs the presence route so release automation does not inflate production history.
- V4.0.12 candidate adds a privacy-preserving active-browser count beside the header connection indicator. A host-only HttpOnly browser ID deduplicates tabs; visible clients heartbeat every 25 seconds and expire after 75 seconds. Presence stays process-local and bounded at 100,000 entries, avoiding database write churn and collecting no IP or user data.
- The v4.0.12 lockfile also advances patched transitive `brace-expansion` and `fast-uri` releases after new high-severity advisories appeared; `npm audit --omit=dev` returns zero findings.
- V4.0.11 adds anonymous in-app problem reports under Settings. Browser-scoped support sessions can create, revisit, reply to, reopen, and permanently delete tickets with safe frontend/backend diagnostics and authenticated screenshot attachments.
- Support administration is available only on the VM-local Next port through bearer-protected `/api/admin/support/tickets` routes; Nginx returns 404 externally. Admin mutations require the current ticket revision to prevent overwriting concurrent user replies.
- Support attachments live under `/var/lib/pump-investments/support-attachments`, are re-encoded to metadata-free WebP, and are bounded by per-message/ticket quotas plus daily orphan cleanup. `SUPPORT_ADMIN_TOKEN` and `SUPPORT_NETWORK_HASH_KEY` are generated into the shared mode-600 VM environment during release.
- Cloudflare Turnstile widget `Pump.Investments Support` is restricted to `pump.investments`. Its site and secret keys are stored only in `/var/lib/pump-investments/app.env`; never commit or print them. Because the site key is a `NEXT_PUBLIC_` build variable, enabling or rotating it requires a fresh immutable web build.
- V4.0.10 narrows legacy migration detection to definitive `raydium_pool`, `pump_swap_pool`, and concrete trade evidence. A generic Pump `pool_address` is compatible with an incomplete bonding curve. A narrowly scoped repair allows only `CURVE_COMPLETE + PUMP_BONDING + no PumpSwap pool` records to return to Bonding after Pump explicitly verifies them incomplete; the repair is prioritized at startup and every active reconciliation.
- V4.0.9 coalesces public token revisions to one publication per second while dirty-mint rows retain every change kind. Snapshot reads now use one repeatable-read transaction and a bounded 100-entry, one-second single-flight cache keyed by normalized query plus observed revision.
- Default Unique Buyers queries use buyer-minute aggregates plus the exact partial minute. Configured individual-buy thresholds continue to scan raw buy trades through the partial covering index `trades_recent_buy_filter_idx`.
- Token and alert SSE work is shared per normalized query/mint set. The web process polls the public revision at most once per second, and failed token-group refreshes remain retryable at the same revision.
- The filesystem image cache now maintains one process index, verifies at most every ten minutes, begins eviction at 480 MiB, evicts to 450 MiB, and removes expired negative, orphan metadata, and temporary files.
- Protected health details now include query/cache latency, token and alert stream groups, lifecycle due/cooling age, active metadata gaps, database/table/disk metrics, image utilization, and the ingester runtime state persisted every five seconds.
- V4.0.9 deployment is manually invoked with `npm run deploy:vm`. It builds immutable commit directories under `/home/hendo420/pumpInvestments/releases`, keeps environment/spool/images/logs in `/var/lib/pump-investments`, validates a port-3002 candidate, atomically switches `current`, rolls back the symlink/PM2 on failure, and retains three releases. It creates no database backup and uses no GitHub Actions.
- Immutable cutover must recreate the two PM2 processes; `startOrReload` retains the previous working directory even when the ecosystem file points at a new release. The release script deletes/restarts only the two named services and uses the same path-safe behavior for rollback.
- Nginx rate limits use only the real-IP module's trusted result, overwrites forwarded client headers, limits token snapshots to five requests/second/client, adds one-year HSTS, and stages CSP report-only before enforcement.
- V4.0.8 retains raw trades and minute aggregates for two hours, safely covering the one-hour product window. Realtime dirty-mint state is retained 15 minutes; the append-only revision journal is no longer written.
- V4.0.8 restored reserve-derived card progress. Market cap never determines either progress or lifecycle. Pump `pump_swap_pool`, `raydium_pool`, and `pool_address` fields plus concrete live migration trades are authoritative completion evidence.
- Pump legacy migrations can report `complete=false` after supplying a concrete Raydium pool. The verifier now promotes these to `CURVE_COMPLETE`; Autonome and GOBI were corrected, and production has zero active `BONDING` records at 99% or higher.
- Lifecycle reconciliation is limited to tokens active within two hours. Failed checks cool down for six hours after ten attempts and periodic enqueue no longer defeats backoff. The deployment reduced the queue from about 67,000 overdue checks to a bounded active set.
- Production database maintenance reduced PostgreSQL from about 11 GB to 553 MB by removing data outside the two-hour retention window and compacting affected tables. Pre-maintenance backup: `/home/hendo420/backups/pre-v4.0.8.dump`, SHA-256 `858aca6d4825b0acadfe9972e6ad421bc96b755f207d571c0e4a3f2b1cb8b22f`.
- Active Nginx config is `/etc/nginx/conf.d/pump-investments.conf` (not `sites-available`). Cloudflare/LAN rate and connection limits use `CF-Connecting-IP` with remote-address fallback; public verification logged the actual client address instead of `127.0.0.1`.
- V4.0.7 fixes a zombie NATS subscription failure where PING/PONG traffic continued after real trade events stopped. `server/ingest-trades.ts` now tracks decoded trades separately from protocol messages, reconnects after 60 seconds without a trade, and exits for PM2 recovery after five minutes without any real trade across reconnects.
- Public `/api/health` now reports `dependencies.trade_feed` from the newest persisted trade. Production verification returned version 4.0.7/status ok, current SOL/trade timestamps, live SSE patches, and ingester telemetry with `since_last_trade_s=0`.
- V4.0.6 briefly aligned the visible bar to market cap; v4.0.8 supersedes that behavior because different curve types made market-cap percentages misleading and caused false 99% cards.
- V4.0.5 refines token cards without changing their data or bright border semantics: compact Last Trade values, tabular metrics, stronger secondary contrast, 80 px muted artwork surfaces, 24 px social targets, and a reduced-motion-safe 2 px hover lift.
- Cards remain 342 px tall. Tighter metric row spacing keeps bonding footers fully contained with 15 px Token Age clearance; the four-column XL grid and green/red `border-2` thresholds are unchanged.
- The header version badge now uses the latest changelog entry. Cross-browser verification passed all 15 Chromium, Firefox, and WebKit tests with light/dark screenshot attachments.
- Bonding percentage labels use an enlarged 16 px bar with bold 11 px white tabular text on a 75% dark backing, preserving legibility over both filled and unfilled sections in light and dark themes.
- V4.0.4 introduced persisted reserve-derived `Token.bondingProgress`; v4.0.6 retains it as diagnostic lifecycle evidence rather than the user-visible percentage.
- The atomic ingester immediately promotes concrete `pump_amm` pool trades to `PUMPSWAP`, sets completion/progress fields, and removes stale lifecycle checks. Queue deletion is idempotent because the verifier and trade transaction can race safely.
- The 2026-07-31 production audit found two stale `BONDING + PUMPSWAP` records, Vludhood and Maybe. Both now return `pumpswap`, `is_completed=true`, and `bonding_progress=100`; the production mismatch count is zero.
- High market cap is not graduation proof. Pump still reported several high-cap tokens as incomplete; after a priority refresh, all high-cap bonding records had reserve-derived progress and none remained null.
- V4 atomic ingestion writes tokens, trades, newest prices, rolling aggregates, dirty mints, and revisions transactionally. Every incoming batch is atomically spooled before database work and removed only after commit.
- V4 cutover proved the spool recovery path: 108 batches survived a bad INSERT, replayed after correction, and drained with zero dead-letter files and no confirmed trade loss.
- Rolling token-minute and token/buyer-minute aggregates are live. Backfill shadow comparison matched retained raw-trade totals.
- Launch source and trade venue are separate fields. Pump, PumpSwap, Moonshot/Meteora DBC, Raydium v4, external, and unknown are retained without guessing.
- SOL/USD is acquired centrally by the ingester, persisted, and distributed through snapshots/SSE. The browser no longer calls CoinGecko.
- Token images use the same-origin proxy, SSRF/redirect/content limits, shared filesystem cache, Nginx cache, negative caching, and 512 MB LRU cleanup.
- Alerts use `/api/alerts/stream` independently of the visible page and Web Audio patterns instead of probing sound files.
- Cards subscribe to normalized Zustand state; Pause defers order only and automatically resumes on query changes.
- Settings, onboarding, PI Bot, and alert settings load on demand. Returning-user initial JavaScript is 252.2 kB versus the prior 267 kB baseline.
- KOTH UI/query/asset surfaces are removed. The compatibility field remains and always returns `null`.
- Dependencies are pinned to the V4 release set; `npm audit --omit=dev` reports zero findings.
- Nginx and the app enforce request, page, favorite, query-group, body, and stream-connection bounds with 400/413/429/503 semantics.
- Public `/api/health` and bearer-protected `/api/health/details` are live. Confirmed persisted-write lag uses database `created_at - event timestamp`; source idle time is reported separately.
- V4 verification passed ESLint, TypeScript, 22 unit tests, Prisma migration validation, production build, 12 Chromium/Firefox/WebKit tests, SSE/alert/image/API checks, and a live 03:41-04:41 UTC release exercise.
- V4 preflight backup: `/home/hendo420/backups/pumpinvestments-pre-v4-20260730-034106.dump`, SHA-256 `4d9b8b1076e032d40f1cca439ed254492a9d0b0373ed0cc07b8b9b1fccc37a72`.
- Pump subscriber credentials now exist only in the VM mode-600 environment. Actual upstream rotation requires Pump to issue a replacement credential.
- The in-app v3.1.0 changelog now documents the lifecycle, filtering, SQL/SSE, metadata, cache, and price-ordering changes.
- Token cards intentionally show no Bonding, Graduated, or Verifying chip. Verified bonding tokens use the progress bar; graduated and unknown tokens have no lifecycle label, and the existing provenance icon still distinguishes external tokens.
- T12 in `FIX_TRACKER.md` is implemented and live:
  - lifecycle states are `UNKNOWN`, `BONDING`, `CURVE_COMPLETE`, `PUMPSWAP`, and `NON_LAUNCHPAD`
  - `$60k` market-cap graduation inference was removed
  - `POST /coins-v2/mints` is the primary verifier with a durable coalescing retry queue
  - `/api/tokens` aggregates in PostgreSQL and performs no external metadata hydration
  - `/api/tokens/stream` shares query recomputations and emits snapshot/patch SSE events
  - client-side automatic metadata hydration was removed; ingestion owns asynchronous enrichment
  - raw trade retention is configured for 24 hours
- Initial lifecycle backfill on 2026-07-29 resolved 728/736 stored tokens with 8 unsupported/non-Pump mints left `UNKNOWN`; live reconciliation continues for new and unresolved tokens.
- Live validation measured `/api/tokens` at 9 ms p95 over 20 samples, observed about 1.5 seconds trade lag, and found zero `completed` compatibility mismatches.
- Pre-migration database backup: `/home/hendo420/pumpInvestments/backups/pre-lifecycle-20260730-015803.dump`.
- T9 in `FIX_TRACKER.md` is now implemented:
  - `lib/pump-coin.ts` now clears settled inflight requests and uses expiring cooldowns instead of permanent failure pinning
  - `server/ingest-trades.ts` now prioritizes active metadata backlog items, keeps retry state over time, and logs metadata queue/freshness health
  - `app/api/tokens/route.ts` now hydrates metadata only for paginated response items with bounded concurrency instead of the whole aggregated token set
- T8 in `FIX_TRACKER.md` is now implemented:
  - `package.json` now includes `npm run typecheck` for explicit TypeScript validation
  - `components/dashboard.tsx` and `components/alert-settings-dialog.tsx` were fixed so the repo reaches a clean TypeScript baseline
  - `next.config.mjs` no longer bypasses TypeScript build errors, so `npm run build` fails on TS errors again
- T7 in `FIX_TRACKER.md` is now implemented:
  - PM2 runtime logs live in the repo-local `logs/` directory configured by `ecosystem.config.js`
  - `.gitignore` already ignores `/logs`, and `git check-ignore -v` confirms the active PM2 log files are covered
  - no log-ignore change was needed; the earlier concern was a verification issue, not a real mismatch
- T6 in `FIX_TRACKER.md` is now implemented:
  - `package.json` now includes PM2 restart scripts for normal restarts and `--update-env` restarts
  - `README.md` now includes a PM2 runbook section documenting the app names and env refresh workflow
  - `ecosystem.config.js` now includes a reminder comment that plain PM2 restarts do not reload env changes
- T5 in `FIX_TRACKER.md` is now implemented:
  - `@types/ws` was added as a dev dependency
  - the ingester `ws` declaration error was resolved without a custom `declare module "ws"` fallback
- T4 in `FIX_TRACKER.md` is now implemented:
  - `components/ui/tabs.tsx` now exists as the app-local tabs primitive
  - `@radix-ui/react-tabs` was added to support the alert-management tabs UI
- T3 in `FIX_TRACKER.md` is now implemented:
  - onboarding step typing is centralized in `components/onboarding/onboarding-step.tsx`
  - `action` support remains optional and typed, even though current steps do not actively use it
- T2 in `FIX_TRACKER.md` is now implemented:
  - `types/token-data.ts` is the canonical in-app source for token-query types
  - `contexts/token-context.tsx` now imports `TokenQueryOptions` from `@/types/token-data`
  - `app/api/tokens/route.ts` now uses shared token-query types and a typed `Set<string>` for favorites
- T1 in `FIX_TRACKER.md` is now implemented:
  - `app/api/chat/route.ts` uses `maxOutputTokens` instead of `maxTokens`
  - `app/api/pump-ws/route.ts` uses local Edge socket typings for `accept()` and `ResponseInit & { webSocket }`
- Ingester reconnect logic now includes:
  - connection state tracking
  - reconnect backoff with jitter
  - connect timeout handling
  - heartbeat / stale-socket recycling
  - structured connection health logs
  - shutdown-safe teardown
- New ingester env knobs were documented in `.env.example`:
  - `INGEST_RECONNECT_MIN_MS`
  - `INGEST_RECONNECT_MAX_MS`
  - `INGEST_CONNECT_TIMEOUT_MS`
  - `INGEST_PING_INTERVAL_MS`
  - `INGEST_STALE_AFTER_MS`
  - `INGEST_BACKOFF_RESET_AFTER_MS`
  - `INGEST_METADATA_BATCH_SIZE_NORMAL`
  - `INGEST_METADATA_BATCH_SIZE_ELEVATED`
  - `INGEST_METADATA_ACTIVE_WINDOW_MS`
  - `INGEST_METADATA_NOT_FOUND_COOLDOWN_MS`
  - `INGEST_METADATA_TRANSIENT_COOLDOWN_MS`
  - `INGEST_METADATA_OVERLOAD_QUEUE_THRESHOLD`

## Known Problems
- The first v4.0.12 release attempt found an orphaned v4.0.11 candidate server on port 3002. Production was not cut over. Candidate launches now invoke Next directly with an exact tracked PID, reject occupied port 3002, verify the exact health version before Playwright, and require the port to be empty after cleanup.
- Active lifecycle reconciliation can exceed its 75-second target under the complete trade feed. A 2026-08-01 audit found about 3,000 queued checks, 2,698 due, and a 151-second oldest-overdue age; the 50-token/2.2-second worker has less throughput than the one-minute active re-enqueue rate. Classification remains evidence-based and self-correcting, but API-only graduation may display as Bonding for two to three minutes until T34 is addressed.
- PM2 env changes require `--update-env` on restart if `.env` has changed.
- PI Bot shares the GPU45 appliance with other clients. A Qwen-to-Ornith model swap can take about a minute, so `/api/chat` sends non-buffered JSON whitespace heartbeats while it waits.
- Some third-party token metadata URLs return 403 or 404; the API continues serving token data and uses its existing fallback/cooldown behavior.
- Next 16 emits a non-fatal output-file-tracing warning for the filesystem-backed token-image route during build; compilation, type validation, and runtime image tests pass.
- Pump's lifecycle batch API can lag confirmed PumpSwap activity. On 2026-07-30 it still returned `complete=false` for Dr. MAGA after 120 stored `pump_amm` trades; the production token was manually promoted from that pool evidence and protected by the monotonic `PUMPSWAP` state.

## 2026-07-31 Complete Pump trade feed
- The unsuffixed NATS subject `unifiedTradeEvent.processed` is a sampled market ticker, not the complete feed; it produced only about 52–56 events per minute across the market.
- Pump publishes complete processed events on per-mint subjects. Subscribe to `unifiedTradeEvent.processed.*`; do not add a paid Solana RPC node to solve this feed problem.
- Release v4.0.3 adds `PUMP_NATS_SUBJECT` and deploys the complete per-mint wildcard.
- The first complete production minute after cutover persisted 6,952 trades across 460 tokens and 2,940 unique buyers. Complete-minute aggregates matched retained trades, spool queues stayed empty, public snapshot p95 was 120.9 ms, and write lag measured 1.351 seconds p50 / 2.001 seconds p95.

## 2026-07-30 Dr. MAGA lifecycle correction
- Dr. MAGA mint: `ADzmJCZfwf5vFQ6y9EysRS7xWqFgRc33QAAnj7Mipump`.
- Confirmed PumpSwap pool: `5xdVJp6rSZ3TnfcY2SCmefy74TdwhSGewkxJ3yGqkqE6`.
- Production now stores `PUMPSWAP`, `completed=true`, the pool address, and a lifecycle revision; the public API returns non-bonding/completed.

## 2026-07-29 No-visual-change whole-app audit
- The prioritized report is `APP_IMPROVEMENT_AUDIT.md`; no product behavior or visuals were changed during the audit.
- Live snapshot baseline was 7.2 ms p50, 10.3 ms p95, and 11.5 ms max over 25 VM-local samples; newest persisted trade lag was 1.823 seconds.
- P0 persistence risk: price/trade insert connection errors can be swallowed inside `persistTradesBulk`, after which revision and in-memory persisted timestamps still advance. Make the batch atomic, retry the original data, and derive health from confirmed writes.
- Unchanged lifecycle verifications currently rewrite token rows and dirty the global token revision, causing unnecessary SQL/SSE churn.
- `lib/token-stream.ts` has a process-global revision race when a new query group overwrites `lastObservedRevision`; use per-group applied revisions and an atomic snapshot/revision handshake.
- Alerts only check tokens in the current result page and require the browser to remain open; the sound service eagerly probes missing and malformed sound URLs.
- `npm audit --omit=dev` reported 17 production-tree findings: 1 critical, 11 high, 1 moderate, and 4 low. Next.js 14.1.0 and `ws` 8.18.3 require staged patching.
- `npm run lint` is not a release gate because it opens the interactive first-time ESLint setup; the production build reports that linting is skipped.
- Browser bundle baseline is about 267 kB first-load JS. Closed panels are eagerly included, all cards consume the broad token context, and two Toasters are mounted.
- The Settings trade-amount description says individual trades, while SQL applies thresholds to each buyer's cumulative window total.
- The API silently expands empty short time ranges to 30 minutes while the client continues displaying the requested range.

## 2026-07-29 Settings slider hardening
- Release v3.1.1 makes all Settings sliders keep local preview state while dragging and commit filter changes only when the interaction ends.
- Slider values are clamped and snapped centrally before rendering or committing, preventing stale or invalid persisted values from producing unstable thumb positions.
- Radix track clicks do not reliably emit `onValueCommit` in every browser path, so both slider wrappers explicitly commit on pointer release and suppress duplicate commits.
- Slider thumbs are 28px with an expanded 44px interaction target and explicit screen-reader labels.
- Live verification covered keyboard changes, single-slider and range-slider track clicks, displayed-summary synchronization, and restoration of the original 12-token/$3K settings.

## 2026-07-29 Token image reliability
- Release v3.1.2 routes card images through same-origin `/api/token-image/[mint]`; IPFS images are fetched with gateway fallback and successful responses are browser-cacheable.
- Token cards no longer cache URLs before a successful load and now rerender when `image_uri` or `metadata_uri` changes.
- Metadata recovery must use a token's stored metadata URI before making another Pump coin request.
- Pump vanity mints ending in `pump` are valid Solana addresses and must never be filtered from ingestion or recovery queues.
- Startup recovery uses `INGEST_METADATA_ACTIVE_WINDOW_MS`, not the process start timestamp, so active pre-existing tokens are seeded.
- Live v3.1.2 verification reached zero missing stored images among tokens active in the previous 30 minutes; the visible 12-card page used 12 same-origin image endpoints and no default images.

## 2026-07-29 Lifecycle chip removal
- Release v3.1.3 removes all lifecycle chips from token cards.
- The bonding progress bar remains the only card-level lifecycle treatment; graduated and unknown tokens show no replacement chip.
- The live changelog now fully records v3.1.1 slider hardening, v3.1.2 image proxy/backfill and Pump mint recovery, and v3.1.3 lifecycle-chip removal.

## 2026-07-29 KOTH deprecation audit
- The `koth.png` asset is healthy, but production has zero tokens with `king_of_the_hill_timestamp`.
- Current Pump v3 `/coins-v3/{mint}` and `/coins-v2/mints` responses contain no keys matching KOTH, king, or hill; official Pump program docs do not define KOTH as a lifecycle stage.
- Treat the KOTH card icon, Hide KOTH filter, and KOTH onboarding/help text as obsolete UI pending removal; do not infer KOTH from market cap.
- The external-token icon remains functional and is driven by verified `NON_LAUNCHPAD` lifecycle state; production had 40 external tokens, 31 active within one hour during the audit.

## 2026-07-29 Launch source and trade venue audit
- The unified feed's `program` identifies the trade execution venue, not necessarily the token's original launchpad; do not present it as launch source without corroboration.
- Two live samples totaling 106 events observed `pump` (Pump bonding curve), `pump_amm` (PumpSwap), `raydium_v4_amm` (Raydium v4), and `meteora_dbc` with `platform=moonshot`.
- `platform=moonshot` is an explicit launch-source signal for those Meteora DBC events. Raydium v4 only identifies the current venue and does not prove where the token launched.
- `PreparedTrade.program` and incoming `platform` are not persisted. Current API/card data can reliably identify Pump vs `NON_LAUNCHPAD`, lifecycle stage, and PumpSwap pool, but cannot name every external launch market.
- Model future attribution as separate `launchSource` and `tradeVenue` fields, retaining unknown rather than inferring a launchpad from an AMM venue.

## 2026-07-30 Cloudflare Tunnel setup
- The production VM is Ubuntu 24.04 x86-64; use Cloudflare's Linux APT package, not the Windows MSI.
- `cloudflared` 2026.7.3 is installed from Cloudflare's official APT repository and runs as an enabled systemd service.
- Cloudflare tunnel `Pump.Investments-4` (`7deb01c2-df95-40ea-a9b2-9ca49a80c9ed`) is Healthy with one connected Linux amd64 connector.
- Publish exactly one unrestricted HTTP route: `pump.investments` to `http://127.0.0.1:3000`.
- Nginx on 3000 is the only tunnel origin. Next.js on 3001, PostgreSQL on 5432, SSH, and the obsolete port 4000 must not be published.
- Browser realtime uses same-origin fetch-based SSE at `POST /api/tokens/stream` and `POST /api/alerts/stream`; there is no separate public WebSocket server.
- The ingester's WebSocket/NATS connection is outbound to the upstream trade feed and needs no Cloudflare route.
- Both SSE routes were verified through Nginx with 200 `text/event-stream`, cache disabled, and proxy buffering disabled before tunnel activation.
- Activation command: `sudo cloudflared service install <TUNNEL_TOKEN>`. Never store the token in the repo or `.env`.
- Public `https://pump.investments/` and `/api/health` returned HTTP 200 through Cloudflare after route activation; the browser loaded the expected application.
- Release v4.0.1 records the public Cloudflare Tunnel launch in the in-app changelog.
- PR #4 was merged into `main` as `a0b9445` and deployed on 2026-07-30. TypeScript, all 22 unit tests, and the production build passed on the VM; public `/` and `/api/health` returned 200 with version `4.0.1`.
- Keep the VM-only `APP_VERSION` value aligned with each release and restart `pump-investments-web` with `--update-env`; otherwise `/api/health` can report the prior version after a successful build.
- Full setup and verification steps are in `deploy/cloudflare/README.md`.

## 2026-07-30 Appliance-backed PI Bot
- Release v4.0.2 routes PI Bot server-side to `http://192.168.50.189:30001` using `ornith-1.0-35b-Q5_K_M-688b8d0a`; browsers only call same-origin `/api/chat`.
- `PI_BOT_MAX_CONTEXT_TOKENS` is hard-capped at 100,000. The route accepts at most 512 KB and rejects estimated context above the configured ceiling.
- Nginx disables buffering for `/api/chat`, permits 512 KB bodies, and keeps upstream reads open for five minutes. The Next.js route emits whitespace heartbeats every 15 seconds until its 180-second appliance timeout.
- Ornith is the appliance catalog default. Requests also name the exact model so other appliance clients can use their own models without changing PI Bot behavior.
- PI Bot requests disable model reasoning where supported and remove any remaining `<think>` block before returning browser-visible text.
- The unused Groq and Vercel AI SDK dependencies were removed; no `GROQ_API_KEY` is required.
- Production verification on 2026-07-30: VM smoke returned exactly `PI BOT READY` in 58 seconds; public `https://pump.investments/api/chat` returned HTTP 200 with `PUBLIC PI BOT READY` in 50.379 seconds.

## Commands / Checks
- VM app path:
  - `cd /home/hendo420/pumpInvestments/v0-pump-investments`
- Service status:
  - `systemctl status pm2-hendo420`
  - `pm2 status`
- Build:
  - `npm run build`
- Full typecheck:
  - `npm run typecheck`
  - `npx tsc --noEmit --project tsconfig.json`
- Lifecycle:
  - `npm run backfill:lifecycle`
  - `npx prisma migrate deploy`
  - `npm test`
- PM2 normal restart:
  - `npm run pm2:web:restart`
  - `npm run pm2:ingest:restart`
- Restart with env reload:
  - `npm run pm2:web:restart-env`
  - `npm run pm2:ingest:restart-env`
  - `npm run pm2:restart-env`
  - `pm2 restart pump-investments-ingest --update-env`
  - `pm2 restart pump-investments-web --update-env`

## Documentation Rules
- Update this file whenever a new durable fact, decision, operational gotcha, or unresolved blocker appears.
- Keep entries concise and factual.
