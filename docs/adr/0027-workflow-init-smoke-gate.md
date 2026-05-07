# ADR 0027: Non-skippable smoke gate at workflow init

**Status:** Accepted
**Date:** 2026-05-07
**Milestone:** M11 — Dependency-aware Scheduling (M11.17)

## Context

By M10 the orchestrator was dispatching workflows on a per-project tick loop (ADR 0021). A tick
that started with a missing prerequisite — expired `gh auth`, broken git checkout, missing
`ANTHROPIC_API_KEY`, an empty SQLite DB, a project at its budget floor — would launch an agent that
immediately failed in a creative, expensive, hard-to-diagnose way. The visible symptoms (a workflow
that ran for two minutes and produced a half-formed PR comment about why it couldn't authenticate)
were always after-the-fact.

Steve's training corpus calls this a smoke gate: a bounded, opinionated pre-flight check that runs
before any agent dispatch, fails closed, and is *non-skippable* — the agent cannot suppress it,
the project config cannot disable it, and a failed gate halts dispatch for that project's tick
without affecting other projects.

We needed this gate to be:
- Cheap (sub-second) so it runs on every tick.
- Cached (TTL'd) so a healthy project pays the cost rarely.
- Project-scoped so a failure in `goose-hub-self` does not block `nannymudnz`.
- Auditable so a halted dispatch records *which* check failed.
- Impossible to skip from the agent side.

## Decision

Add `core/orchestrator/smoke.ts` exposing `runSmokeChecks({ projectConfig, ... })` that runs six
checks in fixed order, short-circuiting on the first failure:

1. **`gh-auth`** — `gh auth status` exits 0.
2. **`git-fsck`** — `git fsck --no-progress` on the project's local checkout exits 0.
3. **`claude-version`** — `claude --version` exits 0 (CLI is on PATH).
4. **`sqlite-ping`** — a no-op `SELECT 1` against `core/db/db.ts` succeeds.
5. **`api-key`** — `process.env.ANTHROPIC_API_KEY` is non-empty.
6. **`budget-floor`** — the project's remaining daily budget is at least
   `BUDGET_FLOOR_DEFAULT_USD` (0.5 USD). Below this, no workflow can complete a single agent call,
   so dispatch is halted.

On success, the result is cached per project for `CACHE_TTL_MS` (60 s). On failure, the result
contains `{ ok: false, failedCheck, reason }` and is *not* cached — failures are re-checked next
tick so a transient failure (e.g. brief gh outage) self-heals on the next tick rather than
silently killing dispatch for a minute.

All output captured from shell commands is redacted (token patterns) and capped at 4 kB
(`STDERR_CAP`) per FACTORY_RULES rule 31. The redactor strips `ghp_*` and `Bearer *` patterns
before any event is emitted.

The dispatcher in `apps/server/src/shared/dispatch.ts` calls `runSmokeChecks()` *before*
`parallelLock.tryAcquire()`. A failed gate emits `smoke.failed` with the failing check name and
returns immediately — no lock is taken, no agent is launched.

### Why these six checks and not more

Each check exists because there is a recorded failure mode in development that produced wasted
spend. We resisted the urge to add "future-proofing" checks (DNS, disk space, port availability)
because every check that does not catch a real failure adds tick latency. The set is closed-ended;
new checks land via this ADR's amendment.

### Why the gate is non-skippable

A skippable smoke gate would be skipped under deadline pressure. The agent has no flag to bypass
the gate; the project config has no `disableSmokeGate` key. The only way to "skip" the gate is to
fix the underlying failure or, for a known-bad transient, wait one tick.

### Why per-project caching, not global

Two registered projects can share the same gh-auth and the same Claude CLI but have independent
budget floors and SQLite paths. A global cache would hide a per-project budget exhaustion. The
cache is keyed by project slug; budget-floor and sqlite-ping vary per project; the other four
checks are cheap enough that re-running them per project does not matter.

## Consequences

- Every dispatch pays a cached, sub-second sanity check. The first tick of the day pays the
  uncached cost; subsequent ticks within 60 s pay nothing.
- A failed gate halts dispatch for one project without affecting the others — the per-project
  scheduler architecture (ADR 0021) makes this isolation natural.
- All gate failures are first-class events (`smoke.failed`) visible in the project's event stream,
  not just in server logs. The Roster / cost dashboards can surface persistent failures.
- The redaction step is the same one used by `pre-tool-use-hook.ts`; tokens never reach disk or
  the event stream.
- The gate is idempotent and read-only — it never writes to the project's worktree or DB. A failed
  check leaves no residue.
- New projects added under `target-projects/<slug>/` automatically inherit the gate; no per-project
  wiring is needed.
