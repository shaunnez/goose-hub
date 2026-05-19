# Telemetry and prompt hardening

## Goal

Make path and operational-fact drift easy to debug, then simplify prompts so agents follow Factory-owned tool contracts instead of carrying brittle mechanics in prose.

This is the cleanup layer after path normalization, factory-tools path output, observed facts, and contract repair gates are in place.

## Depends On

- Factory-tools canonical path integration.
- Workflow-owned observed facts.
- Contract repair gates.

## Non-goals

- Do not make the timeline noisy by dumping full tool payloads.
- Do not expose holdout-forbidden implementation reasoning to QA or review.
- Do not remove prompt rules before tool/workflow enforcement exists.

## Slices

### [x] Slice 1 - Timeline labels for read/write/report/changed

Update timeline/detail rendering so users can distinguish operational states:

- agent read a file,
- agent wrote or edited a file,
- agent reported a path in terminal JSON,
- workflow normalized a path,
- git observed a changed file,
- guard failed because observed changes missed the surface.

Acceptance criteria:

- Wrong-surface failures no longer imply the agent never read a key file.
- Path-normalization events are visible but compact.
- Existing older events still render sensibly.

Completed:

- Timeline rendering now labels `agent.tool-call` read/write/edit/test/lint/typecheck events from both legacy and MCP audit payload shapes.
- `agent.path-normalized`, `agent.output-repaired`, `agent.output-fact-mismatch`, and `agent.contract-gate-blocked` render as compact operational-fact cards.
- Cards distinguish normalized paths, git-observed changed files, tool-observed writes, model-declared files, and mismatch buckets without dumping raw payload JSON.

### [x] Slice 2 - Path drift dashboard/report

Add lightweight reporting for path repairs and mismatches.

Acceptance criteria:

- A developer can find recent `agent.output-repaired` and `agent.output-fact-mismatch` events by project and skill.
- Counts are grouped by skill and field.
- The report identifies whether drift is decreasing after factory-tools adoption.

Completed:

- Added `core/agent-runtime/path-drift-report.ts` to group repair, mismatch, and gate-block events by skill and field.
- Added `pnpm path-drift:report [projectId] [limit]` for a lightweight developer report over recent event-stream data.
- The report includes scanned event counts, drift event counts, latest event id, per-field buckets, and a time-window trend direction.

### [x] Slice 3 - Prompt contraction pass

Remove duplicated low-level mechanics once factory-tools owns them.

Acceptance criteria:

- Implement prompts say to use factory-tools paths verbatim.
- Shell syntax and CWD warnings are reduced to high-signal rules where tools still cannot enforce.
- Path contract remains explicit.
- Prompt examples use canonical paths only.

Completed:

- `skills/implement/prompt.md` and `skills/implement-wp/prompt.md` now center `mcp__factory-tools__*` calls and returned canonical paths.
- Prompt examples remain repo-root/worktree-root relative and avoid package-relative `src/...` output examples.
- Low-level shell/CWD prose was contracted where Factory tools enforce the behavior directly.

### [x] Slice 4 - Contract audit extension

Extend existing skill-contract audit tooling to flag vague path language.

Acceptance criteria:

- Schemas and prompts should not say only "workspace-relative" for path fields.
- Output examples with `src/...` under package-owned surfaces are flagged.
- The audit can run advisory first, then become enforced for implement-family skills.

Completed:

- `core/agent-runtime/skill-contract-audit.ts` now reports vague `workspace-relative` path language and package-relative `src/...` JSON output examples.
- `scripts/audit-skill-contracts.ts --strict` enforces the new path-language checks for `implement`, `implement-wp`, and `spec-author`; other skills remain advisory through the formatted report.

### [x] Slice 5 - Generalize beyond paths

Apply the same pattern to other model-declared operational facts.

Candidates:

- commands run,
- output caps,
- evidence artifacts,
- PR metadata,
- state transitions,
- budget/cost facts.

Acceptance criteria:

- Each candidate has an owner: tool, workflow, collector, runtime, or model.
- Facts Factory can observe are no longer accepted only from model JSON.
- Residual model-authored facts are documented as judgment or explanation fields.

Completed:

- Added `core/agent-runtime/operational-fact-owners.ts` as the current owner table for commands run, targeted test paths, changed files, evidence artifacts, PR metadata, state transitions, budget/cost facts, and residual model judgment.
- The table marks observed facts as tool/workflow/collector/runtime owned and leaves only finding severity/rationale as model judgment.

## Verification

- Timeline/component tests for new labels.
- Contract-audit tests for path language.
- Snapshot or fixture tests for old and new events.
- One end-to-end workflow fixture showing read, write, normalized path, observed changed file, and successful guard.

Latest verification:

- `pnpm test apps/web/src/components/detail/components/timeline/MiscEvents.test.tsx core/agent-runtime/path-drift-report.test.ts core/agent-runtime/operational-fact-owners.test.ts core/agent-runtime/skill-contract-audit.test.ts`
- `pnpm typecheck`

Next unchecked slice: none.
