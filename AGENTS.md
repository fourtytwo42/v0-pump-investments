# AGENTS.md

This repository uses `memory.md` and `FIX_TRACKER.md` as the durable handoff surface. Treat them as part of the working system, not optional notes.

## Required Startup Routine
When starting work in this repo:
1. Read `memory.md`.
2. Read `FIX_TRACKER.md`.
3. Check the active repo state with `git status --short`.
4. If continuing an existing task, update the tracker item you are touching before moving on.

## Required Update Rules
After any meaningful work, the agent must update:
- `memory.md`
  - Add any durable fact worth preserving across context loss.
  - Add any decision, caveat, environment quirk, operational command, or blocker that should be remembered later.
- `FIX_TRACKER.md`
  - Update status for the active task.
  - Add verification notes, follow-up work, or newly discovered issues.

Do not finish a task that changed repo understanding without updating `memory.md`.

## Documentation Standards
- Keep entries short, specific, and operationally useful.
- Prefer facts over narrative.
- Include file paths, commands, and branch/process names when relevant.
- If a problem is only partially fixed, record what remains.

## Tracker Conventions
- Status values should stay simple: `open`, `in_progress`, `blocked`, `monitor`, `done`.
- If a fix reveals more work, add a new tracker item instead of burying it in chat-only context.
- If verification was not run, say so directly in the tracker or memory.

## Recovery Goal
Someone with no prior chat context should be able to:
1. read `memory.md`,
2. read `FIX_TRACKER.md`,
3. inspect the repo,
4. continue the work without needing the previous conversation.
