# Bug #1011 — Follow-up fixes plan

## Context

After shipping Track A (A1–A8) and Track B (B1–B7) from `bug-1011-cost-postmortem-and-plan.md`, a live run of issues #1016/#1017/#1018 surfaced five remaining problems. This document plans those five as a single batched workstream.

Source analysis: chat transcript on `cost-perf/993-handoff-precision` (2026-05-24). Three pipelines were observed end-to-end on goose-hub-self. The summary below cites the exact failure surfaces.

## Goals

- Stop the two main causes of "wasted" investigations (fetch-fail + bug-enhance hallucination) — these voided $3.56 of perfectly-good work in the observed runs.
- Close one cosmetic-but-noisy hole (`scoutDigest` allowlist).
- Verify one already-shipped guardrail (B5 redundancy-abort) actually fires.
- Fix codex-cli's `resources/read` -32603 errors so scouts stop burning tokens on failed reads.

Model preference for execution: **Sonnet 4.6** everywhere unless the surface is large enough to demand Opus. None of these five qualify. Reasoning: low Opus budget; tasks are mechanical fixes guided by exact file:line citations from analysis.

## Work packets

### F1 — `scoutDigest` allowlist
- **Surface**: `core/agent-runtime/scout-runner.ts:60` `SCOUT_CONTEXT_ALLOWLIST`
- **Change**: append `'scoutDigest'` to the array.
- **Tests**: extend `core/agent-runtime/swarm.test.ts` (or scout-runner test) to assert no `tool.violation` fires when wave2 spec carries `scoutDigest`.
- **Eval**: after deploy, re-run any investigate workflow with wave2; `tool.violation` count for `scoutDigest` should be 0.
- **Scope**: 1 file edit + 1 test.
- **Agent/Model**: main thread, **Sonnet**. Trivial 1-line change with test.
- **Depends on**: none.
- **Risk**: zero — purely permissive.

### F2 — `transitionAndEmitState` resilience on success path
- **Surface**: `slices/investigate/workflow.ts:951` (success path) — also `slices/triage/`, `slices/spec-author/`, any other slice that calls `transitionAndEmitState` after a successful skill.
- **Root cause** (analysis): GitHub label-flip `fetch()` blip throws `fetch failed` → caught by outer try → flips work to `factory:needs-human` despite valid `agent.investigation-complete` event already persisted.
- **Change**:
  - In `core/event-stream/state-transition.ts` `transitionAndEmitState`, wrap the `source.transitionState(...)` and `source.forceState(...)` calls in a small retry helper: 3 attempts, exponential backoff (200ms → 600ms → 1.8s). Only retry on network-class errors (`TypeError: fetch failed`, `ECONNRESET`, GitHub 5xx/429).
  - If all retries fail, **still emit the `state.transitioned` event** locally (it's the source of truth for the UI/orchestrator) and emit a new `state.transition-deferred` event with the error so a follow-up reconciler can re-attempt the remote label flip.
  - In `slices/investigate/workflow.ts`, separate the `transitionAndEmitState({to:'factory:investigation-complete'})` from the inner try block — if it throws after `agent.investigation-complete` is already emitted, do NOT route to `needs-human`. The investigation succeeded.
- **Tests**:
  - `core/event-stream/state-transition.test.ts` (new or extended): mock `source.transitionState` to throw `fetch failed` twice then succeed; assert it succeeds.
  - `slices/investigate/slice.test.ts`: mock the `transitionState` to throw permanently after `agent.investigation-complete`; assert the work item does NOT transition to `needs-human` and the investigation-complete event stays in place. Assert `state.transition-deferred` fires.
- **Eval**:
  - Re-run #1016/#1018 manually if reproducible. Cost-effective alternative: write a slice test that synthetically throws.
  - Watch for `state.transition-deferred` events in production — count over a week.
- **Scope**: 2-3 files, ~80 LOC + tests.
- **Agent/Model**: main thread, **Sonnet**. Mechanical but spans 2-3 files; will use TaskCreate to track.
- **Depends on**: none.
- **Risk**: medium. Retry logic must not retry on auth errors (401/403) — those are permanent and should fail fast. Add an `isTransient(err)` guard.
- **Register** new event kind: `state.transition-deferred` in `core/event-stream/kinds.ts`.

### F3 — bug-enhance path-existence prune + prompt floor
- **Surface**:
  - `core/agent-runtime/bug-enhance-runner.ts` (runner-side validation)
  - `skills/bug-enhance/prompt.md` (prompt nudge)
  - `core/event-stream/kinds.ts` (new event)
- **Root cause** (analysis): bug-enhance on #1016 made zero tool calls but emitted 3 candidate file paths — all hallucinated (`apps/web/src/pages/investigation/InvestigationPage.tsx` etc., none exist). Prompt A4 says "tool-verified" but does not enforce a floor and the schema accepts anything.
- **Change**:
  - In `runBugEnhance`, after `safeParseOutputForSchema` succeeds, post-process `groundedHints`:
    - For each `candidateFile.path`, resolve `path.join(input.workspaceDir ?? process.cwd(), candidate.path)` and `fs.statSync` it (or `fs.existsSync`). Drop entries that don't resolve.
    - For each `candidateComponent.file`, same check.
    - If `candidateFiles` becomes empty after pruning AND original had entries, emit `agent.bug-enhance-hallucinated` with `{droppedCount, originalCount, runId}` and set `groundedHints = null` (so downstream falls back to identifier extraction).
  - Add a prompt floor: in `prompt.md` Step 2, insert "If you have not made at least one tool call yet AND `category` is not `unknown`, you MUST call at least one `repo_intel.query` intent before emitting `candidateFiles`. If you still cannot ground anything, set `category:"unknown"` and return empty `groundedHints`."
- **Tests**:
  - `core/agent-runtime/bug-enhance-runner.test.ts` (new): mock runtime to return groundedHints with mix of real + fake paths; assert fake paths pruned, real kept, telemetry emitted when all pruned.
  - `skills/bug-enhance/slice.test.ts`: no schema change needed (path-existence is runtime concern).
- **Eval**: re-run bug-enhance on a known UI bug; check candidateFiles in the persisted investigation-seed artifact — all paths must resolve in the worktree.
- **Scope**: 2 files + 1 new test file + 1 event kind.
- **Agent/Model**: main thread, **Sonnet**. Mechanical fs.exists loop + telemetry.
- **Depends on**: none.
- **Risk**: low. Path-existence is a deterministic filesystem check. One thing to watch: bug-enhance may be invoked when the workspace is the repo root (inbox promotion) vs a worktree (lazy investigate path). Both must work — pass `workspaceDir` consistently and default to `process.cwd()` if absent (the inbox path already runs at the repo root).

### F4 — verify B5 redundancy-abort fires
- **Surface**:
  - `core/tool-layer/mcp/run-cache.ts` (where the abort lives — verify)
  - `core/tool-layer/mcp/tools/read.ts` (calls the cache)
- **Root cause** (analysis): plan said "abort run on >40% redundancy" but in observed runs (e.g. #1017 redundant-read fired but the abort branch was never visible). Need to confirm whether the abort is wired in or only the `agent.redundant-read` event is emitted.
- **Change**:
  - Read `run-cache.ts` and `read.ts` to confirm the abort branch exists.
  - If it does not: add it. Trigger condition: `redundantReads / totalReads > 0.40 AND totalReads >= 10`. Emit `agent.run-aborted` with reason `excessive-redundant-reads`, throw an abort error the runtime can catch.
  - If it does exist: add a slice test that drives it via 5+ redundant reads and asserts the abort.
- **Tests**: extend `core/tool-layer/mcp/tools/read.test.ts` to force the redundancy ratio over the threshold and assert the abort.
- **Eval**: scan production events for `agent.run-aborted` with the new reason after deploy.
- **Scope**: 1-2 files + test, depending on whether the gap exists.
- **Agent/Model**: spawn **cavecrew-investigator** first (read-only, returns file:line map of the abort logic). Then main thread fixes it in **Sonnet** if a gap is found. Splitting saves Opus/Sonnet context on the read step.
- **Depends on**: none.
- **Risk**: low. Threshold tuning may need tweaking but the principle is sound.

### F5 — Implement MCP `resources/list` + `resources/read`
- **Surface**:
  - `core/tool-layer/mcp/` — the MCP server registration code.
  - `core/tool-layer/mcp/tools/read.ts` — internal reuse.
  - `core/tool-layer/mcp/run-cache.ts` — must dedupe with `read_file`.
- **Root cause** (analysis): codex-cli auto-calls `resources/read` with bare paths; factory-tools doesn't expose `resources/*` capability; codex gets `-32603 Invalid URL`; scout-user-journey returns `findingsCount:0` after burning ~$0.05 / 60k tokens per run.
- **Change**:
  1. Register `resources` capability in the MCP server init.
  2. Implement `resources/list` enumerating worktree files via the existing path-policy filter (same denylist as `read_file`).
  3. Implement `resources/read`:
     - Accept URI forms `file:///<worktree-relative>`, `factory://<worktree-relative>`, and tolerate bare paths (normalize to `factory://` internally).
     - Route through the same code path as the `read_file` tool — same per-run cache key (canonical worktree-relative path), same secret redaction, same path policy.
     - Emit `agent.tool-call` audit event with `tool_name:"resources/read"` so redundancy + intensity telemetry already covers it.
  4. **Dedupe check** (from memory `mcp-resources-codex-dedupe-check`): after deploy, one-off integration run — group `agent.tool-call` events by `(runId, canonical_path)`, count distinct `tool_name`. Any group with both `resources/read` and `read_file` means cache key isn't shared. Fix by canonicalizing the cache key.
- **Tests**:
  - New `core/tool-layer/mcp/resources.test.ts`: assert `resources/list` returns workspace files, `resources/read` accepts URI/bare-path/file:// forms, secret redaction applies, path policy denies `.factory/`, cache hits when same path was already read via `read_file`.
- **Eval**:
  - Spawn codex with a fresh worktree, watch for `resources/read` returning ok (not -32603).
  - Confirm scout-user-journey now returns non-empty findings.
  - Confirm `read_file` and `resources/read` share cache (no duplicate kv-cache injections).
- **Scope**: ~80-150 LOC + test file.
- **Agent/Model**: main thread, **Sonnet**. Medium scope but mechanical — wire the handler, point at existing read pipeline.
- **Depends on**: F4 if F4 finds a run-cache gap (cache must work before adding a second consumer).
- **Risk**: medium. Two failure modes to guard:
  1. codex calling both `resources/read` and `read_file` for same path → no cache hit. Must verify post-deploy.
  2. `resources/list` accidentally walks a huge tree and times out. Cap depth + glob filter.

## Execution batches

```
BATCH 1 — parallel, no inter-deps
  F1  scoutDigest allowlist           Sonnet  (1 file, trivial)
  F2  transitionAndEmitState retry    Sonnet  (2-3 files)
  F3  bug-enhance path prune          Sonnet  (2 files + new test)
  F4  B5 redundancy-abort verify      Sonnet  (cavecrew-investigator first, then fix if needed)

BATCH 2 — gated on F4 (must confirm cache abort logic is sound first)
  F5  MCP resources/read              Sonnet  (medium scope, ~80-150 LOC)
```

F1, F2, F3, F4 touch disjoint files. Can be implemented in one main-thread session sequentially or split into back-to-back commits. F5 lands separately because:
- Depends on F4 verifying the cache aborts correctly (F5 adds a second consumer to that cache).
- Needs a one-off post-deploy verification (the codex dedupe check), so it benefits from a clean PR scope.

## Eval signal — verify follow-ups worked

| Metric | Pre (observed in 1016/1017/1018) | Target |
|---|---|---|
| `agent.run-failed` with `error:"fetch failed"` after successful `agent.investigation-complete` | 2 of 3 runs | 0 |
| `tool.violation` for `disallowedKey:"scoutDigest"` | 1-2 per investigation | 0 |
| bug-enhance candidateFiles where `fs.exists(worktree+path) === false` | 3 of 3 on #1016 | 0 after F3 |
| codex `agent.tool-call` `tool_name:"resources/read"` with status `failed` and `error containing "Invalid URL"` | 3 per scout-user-journey | 0 |
| `agent.run-aborted` `reason:"excessive-redundant-reads"` ever observed | unknown — needs F4 verification | should fire under synthetic 50% redundancy |

## Out of scope (still)

- Timeline JSON-to-TSX rendering for `agent.bug-enhance-lazy` and `agent.redundant-read` events. Cosmetic.
- Codex-cli vs claude-cli runtime comparison for the same bug. Separate workstream.
- Spec-author / dev-review optimisation. Bigger plan; not driven by #1011.

## Risk register

- **F2 over-retry**: aggressive retry on auth errors (401/403) will mask real config problems. The `isTransient(err)` predicate must explicitly only catch network class.
- **F3 false-prune**: if the bug-enhance runs against the wrong workspace (e.g. uninitialised worktree), every path will be pruned. Mitigation: emit `agent.bug-enhance-workspace-empty` warning if the worktree path itself doesn't exist; do NOT prune in that case.
- **F5 cache coherence**: dedupe verification is a manual post-deploy step. If we forget, costs silently double. Memory entry already saved to flag this.
