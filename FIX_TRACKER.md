# Fix Tracker

This file is the durable work queue for repo maintenance and recovery. If chat context is lost, start here.

## How To Use
- Read `memory.md` first for current facts, decisions, and recent changes.
- Read this tracker second for prioritized work and open issues.
- Update the status, notes, and next action after every meaningful change.
- When closing an item, add a short note about what changed and how it was verified.

## Current State
- Production build currently succeeds with `npm run build`.
- Full TypeScript validation does not pass with `npx tsc --noEmit --project tsconfig.json`.
- GitHub auth on this machine is fixed.
- The ingester reconnect hardening was implemented, built, restarted under PM2, and pushed to `main`.

## Priorities

### P0: Restore TypeScript Baseline

#### T1. Fix API type errors in chat and websocket routes
- Status: `open`
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

#### T2. Repair token query types and imports
- Status: `open`
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

#### T3. Fix onboarding typing drift
- Status: `open`
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

#### T4. Fix missing UI module
- Status: `open`
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

#### T5. Add `ws` TypeScript declarations
- Status: `open`
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

### P1: Operational Consistency

#### T6. Make PM2 env reload behavior explicit
- Status: `open`
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

#### T7. Confirm runtime log handling
- Status: `monitor`
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

### P2: Cleanup and Hardening

#### T8. Re-enable meaningful type validation in regular workflow
- Status: `open`
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

## Known Good Changes
- Ingester reconnect hardening is live and pushed.
- GitHub CLI auth is valid for account `fourtytwo42`.

## Recent Commands Worth Reusing
- `npm run build`
- `npx tsc --noEmit --project tsconfig.json`
- `pm2 restart pump-investments-ingest --update-env`
- `pm2 restart pump-investments-web --update-env`
