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
- Main PM2 app names:
  - `pump-investments-web`
  - `pump-investments-ingest`

## Current Operational State
- GitHub auth is working for `fourtytwo42` through `gh` and HTTPS Git.
- Production build succeeded after the ingester reconnect changes.
- PM2 web and ingest processes were restarted successfully after that build.
- The reconnect hardening commit was pushed to `main`.

## Important Recent Changes
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

## Known Problems
- PM2 env changes require `--update-env` on restart if `.env` has changed.

## Commands / Checks
- Build:
  - `npm run build`
- Full typecheck:
  - `npm run typecheck`
  - `npx tsc --noEmit --project tsconfig.json`
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
