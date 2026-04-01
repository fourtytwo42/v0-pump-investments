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
- Full TypeScript validation is still broken across several API and UI files.
- `ws` types are missing for TypeScript.
- PM2 env changes require `--update-env` on restart if `.env` has changed.

## Commands / Checks
- Build:
  - `npm run build`
- Full typecheck:
  - `npx tsc --noEmit --project tsconfig.json`
- Restart with env reload:
  - `pm2 restart pump-investments-ingest --update-env`
  - `pm2 restart pump-investments-web --update-env`

## Documentation Rules
- Update this file whenever a new durable fact, decision, operational gotcha, or unresolved blocker appears.
- Keep entries concise and factual.
