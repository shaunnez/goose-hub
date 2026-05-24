# Bug #1011 — Cost postmortem and remediation plan

## Context

Issue #1011 ("Chat bug" — UI bug where the chat widget reopens on the last thread instead of the list view) consumed ~10M tokens / ~$15 across the agent pipeline despite the new investigation + scout + spec-author intelligence layers. This document captures the forensic findings and the remediation plan.

## Cost breakdown (issue #1011)

| Run | Skill | Stage | Input tokens | Output | $ | Note |
|---|---|---|---|---|---|---|
| `3e9194d3` | implement | dev | 5,428,065 | 63,297 | 4.36 | fix-feedback retry |
| `454dc339:wp:WP1` | implement-wp | dev | 2,727,757 | 16,132 | 7.06 | first dev pass |
| `454dc339:dev-review` | dev-review | dev | 145,297 | 2,512 | 0.40 | |
| 5 scouts + investigate + wave-2 | various | other | ~1.4M | 12k | ~2.5 | 3 wave-1 scouts returned 0 findings |
| spec-author | spec-author | other | 26,635 | 3,966 | 0.25 | |

Dev = 81% of total. Of that, 67% is fix-feedback (cold restart), not first-pass dev.

## Root causes

### RC1. `fix-feedback` drops investigation context
`slices/fix-feedback/workflow.ts:296-306` — `contextAllowlist` for the `implement` run inside fix-feedback contains only `workItem.{title,body,number,priority}`, stack commands, `advisorFeedback`, `revisionPass`. No keyFiles, scout digest, spec, or investigation findings. Confirmed by event stream: `agent.investigation-context-injected` fires only for `:wp:WP1`, never for `3e9194d3`. Dev opened with `read_file CLAUDE.md` → `apps/web/README.md` → `App.tsx` → `main.tsx` → every chat component, blind-rediscovering investigation's prior knowledge.

### RC2. `investigationSeed` is structurally empty for natural-language bug reports
`core/agent-runtime/scout-prefetch.ts:57` calls `lookupWorkItemSymbols(title, body)`, which delegates to `core/symbol-index/lookup.ts:134-161` `extractIdentifiers`. This requires `looksLikeCode = /[A-Z]/.test(token) || token.includes('_') || /[a-z][A-Z]/.test(token)`. Issue #1011 body is "When closing the chat window via the floating button..." — pure natural language, zero camelCase, zero file paths. Zero identifiers extracted → empty candidateSymbols → empty candidateFiles. All `agent.investigation-seed-built` events to date show `candidateFileCount:0`. The code has **never produced a non-empty seed in practice**.

This is the actual architectural gap: the pipeline assumes the reporter pre-named files/symbols. Real bug reports don't.

### RC3. `repo_intel.query` Zod schema is non-discriminated
`core/tool-layer/mcp/schemas.ts:69-113` — every field except `intent` is `optional()`. Agent calls `{intent:"find-symbol"}` with no `name` → schema passes → dispatcher returns `{ok:false, reason:"invalid-args"}` → 8 consecutive `failed` queries before the agent gives up and brute-reads. Audit (`repo-intel.ts:426-428` `auditInput`) only logs `intent`, hiding which arg was missing.

### RC4. `run_tests` retry spirals
- implement (3e9194d3): 5 consecutive `run_tests:failed` on `ChatLauncher.test.tsx`
- implement-wp (454dc339): 9 consecutive `run_tests:failed` on same file
No cap on retries. No forced classification of failure cause between attempts.

### RC5. `fix-feedback` re-fixes the wrong target
QA failed on `core/agent-runtime/slice.test.ts > ClaudeCliRuntime sandbox mode` (3 regressions, unrelated to chat). fix-feedback handed the QA findings to dev as `advisorFeedback` text. Dev ignored it (no clear signal about file scope) and re-fixed the original chat work item. Burned 5.4M tokens on the wrong problem.

### RC6. No `read_file` per-run cache
`repo_intel.query` has run-level caching via `core/tool-layer/mcp/run-cache.ts`. `read_file` does not. ChatPanel.tsx was read 5 times consecutively in implement; tool-stats showed 43% redundancy rate (9 redundant of 21 reads).

### RC7. `bug-enhance` runs blind
`skills/bug-enhance/` already exists and runs at inbox→GitHub promotion. It classifies UI vs non-UI and inserts a `**Location**` markdown section. But `apps/server/src/domains/inbox/enhance.ts` uses `toolBundles: []` — no tools. Output is markdown only, never structured, never persisted as a seed for downstream agents.

This is the right place to do grounding (natural language → candidate files), but it's currently a guess based on body prose.

## Architecture pivot

**Grounding** — the transition from natural language to candidate file paths — needs to be a first-class stage, not implicit in the identifier-extraction shortcut. Two surfaces need grounding output:
1. Inbox promotion (every new bug report).
2. fix-feedback (every QA failure dispatched back to dev).

bug-enhance is the right vehicle for (1). The same grounder module backs (2). A separate "grounding scout" is redundant — bug-enhance already exists, runs at the right time, and has the right classification logic.

Deterministic grounding (route-index, fuzzy-component, recent-touched) is the toolkit; bug-enhance is the agent that selects and sequences it; the persisted output is the seed that flows through investigation and dev.

## Plan

Two parallel tracks. 15 work packets total.

### Track A — Grounding (addresses RC2, RC7)

| ID | Change | Files | Model | Depends on |
|----|---|---|---|---|
| A1 | Add `repo_intel.query` intents: `route-for-url`, `fuzzy-component`, `recent-touched` | `core/tool-layer/mcp/tools/repo-intel.ts`, `core/tool-layer/mcp/schemas.ts`, ast/route-index helpers, slice tests | Sonnet | — |
| A2 | Extend `BugEnhanceOutputSchema` with `groundedHints: {candidateFiles, candidateComponents, candidateRoutes}` | `skills/bug-enhance/schema.ts` | Haiku | — |
| A3 | Give bug-enhance `toolBundles:['readonly-search']`, budget cap `maxToolCalls=5` | `skills/bug-enhance/skill.config.ts`, `apps/server/src/domains/inbox/enhance.ts` | Haiku | A1, A2 |
| A4 | Rewrite `skills/bug-enhance/prompt.md` — require tool-verified Location and structured `groundedHints` output | `skills/bug-enhance/prompt.md`, `skills/bug-enhance/slice.test.ts` | Opus | A1, A2 |
| A5 | Persist `groundedHints` as `agent_artifacts` row `kind:'investigation-seed'` at inbox promotion | `apps/server/src/domains/inbox/enhance.ts`, `apps/server/src/domains/inbox/service.ts` | Sonnet | A2 |
| A6 | `buildInvestigationSeed` checks for existing seed artifact before identifier extraction; merge if both present | `core/agent-runtime/scout-prefetch.ts`, slice tests | Sonnet | A5 |
| A7 | Lazy-run bug-enhance from `investigate` workflow when no seed artifact exists | `slices/investigate/workflow.ts` | Sonnet | A5, A6 |
| A8 | Branch bug-enhance for non-UI bugs (server/API/CLI), or add sibling skill | `skills/bug-enhance/prompt.md`, `skills/bug-enhance/schema.ts` | Sonnet | A4 |

### Track B — Repair-cycle waste (addresses RC1, RC3, RC4, RC5, RC6)

| ID | Change | Files | Model | Depends on |
|----|---|---|---|---|
| B1 | `RepoIntelQueryInput` → `z.discriminatedUnion('intent', [...])`. Per-intent required args. Audit logs `inputKeys[]` (not values) | `core/tool-layer/mcp/schemas.ts`, `core/tool-layer/mcp/tools/repo-intel.ts`, slice tests | Sonnet | — |
| B2 | Inject prior investigation digest + prior dev `decisionSummaries` + prior dev changed-files into `fix-feedback` `context` + `contextAllowlist` | `slices/fix-feedback/workflow.ts`, slice test | Sonnet | — |
| B3 | `run_tests` retry cap: 3 consecutive `failed` without intervening Edit/Write → block 4th + force READ-failure decision. Emit `tool.violation` `excessive-test-retries` | `core/tool-layer/mcp/run-cache.ts`, run-tests tool, tests | Sonnet | — |
| B4 | Parsed test-failure summary from Vitest JSON in `run_tests` tool result (failed test name, assertion, file). Replace raw blob | same as B3 | Sonnet | B3 |
| B5 | `read_file` per-run cache (mirror `repo_intel` `run-cache`). Emit `agent.redundant-read` on >3 offset-reads of same path. Abort run on >40% redundancy | `core/tool-layer/mcp/tools/read-file.ts`, `core/tool-layer/mcp/run-cache.ts` | Sonnet | — |
| B6 | fix-feedback wrong-target router: compare QA-finding file paths vs prior dev diff → if off-target, run micro-investigation first. Auto-escalate to `needs-human` if `repairCycle >= 2` | `slices/fix-feedback/workflow.ts`, slice test | Opus | B2 |
| B7 | Grounder on QA findings before fix-feedback dispatch (use A1 intents on advisorFeedback text) | `slices/fix-feedback/workflow.ts` | Sonnet | A1, B2 |

## Execution batches

```
BATCH 1 — parallel, no inter-deps
  A1  repo_intel new intents             Sonnet
  A2  bug-enhance schema field           Haiku
  B1  repo_intel discriminated union     Sonnet
  B2  fix-feedback context inherit       Sonnet
  B3  run_tests retry cap                Sonnet
  B5  read_file run-cache                Sonnet

BATCH 2 — parallel, gated on Batch 1
  A3  bug-enhance toolBundles            Haiku   (needs A1+A2)
  A5  persist seed artifact              Sonnet  (needs A2)
  B4  parsed test-failure summary        Sonnet  (needs B3)
  B6  fix-feedback wrong-target          Opus    (needs B2)
  B7  QA-findings grounder               Sonnet  (needs A1+B2)

BATCH 3 — parallel, gated on Batch 2
  A4  bug-enhance prompt rewrite         Opus    (needs A1+A2+A3)
  A6  seed lookup in scout-prefetch      Sonnet  (needs A5)

BATCH 4 — gated on Batch 3
  A7  lazy-run bug-enhance               Sonnet  (needs A5+A6)

BATCH 5 — independent, ship last
  A8  non-UI branch                      Sonnet  (needs A4)
```

## Risk callouts

- **A4 prompt rewrite** is the highest-blast-radius single change. Drives downstream agent behavior. Run with snapshot eval of #1011 + 2 other recent bugs before shipping. `skills/bug-enhance/slice.test.ts` exists; extend it.
- **B1 discriminated union** changes the accepted shape for any in-flight `repo_intel.query` call. Audit example payloads in skill prompts (`implement`, `implement-wp`, scouts) and update to match new required-args.
- **B3 retry cap** must not be too aggressive — flaky tests can need 2 retries legitimately. Cap at 3 consecutive + allow explicit `retry:true` bypass if needed.
- **A5 + A6 seed-merge** — if bug-enhance writes a seed and identifier-extraction also runs, dedupe by path and don't overwrite higher-confidence hints with lower.

## Eval signal — verify the plan worked

Re-run pipeline on a copy of #1011 (or 2-3 recent #1000-range bugs) after each batch:

| Metric | Pre (#1011) | Target |
|---|---|---|
| `investigationSeed.candidateFileCount` | 0 | ≥3 |
| wave-1 scouts with `findingsCount=0` | 3/5 | 0/5 |
| `implement` tokens | 5.4M | <1M |
| `implement-wp` tokens | 2.7M | <1M |
| `repo_intel` `noMatches:false, status:failed` | 8 | 0 |
| `run_tests` max consecutive failures per run | 9 | ≤3 |
| `read_file` redundancy rate | 43% | <15% |

## Out of scope (for now)

- Wave-2 `scoutDigest` allowlist tool-violation (2 events, cosmetic). Address separately if it recurs.
- Timeline grouping for fix-feedback attempts (dashboard).
- Spec-author `filesOwned.action` field (Codex's recommendation #2 — useful but lower leverage than grounding).
