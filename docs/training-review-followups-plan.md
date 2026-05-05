# Training-Review Follow-ups — Implementation Plan

> **Provenance:** review of `docs/steves-training-materials-analysis.md` against shipped code (M0–M9). Five gaps surfaced; this plan turns them into executable issues.
>
> **Status:** ready to file as GitHub issues in `shaunnez/goose-hub`. Issues 1–4 land before M10 starts; issue 5 is the first M10 work item.

## How to use this plan

1. File each section below as a separate GitHub issue against `shaunnez/goose-hub` with the title shown. Body = the issue's section verbatim from the `## Outcome` line down. Apply the labels listed under each issue.
2. Then follow `CLAUDE.md` "How to approach a task" — pick the lowest-numbered unblocked issue, label it `factory:in-progress`, work it TDD-first, open a PR with `Closes #N`.
3. **Sequencing constraints (hard):**
   ```
   #1 PostToolUse  ──┐
                     ├──> #2 Decision-type taxonomy
   #3 Dev test scope ┘    (parser benefits from kind enum)
   #4 Fix-or-register     (independent; any time)
   ──── M10 boundary ────
   #5 AC verify-command   (renders cleanly after #1 + #2)
   ```
4. Issues #1, #3, #4 may be in flight in parallel PRs. #2 must follow #1 by ≤1 PR.

## Hard guardrails (apply to all five)

- Vertical slices, never horizontal layers. Slices include only the surfaces they touch.
- Slices import from `core/` through public package paths (`@goose-hub/core/...`), never relative cross-slice paths.
- TDD: failing test first, then implementation, then refactor.
- `slice.test.ts` and `README.md` are required for every new slice.
- Decision-summary events must be emitted at decision points (single sentence, no chain-of-thought, no secrets).
- Governance files (`MISSION.md`, `FACTORY_RULES.md`, `CLAUDE.md`, `target-projects/**`) are immutable to Factory PRs. Don't touch them.
- Do not modify `docs/PLAN.md` or `CONTEXT.md` without an ADR. Issue #2 touches `CONTEXT.md` decision-summary phrasing; that ADR is called out explicitly.

---

## Issue 1 — `M9.XX: PostToolUse hook for live [decision] markers`

**Labels:** `type:feature`, `priority:medium`, `schedule:current`, `area:agent-runtime`

### Outcome

The agent's `[decision] …` narration appears in the Timeline mid-run, not just at end-of-run when the schema's `decisionSummaries` array is harvested.

### Why

Today, Timeline animates with `agent.tool-call` events from the PreToolUse hook (`core/tool-layer/pre-tool-use-hook.ts`). Skills (`implement`, `qa`, `review`) all emit `[decision] …` lines in their assistant text turn per `CONTEXT.md:51-53`, but nothing reads them mid-run — they only land at end-of-run when the validated schema's `decisionSummaries` array is harvested. CONTEXT.md mandates this hook ("PostToolUse hook scans `transcript_path` for new markers since last fire and forwards to event stream"); it's documented but not implemented.

### Acceptance criteria

- [ ] `core/tool-layer/post-tool-use-hook.ts` exists, mirrors the structure of `pre-tool-use-hook.ts`
- [ ] Hook reads `transcript_path` from CC's hook input on stdin, tails for new lines since last fire, regex `/^\[decision\]\s+(.+)$/m` extracts each marker
- [ ] Hook tracks last-seen offset per `runId` in `~/.factory/hooks/state/<runId>.cursor` so re-fires don't re-emit
- [ ] Each new marker POSTs to `POST /events/decision-summary` on `localhost:${FACTORY_SERVER_PORT}` with `{ run_id, summary, timestamp }`
- [ ] `apps/server/src/domains/events/router.ts` adds `POST /decision-summary` route
- [ ] `apps/server/src/domains/events/service.ts` adds `recordDecisionSummary()` mirroring `recordToolCall()` — resolves projectId/workItemId from the matching `agent.run-started` event
- [ ] New event kind `agent.decision-summary-live` distinct from end-of-run canonical `agent.decision-summary` (so retro can reconcile)
- [ ] `deployHooks()` writes both hook scripts atomically; both registered in workspace `.claude/settings.json`
- [ ] `apps/web/src/components/detail/components/TimelineEvents.tsx` adds a `case 'agent.decision-summary-live'` arm — same row treatment as `agent.tool-call` but with a distinct icon (suggestion: `💭` or a thought-bubble svg)
- [ ] Hook failures are best-effort — a failing POST never blocks the agent's tool execution (existing PreToolUse pattern)
- [ ] `core/tool-layer/post-tool-use-hook.test.ts` covers: marker extraction with multiple `[decision]` lines, idempotency on re-fire (cursor advances), invalid-JSON-on-stdin doesn't crash the hook, server-down POST fails silently
- [ ] `core/tool-layer/slice.test.ts` covers the integration: deploy both hooks, assert both files exist with correct mode
- [ ] README updated in `core/tool-layer/README.md` describing the two hooks side by side

### Files touched

- `core/tool-layer/post-tool-use-hook.ts` (new)
- `core/tool-layer/post-tool-use-hook.test.ts` (new)
- `core/tool-layer/pre-tool-use-hook.ts` (deploy both, or extract shared `deploy.ts`)
- `core/tool-layer/slice.test.ts`
- `core/tool-layer/README.md`
- `apps/server/src/domains/events/router.ts`
- `apps/server/src/domains/events/service.ts`
- `apps/server/src/domains/events/service.test.ts` (or equivalent)
- `apps/web/src/components/detail/components/TimelineEvents.tsx`
- `apps/web/src/components/detail/components/TimelineSection.test.ts`

### Out of scope

- Reconciling live markers against canonical `decisionSummaries` at run end (follow-up if duplicates surface in practice).
- Retro-side dedup.
- Migrating historical events.

### Dependencies

None.

---

## Issue 2 — `M9.XX: Decision-type taxonomy (kind enum + step → kind rename)`

**Labels:** `type:refactor`, `priority:medium`, `schedule:current`, `area:skills`, `area:agent-runtime`

### Outcome

Every skill's `decisionSummaries` entry carries a controlled `kind` from a shared enum. `summary` stays free text. Retro can group decisions across the corpus.

### Why

Today `step: z.string()` everywhere — only `skills/triage/README.md` documents a vocabulary, and the schema doesn't enforce it. Three coexisting flavours (phase names like `plan`/`red`/`green`, free text, README-documented enums) make M10 multi-project retro harder than it needs to be. Promoting to a shared enum is mechanical, lands cleanly, and gives retro a clean group-by key.

### Acceptance criteria

- [ ] `core/agent-runtime/decision-types.ts` exists, exports `DecisionKindSchema = z.enum([...])` covering:
  - **Cross-cutting decisions:** `MODEL_SELECTION`, `SCOPE_CHANGE`, `FIX_STRATEGY`, `SKIP_GATE`, `ESCALATE`
  - **Phase markers:** `READ`, `PLAN`, `RED`, `GREEN`, `REFACTOR`, `LINT`, `COMMIT`, `STRUCTURAL_CHECK`, `FUNCTIONAL_CHECK`, `REGRESSION_CHECK`, `CRITERIA_CHECK`, `QUALITY_SCORE`, `DIFF_READ`, `VERDICT`
  - **Self-observations:** `TOOL_FAILURE`, `RETRY`, `BLOCKER`, `INSIGHT`, `UNCERTAINTY`, `DEFERRED`
- [ ] `core/retrospective/schemas.ts` `DecisionSummarySchema` updated: `kind: DecisionKindSchema` replaces `step: z.string()`. `summary` and `evidence` unchanged.
- [ ] All 14 skill schemas updated to import `DecisionSummarySchema` from `@goose-hub/core/retrospective/schemas.js` — local duplicates in `skills/qa`, `skills/review`, `skills/implement`, `skills/triage`, etc. removed
- [ ] All 14 `skill.md` prompts updated:
  - Replace example `[decision] Plan: …` with `[decision] PLAN: …` (uppercase enum prefix, colon, summary)
  - Add a shared "Decision-summary kinds" section listing the enum and which kinds the skill is most likely to emit
- [ ] `skills/triage/README.md` decision-type table updated to reference the shared enum
- [ ] `core/agent-runtime/mock-outputs.ts` updated to emit valid `kind` values
- [ ] `core/tool-layer/post-tool-use-hook.ts` (from issue #1) parses kind: regex becomes `/^\[decision\]\s+([A-Z_]+):\s+(.+)$/m`, extracts `(kind, summary)` tuple, validates `kind` against the enum before posting (invalid kind → log + skip)
- [ ] `apps/server/src/domains/events/service.ts` `recordDecisionSummary()` validates `kind` against the enum
- [ ] `CONTEXT.md` "Decision Summary (live)" entry updated to reflect the new format (single ADR if you prefer it formal: `docs/adr/0016-decision-kind-taxonomy.md`)
- [ ] Each `skills/*/slice.test.ts` includes one fixture verifying a known-good output validates AND one verifying an invalid kind is rejected
- [ ] `core/agent-runtime/slice.test.ts` covers the schema migration end-to-end

### Files touched

- `core/agent-runtime/decision-types.ts` (new)
- `core/retrospective/schemas.ts`
- Every `skills/*/schema.ts` (14 files)
- Every `skills/*/skill.md` (14 files)
- Every `skills/*/slice.test.ts` (14 files, mechanical)
- `core/agent-runtime/mock-outputs.ts`
- `core/tool-layer/post-tool-use-hook.ts`
- `apps/server/src/domains/events/service.ts`
- `CONTEXT.md`
- `docs/adr/0016-decision-kind-taxonomy.md` (recommended)

### Out of scope

- Retro UI changes that group by kind — that's M10 retro work.
- Migration of historical events in SQLite — accept the discontinuity. If anything reads old events, label them `kind: 'UNKNOWN'`.

### Dependencies

Lands cleanly with or after issue #1. PostToolUse parser benefits from typed kind. Both can land in either order; if #2 lands first, #1's PostToolUse hook should ship with the typed parser from day one.

### Risk

Noisy diff (touches every skill). One PR, one mechanical pass, `slice.test.ts` per skill is the safety net.

---

## Issue 3 — `M9.XX: Dev focuses on tests it wrote or affected; QA runs full suite`

**Labels:** `type:improvement`, `priority:medium`, `schedule:current`, `area:skills`

### Outcome

The implement skill stops re-running the entire test suite on every Red→Green→Refactor→Lint pass. It runs only the tests it wrote plus tests for files it touched. QA (already runs the full suite) is the sole authority on collateral breakage.

### Why

Dev today runs `<test_command>` (full suite) up to 5+ times per run (`skills/implement/skill.md:60,66,72,78`). Burns tokens, slows the loop, and accidentally hides the "did dev break something elsewhere?" signal that QA should be the authority on. Steve's training docs make this split explicit: dev is responsible for its own surface, QA is the holdout that catches everything else.

### Acceptance criteria

- [ ] `skills/implement/skill.md` Red/Green/Refactor sections updated: dev runs targeted commands only — `<test_command> --run path/to/new.test.ts path/to/affected.test.ts` (or the project's equivalent for partial runs)
- [ ] `skills/implement/skill.md` adds an explicit note in "Critical rules": "QA runs the full suite — your job is to ship green for the surface you touched, not to verify the world. If you broke something far away, QA catches it."
- [ ] New optional context field `<targeted_test_command>` on the implement skill — defaults to `<test_command>` with file-path arguments appended at run time
- [ ] `skills/implement/schema.ts` adds `testsRun: { command: string, paths: string[] }` so the orchestrator and QA can see exactly what dev ran
- [ ] `skills/qa/skill.md` Tier 2 reinforced (one paragraph): "QA always runs the full `<test_command>`, even if `testRun` is present in context (which it is — the workflow pre-runs it). Cross-reference `testsRun.paths` from the dev output against your full-suite results: failures outside dev's targeted set are the high-signal regressions and should be flagged as `error`-severity findings."
- [ ] `skills/implement/slice.test.ts` fixture: a run produces `testsRun` with paths matching `filesWritten`
- [ ] `skills/qa/slice.test.ts` fixture: full-suite-fails-outside-dev-paths produces an error finding
- [ ] No change to QA workflow code — QA already runs full

### Files touched

- `skills/implement/skill.md`
- `skills/implement/schema.ts`
- `skills/implement/config.ts`
- `skills/implement/slice.test.ts`
- `skills/qa/skill.md`
- `skills/qa/slice.test.ts`

### Out of scope

- Rebuilding QA workflow.
- Computing the affected-file set automatically. Dev decides from its own diff awareness; we trust the bot, QA catches misses.
- Dev calling out exactly which tests are "affected" — `paths` field captures what dev actually ran; that's enough.

### Dependencies

None. Independent of issues #1, #2, #4.

---

## Issue 4 — `M9.XX: Fix-or-register rule explicit in QA and Review prompts`

**Labels:** `type:improvement`, `priority:medium`, `schedule:current`, `area:skills`

### Outcome

Every QA and Review finding is either fixed in this PR, registered as a follow-up issue, or explicitly out-of-scope-for-this-issue. Never deferred, never "TODO".

### Why

QA today records findings → fails on `error` severity, but doesn't say "every finding is fixed in this PR or registered." Implicit in the verdict logic; needs explicit phrasing so the discipline holds across all skills' future revisions. Steve's training materials flag this as a primary safety mechanism: deferred findings are how production drift accumulates.

### Acceptance criteria

- [ ] `skills/qa/skill.md` adds a new section "Fix-or-register" between "Acceptance criteria check" and "8-category quality scoring rubric": every finding must be classified — fixed in this PR, registered as a follow-up issue, or out-of-scope-for-this-issue with one-sentence rationale. No deferral, no "TODO".
- [ ] `skills/qa/schema.ts` `FindingSchema` extended:
  ```ts
  disposition: z.enum(['fixed', 'registered', 'out-of-scope']),
  dispositionRef: z.string()  // commit SHA, issue number (e.g. "#234"), or one-sentence rationale
  ```
  Both fields required when `severity === 'error'`; optional otherwise (warnings/info findings can be informational).
- [ ] Same additions to `skills/review/skill.md` and `skills/review/schema.ts` (Review's `ReviewFindingSchema`)
- [ ] QA verdict rules updated: an `error`-severity finding without disposition = automatic `fail`; a `warning` with `disposition: 'out-of-scope'` doesn't downgrade to `partial`
- [ ] Review verdict rules updated symmetrically
- [ ] `apps/web/src/components/detail/components/QaFindingRow.tsx` renders the disposition (small pill: "fixed" / "registered #234" / "out-of-scope")
- [ ] `apps/web/src/components/detail/components/ReviewSection.tsx` renders the same pill on review findings
- [ ] `skills/qa/slice.test.ts` covers all three dispositions and verifies the schema rejects an error-severity finding without disposition
- [ ] `skills/review/slice.test.ts` mirror coverage

### Files touched

- `skills/qa/skill.md`
- `skills/qa/schema.ts`
- `skills/qa/slice.test.ts`
- `skills/review/skill.md`
- `skills/review/schema.ts`
- `skills/review/slice.test.ts`
- `apps/web/src/components/detail/components/QaFindingRow.tsx`
- `apps/web/src/components/detail/components/ReviewSection.tsx`
- `apps/web/src/components/detail/components/QASection.test.tsx` (or equivalent)
- `apps/web/src/components/detail/components/ReviewSection.test.tsx`

### Out of scope

- QA actually filing the follow-up issue itself (QA is a holdout — it only records the finding; humans or a separate orchestrator step file).
- Auto-creating GitHub issues from `disposition: 'registered'` — future automation.

### Dependencies

None. Can land before, during, or after #1, #2, #3.

---

## Issue 5 — `M10.XX: Acceptance criteria carry verify-command + tolerance`

**Labels:** `type:feature`, `priority:medium`, `schedule:current`, `area:skills`, `area:web`

### Outcome

Every acceptance criterion in an issue body has a runnable verify command, expected output, and tolerance. QA runs them per-AC and renders results in the QA tab and Timeline.

### Why

Steve's training analysis surfaces this as the "key gap" in our current `CLAUDE.md`: ACs today are `[ ]` checkboxes — QA gets a passing test suite as the only signal that AC #3 is met. Verify commands let QA prove each AC independently of whatever tests dev wrote, sharpen the holdout boundary, and align our spec discipline with Steve's plan-example gold standard.

### Acceptance criteria

- [ ] Issue template at `.github/ISSUE_TEMPLATE/factory-issue.md` (create if absent) updated to require per-AC verify block:
  ```
  ## Acceptance criteria

  - [ ] <criterion text>
        Verify: <runnable command>
        Expected: <output pattern or substring>
        Tolerance: <what counts as a pass — exact-match, contains, ranges, etc.>
  ```
- [ ] Parser at `apps/server/src/domains/issues/parse-acceptance.ts` (new) extracts `Verify:` / `Expected:` / `Tolerance:` blocks from the issue body. Returns `{ ac: string, command: string, expected: string, tolerance: string }[]`. Graceful degradation: missing block → entry is skipped, parser logs `ac.no-verify-block` event, doesn't fail the run.
- [ ] `skills/qa/config.ts` context schema adds `verifyCommands: { ac: string, command: string, expected: string, tolerance: string }[]` (orchestrator extracts via the new parser before QA spawn)
- [ ] `skills/qa/skill.md` Tier 2 grows a step "Per-AC verification": for each entry in `verifyCommands`, run via the `bash` tool, capture output, compare against `expected` per `tolerance`. Record a `criteriaResult` per AC. Emit `[decision] CRITERIA_CHECK: <ac short name> — <pass|fail>` per AC.
- [ ] `skills/qa/schema.ts` adds:
  ```ts
  criteriaResults: z.array(z.object({
    ac: z.string(),
    command: z.string(),
    expected: z.string(),
    actual: z.string(),
    tolerance: z.string(),
    passed: z.boolean(),
  }))
  ```
- [ ] QA verdict rules updated: any `criteriaResults[].passed === false` → verdict = `fail`, regardless of tier scores
- [ ] New event kind `agent.verify-command` emitted from QA as each command runs (live signal in Timeline). Schema: `{ runId, ac, command, actual, passed }`
- [ ] `apps/server/src/domains/events/service.ts` validates the new event kind
- [ ] `apps/web/src/components/detail/components/QASection.tsx` adds an "Acceptance Criteria" block above the three tier rows. One row per AC. Reuses `QaTierRow.tsx` grid styling: AC text (truncated, with full text on hover), command in mono, pass/fail pill, expected vs actual on hover/expand
- [ ] `apps/web/src/components/detail/components/TimelineEvents.tsx` adds a `case 'agent.verify-command'` arm — same row layout as `agent.tool-call` but titled with the AC text and a green/red dot for pass/fail
- [ ] `skills/qa/slice.test.ts`: fixture issue with three ACs, two with verify blocks → `criteriaResults` has two entries, third logged as `ac.no-verify-block`
- [ ] `apps/server/src/domains/issues/parse-acceptance.test.ts`: covers happy path (3 ACs all parsed), partial blocks (Verify only, no Expected), malformed blocks (extra whitespace, blank lines), entirely-missing blocks (return empty array)
- [ ] Playwright e2e at `apps/web/e2e/qa-verify-commands.spec.ts`: file an issue with verify blocks, run QA, verify the Acceptance Criteria block renders with the right pass/fail state and the Timeline shows live `agent.verify-command` events

### Files touched

- `.github/ISSUE_TEMPLATE/factory-issue.md` (new or update)
- `apps/server/src/domains/issues/parse-acceptance.ts` (new)
- `apps/server/src/domains/issues/parse-acceptance.test.ts` (new)
- `apps/server/src/domains/events/service.ts`
- `apps/server/src/shared/dispatch.ts` (wire the parser into QA spawn)
- `skills/qa/config.ts`
- `skills/qa/schema.ts`
- `skills/qa/skill.md`
- `skills/qa/slice.test.ts`
- `apps/web/src/components/detail/components/QASection.tsx`
- `apps/web/src/components/detail/components/QaTierRow.tsx` (may need a generic variant)
- `apps/web/src/components/detail/components/TimelineEvents.tsx`
- `apps/web/src/components/detail/components/QASection.test.tsx`
- `apps/web/src/components/detail/components/TimelineSection.test.ts`
- `apps/web/e2e/qa-verify-commands.spec.ts` (new)

### Out of scope

- Retroactively adding verify blocks to existing issues.
- Auto-generating verify commands from prose ACs (would be a spec-author skill change — file separately if useful).
- Review skill consuming `criteriaResults` (next pass; reviewer reads the QA verdict for now).

### Dependencies

- Soft dep on issue #1 (Timeline already handles new event kinds well by then).
- Soft dep on issue #2 (`CRITERIA_CHECK` is in the kind enum from day one).
- Hard dep: nothing.

### Risk

Largest of the five (UI + schema + parser + e2e). Land it as 2–3 PRs if needed:
1. Parser + schema + QA prompt
2. UI rendering (QA tab + Timeline)
3. e2e + issue template

---

## Done definition

All five issues' acceptance criteria green, all five PRs merged, CI green on `main`. Any follow-ups discovered during execution filed as new issues, never inlined.
