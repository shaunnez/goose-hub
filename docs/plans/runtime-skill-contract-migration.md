# Runtime skill contract migration

## Context

Goose Hub runtime skills use three related contracts:

- **Input context contract**: `skill.config.ts` declares `contextSchema` and `contextAllowlist`; `core/agent-runtime/context-renderer.ts` renders allowed context keys into a `<task>` XML block.
- **Prompt contract**: `skills/<name>/prompt.md` tells the model which context tags to read and what JSON to return.
- **Output contract**: `skills/<name>/schema.ts` defines the Zod output shape. Runtime output is parsed as JSON and workflow code consumes object fields, not XML tags.

Current drift exists because many prompts describe snake_case tags such as `<work_item>` and `<worktree_path>`, while the renderer emits camelCase tags based on allowlist keys such as `<workItem>` and `<worktreePath>`. Some prompts also contain output examples and contract wording that should be audited against their `schema.ts` and downstream consumers.

This plan is intentionally iterative. When the human says **"continue the plan"**, complete the next unchecked chunk only, update this document, and stop.

## Decisions locked

- Scope is Goose Hub runtime skills under `skills/*`, not external local agent skills.
- Canonical naming style is **camelCase** for rendered XML input tags and JSON output fields.
- Keep the current renderer behavior for now. Dotted allowlists still render JSON inside a top-level tag, e.g. `<workItem>{"title":"..."}</workItem>`, not nested XML.
- Full sweep includes prompt input tags, prompt output examples, Zod schemas, workflow consumers, mock outputs, and tests.
- Output field renames are allowed when they improve code quality.
- Output renames are **hard migrations** within a workflow-family batch: no compatibility aliases unless a later decision explicitly changes this.
- Prompt cleanup is contract-only. Do not do broader prompt behavior rewrites during this migration.
- Work is split by workflow family, not as one giant code PR.
- Add an ADR and a `CONTEXT.md` summary for the durable contract rules.
- Add audit tooling first. It should start advisory, then become enforced family-by-family.

## Resume Rule

When asked to **continue the plan**:

1. Read this file.
2. Find the first unchecked chunk in "Ordered chunks".
3. Complete only that chunk.
4. Update the chunk checkbox and any relevant notes in this file.
5. Run that chunk's verification commands.
6. Stop and report what changed plus the next unchecked chunk.

If the working tree has unrelated user changes, do not revert them. Work around them or stop only if they make the next chunk impossible.

## Contract Rules

### Input Context

- `skill.config.ts` is the source of truth for context shape and allowlisted rendered tags.
- Prompt references to context tags must match rendered tag names exactly.
- Use camelCase tag names matching `contextAllowlist`: `<workItem>`, `<worktreePath>`, `<advisorFeedback>`, `<revisionPass>`, `<scoutReports>`.
- Since renderer output is not nested XML today, prompts should describe object-valued tags as JSON payloads inside a tag.
- Do not introduce a snake_case alias layer in the renderer.

### Output JSON

- `schema.ts` is the source of truth for output shape.
- Prompt output examples must match `schema.ts` exactly.
- Workflow consumers must parse or type against the same schema shape.
- Mock outputs and fixtures must be updated in the same batch as schema changes.
- Do not rename an output field in a prompt without updating schema, consumers, mocks, and tests in the same chunk.

### XML-Style Delimiters

Use XML-style delimiters where they clarify a contract boundary:

- input context tags,
- reusable templates,
- output JSON examples,
- non-negotiable rule blocks,
- holdout/fresh-context boundary descriptions.

Do not wrap ordinary prose or every Markdown section in XML. Markdown headings remain the default for process instructions.

## Initial Inventory Targets

Known high-signal files and families to audit first:

- `core/agent-runtime/context-renderer.ts`
- `core/agent-runtime/context-assembly.ts`
- `core/agent-runtime/invoke-skill.ts`
- `core/agent-runtime/claude-cli.ts`
- `core/agent-runtime/codex-parser.ts`
- `core/agent-runtime/mock-outputs.ts`
- `skills/*/prompt.md`
- `skills/*/schema.ts`
- `skills/*/skill.config.ts`
- `core/workflows/**`
- `slices/**/workflow.ts`
- `apps/server/src/domains/**`

Known prompt/config drift examples:

- `skills/implement/prompt.md`
- `skills/investigate/prompt.md`
- `skills/grill-me/prompt.md`
- `skills/write-prd/prompt.md`
- `skills/spec-author/prompt.md`
- `skills/scout-*/prompt.md`
- `skills/wave2-*/prompt.md`
- `skills/retrospective-*/prompt.md`
- `skills/evidence-post/prompt.md`
- `skills/playwright-repro/prompt.md`
- corresponding `skill.config.ts` comments that still document snake_case XML.

## Ordered Chunks

### [x] Chunk 1 - Runtime Contract Auditor, ADR, and Context Summary

Goal: create the safety net before changing skill families.

Build one shared implementation that can be used by both a script and a Vitest test.

Recommended shape:

- `core/agent-runtime/skill-contract-audit.ts`
- `scripts/audit-skill-contracts.ts`
- focused test near `core/agent-runtime/` or `skills/`
- `docs/adr/00XX-runtime-skill-contracts.md`
- `CONTEXT.md` update summarizing the canonical rules

Auditor v1 should report:

- rendered input tag names from `contextAllowlist`,
- prompt references to XML-ish context tags,
- snake_case context references,
- schema field names from each skill output schema where feasible,
- likely workflow consumers of each output schema by searching schema imports and `safeParse(result.output)` sites.

Enforcement v1:

- advisory by default,
- deterministic tag drift can be fail-capable per family once that family is marked clean,
- consumer inventory is report-only until a later chunk makes it reliable enough to enforce.

Acceptance criteria:

- Script prints a readable per-skill report.
- Test can run without forcing all currently dirty families to pass.
- ADR records camelCase, hard migration, family batching, and renderer-stability decisions.
- `CONTEXT.md` has a short operational summary for future agents.

Verification:

```bash
pnpm test core/agent-runtime
pnpm tsx scripts/audit-skill-contracts.ts
```

Completed 2026-05-15:

- Added shared auditor implementation at `core/agent-runtime/skill-contract-audit.ts` with per-skill reporting for allowlist tags, prompt tags, snake_case tags, schema fields, and likely consumers.
- Added script entrypoint at `scripts/audit-skill-contracts.ts` (advisory default, `--strict` snake_case failure mode scaffold).
- Added non-blocking Vitest coverage in `core/agent-runtime/skill-contract-audit.test.ts`.
- Added ADR `docs/adr/0041-runtime-skill-contracts.md`.
- Updated `CONTEXT.md` with the operational runtime-skill contract summary.

### [x] Chunk 2 - Grill / PRD / Decompose / Advisor Family

Skills:

- `grill-me`
- `write-prd`
- `advise-on-prd`
- `decompose-issues`
- `advise-on-plan`

Primary consumers:

- `core/workflows/grill-and-prd/grill-round.ts`
- `core/workflows/grill-and-prd/prd-draft.ts`
- `core/workflows/grill-and-prd/advisor-review.ts`
- `core/workflows/decompose-prd.ts`
- `core/agent-runtime/advisor.ts`
- related mock outputs and slice tests

Acceptance criteria:

- Prompt context tags are camelCase and match `contextAllowlist`.
- Prompt output examples match Zod schemas.
- Any output field rename is hard-migrated through schema, consumers, mocks, and tests.
- Auditor marks this family clean.

Verification:

```bash
pnpm test skills/grill-me skills/write-prd skills/advise-on-prd skills/decompose-issues skills/advise-on-plan
pnpm test core/workflows/grill-and-prd core/workflows/decompose-prd.test.ts
pnpm tsx scripts/audit-skill-contracts.ts
```

Completed 2026-05-18:

- Updated `grill-me`, `write-prd`, `advise-on-prd`, `decompose-issues`, and `advise-on-plan` prompt input contracts to use camelCase rendered XML tags.
- Clarified object-valued tags as JSON payloads inside top-level tags, matching current renderer behavior.
- Updated the `advise-on-plan` config comment to document rendered camelCase tags.
- Refined the auditor to compare context tags rather than placeholder/example angle brackets, and added a test that keeps this family clean while later families remain advisory.
- Verified the planned `core/workflows/decompose-prd.test.ts` path does not exist; ran `slices/decompose-prd` as the available decompose workflow coverage.

### [x] Chunk 3 - Investigate / Scout / Wave / Spec-Author Family

Skills:

- `investigate`
- `scout-code-path`
- `scout-dependency`
- `scout-pattern`
- `scout-schema`
- `scout-test-inventory`
- `scout-user-journey`
- `wave2-interface-designer`
- `wave2-risk-analyst`
- `spec-author`

Primary consumers:

- `slices/investigate/workflow.ts`
- `core/agent-runtime/scout-runner.ts`
- `core/agent-runtime/swarm.ts`
- `slices/spec-author/workflow.ts`
- scout report repositories and mock outputs

Acceptance criteria:

- All prompt references use camelCase rendered tags: `workItem`, `worktreePath`, `scoutReports`, `scoutFocus`, `wave2Reports`, `investigationSynthesis` where applicable.
- Wave handoff prompts and schemas agree on field names.
- Scout output fields remain aligned with `ScoutOutputSchema` and consumers.
- Auditor marks this family clean.

Verification:

```bash
pnpm test skills/investigate skills/scout-code-path skills/scout-dependency skills/scout-pattern skills/scout-schema skills/scout-test-inventory skills/scout-user-journey skills/wave2-interface-designer skills/wave2-risk-analyst skills/spec-author
pnpm test core/agent-runtime/scout-runner.test.ts core/agent-runtime/swarm.test.ts slices/investigate slices/spec-author
pnpm tsx scripts/audit-skill-contracts.ts
```

Completed 2026-05-18:

- Updated `investigate`, all Wave-1 scout prompts, Wave-2 prompts, and `spec-author` to reference camelCase rendered context tags.
- Clarified JSON-in-tag payloads for `workItem`, `scoutReports`, `wave2Reports`, `investigationSynthesis`, and related object-valued tags.
- Updated stale snake_case rendered-tag comments in `investigate`, `scout-schema`, `wave2-interface-designer`, and `spec-author` configs.
- Added `symbolIndexHints` to `scout-code-path` config because `scout-runner` already permits and injects that top-level rendered context key.
- Added a focused auditor test that keeps the investigate/scout/wave/spec-author family clean while later families remain advisory.
- Verified the planned `core/agent-runtime/scout-runner.test.ts` path does not exist; ran the available `swarm`, `slices/investigate`, and `slices/spec-author` coverage.

### [x] Chunk 4 - Implement / QA / Review / Evidence Family

Skills:

- `implement`
- `implement-wp`
- `qa`
- `review`
- `dev-review`
- `dev-review-response`
- `evidence-post`
- `playwright-repro`
- `resolve-conflict`

Primary consumers:

- `slices/fix-issue/workflow.ts`
- `slices/fix-feedback/workflow.ts`
- `slices/parallel-implement/workflow.ts`
- `slices/parallel-implement/wp-builder.ts`
- `slices/qa/workflow.ts`
- `slices/review/workflow.ts`
- `slices/review/convergent-review.ts`
- `core/agent-runtime/dev-review-advisor.ts`
- `slices/resolve-conflict/workflow.ts`

Acceptance criteria:

- Prompts use camelCase input tags and accurately describe JSON-in-tag payloads.
- Output examples match schema field names exactly.
- Evidence, QA, and review outputs stay aligned with workflow consumers.
- Any schema rename is migrated through mock outputs and tests.
- Auditor marks this family clean.

Verification:

```bash
pnpm test skills/implement skills/implement-wp skills/qa skills/review skills/dev-review skills/dev-review-response skills/evidence-post skills/playwright-repro skills/resolve-conflict
pnpm test slices/fix-issue slices/fix-feedback slices/parallel-implement slices/qa slices/review slices/resolve-conflict core/agent-runtime/dev-review-advisor.test.ts
pnpm tsx scripts/audit-skill-contracts.ts
```

Completed 2026-05-18:

- Updated `implement`, `implement-wp`, `qa`, `review`, `dev-review`, `dev-review-response`, `evidence-post`, and `playwright-repro` prompts to use camelCase rendered context tags.
- Clarified object-valued tags as JSON payloads for work items, stack/project commands, diffs, QA verdicts, dev-review findings, and evidence context.
- Updated stale snake_case rendered-tag examples in `implement`, `qa`, `review`, and `evidence-post` configs.
- Added `testRun` to the QA config source-of-truth because the QA workflow already passes and allowlists workflow-captured test results.
- Added `appUrl` to the `playwright-repro` config source-of-truth because the investigate workflow already injects it for repro capture.
- Tightened QA output examples so error-severity findings include the required disposition fields.
- Added a focused auditor test that keeps the implement/QA/review/evidence family clean while later families remain advisory.

### [x] Chunk 5 - Retrospective / Audit / Coach / Sprint Family

Skills:

- `retrospective-light`
- `retrospective-deep`
- `retrospective-cross-run`
- `code-quality-audit`
- `skill-coach`
- `sprint-review`
- `bug-enhance`
- `repo-match`
- `triage`
- `echo-test`
- `echo-test-holdout`

Primary consumers:

- `core/workflows/retrospective.ts`
- `core/workflows/cross-run-retro.ts`
- `core/workflows/skill-coaching.ts`
- `core/workflows/sprint-review.ts`
- `core/audit/run-audit.ts`
- `apps/server/src/domains/inbox/enhance.ts`
- `apps/server/src/domains/workflows/triage-batch.ts`
- `core/agent-runtime/mock-outputs.ts`

Acceptance criteria:

- Prompt context tags and output examples are camelCase and schema-aligned.
- Retrospective and coaching outputs stay aligned with persistence and event payload consumers.
- Triage/repo-match/bug-enhance output fields remain clear and TypeScript-native.
- Auditor marks this family clean.

Verification:

```bash
pnpm test skills/retrospective-light skills/retrospective-deep skills/retrospective-cross-run skills/code-quality-audit skills/skill-coach skills/sprint-review skills/bug-enhance skills/repo-match skills/triage skills/echo-test skills/echo-test-holdout
pnpm test core/workflows/retrospective.ts core/workflows/cross-run-retro.test.ts core/workflows/skill-coaching.ts core/workflows/sprint-review.test.ts core/audit/run-audit.test.ts apps/server/src/domains/inbox apps/server/src/domains/workflows/triage-batch.test.ts
pnpm tsx scripts/audit-skill-contracts.ts
```

Completed 2026-05-18:

- Updated retrospective, cross-run, code-quality-audit, skill-coach, bug-enhance, repo-match, and triage prompts to use camelCase rendered context tags.
- Clarified JSON-in-tag payloads for retrospective summaries, persona lists, role trends, audit metrics, cross-run playbook inputs, coaching evidence, and triage/repo-match work items.
- Aligned retrospective skill configs with the workflow-provided `activePersonas` and `roleTrends` context.
- Passed `triggerReasons` into deep retrospectives and kept it out of light retrospective rendered context.
- Added a focused auditor test that keeps the retrospective/audit/coach/sprint family clean while final enforcement remains in Chunk 6.
- Ran additional available retrospective and sprint-trigger coverage because two planned verification paths are source files rather than test files.

### [x] Chunk 6 - Final Enforcement Pass

Goal: turn the advisory audit into a real guardrail for all runtime skills.

Acceptance criteria:

- All runtime skills pass prompt/config tag drift checks.
- All prompt output examples match schemas, or the auditor documents why a prompt has no parseable example.
- Consumer inventory is available in the report for every schema-backed skill.
- CI/test command fails on new snake_case context tags and known deterministic drift.
- `docs/plans/runtime-skill-contract-migration.md` records all chunks complete.

Verification:

```bash
pnpm tsx scripts/audit-skill-contracts.ts --strict
pnpm test
pnpm typecheck
pnpm lint
```

Completed 2026-05-18:

- Tightened `scripts/audit-skill-contracts.ts --strict` so deterministic context-tag drift now fails on snake_case prompt tags, missing allowlisted prompt references, and extra prompt context tags.
- Added a global `skill-contract-audit` test that runs under `pnpm test` and enforces deterministic context-tag drift checks for every runtime skill.
- Extended the audit report with output-example status fields, parseable example counts, best-effort schema field inventory, and targeted consumer inventory per schema-backed skill.
- Left output-example/schema checks report-only where schema extraction is not reliable for unions, intersections, shared schemas, or prompts without parseable JSON examples.
- Verified all runtime skills now pass strict prompt/config tag drift checks.

## Non-Goals

- Do not change the renderer to nested XML in this migration.
- Do not add backward-compatible output aliases.
- Do not rewrite prompt behavior beyond contract clarity.
- Do not include external local skills under `~/.agents/skills`.
- Do not use this plan to redesign model selection, budgets, or tool bundles.

## Notes for Future Chunks

- If a family has no output schema configured in `skill.config.ts`, still audit its local `schema.ts` and downstream validation sites before changing output examples.
- `invokeSkill()` validates output only when `skill.config.ts` declares `outputSchema`; some workflows still validate manually after `result.output`.
- `core/agent-runtime/mock-outputs.ts` is part of the contract surface. Update it in the same chunk as schema or prompt output changes.
- Prefer small, mechanical field renames with targeted tests over broad cleanup.
- If an output field name is merely imperfect but widely consumed and not misleading, leave it alone unless there is a concrete quality reason to rename it.
