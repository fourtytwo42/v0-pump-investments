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

## Known Good Changes
- Ingester reconnect hardening is live and pushed.
- GitHub CLI auth is valid for account `fourtytwo42`.

## Recent Commands Worth Reusing
- `npm run build`
- `npx tsc --noEmit --project tsconfig.json`
- `pm2 restart pump-investments-ingest --update-env`
- `pm2 restart pump-investments-web --update-env`
