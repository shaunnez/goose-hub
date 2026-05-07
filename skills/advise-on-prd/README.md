# skills/advise-on-prd

Reviews a PRD produced by `write-prd` for `priority:high` and `priority:critical` work items. Produces a typed verdict (`approve | revise`) and optionally patches only the changed sections.

## When this skill runs

- Triggered by the orchestrator after `write-prd` completes, before issue decomposition begins
- Only for `priority:high` and `priority:critical` work items (FACTORY_RULES rule 22)
- Subject to the workflow's `perAdvisorMaxUsd` budget check — the workflow skips this skill if the advisor budget is exhausted
- The skill itself does not gate on priority; it always runs when invoked

## Inputs

`AdvisePRDContextSchema`:

| Field | Type | Description |
|---|---|---|
| `prdOutput` | `unknown` | The PRD JSON produced by `write-prd`, conforming to `PRDOutputSchema` |
| `priority` | `'low' \| 'medium' \| 'high' \| 'critical'` | Work item priority (all values accepted; workflow gates on high/critical) |

## Outputs

`AdvisePRDOutputSchema`:

| Field | Type | Description |
|---|---|---|
| `verdict` | `'approve' \| 'revise'` | Advisor decision |
| `concerns` | `string[]` (max 5) | Actionable observations; may be non-empty even on `approve` (approved with notes) |
| `revisedSections` | `Record<string, string>` | Only changed section keys with rewritten content. MUST be `{}` when `verdict === 'approve'` |
| `decisionSummaries` | `DecisionSummary[]` (min 1) | Required per FACTORY_RULES rule 6 |

### Invariants

- `verdict === 'approve'` → `revisedSections` must be empty (enforced by `.superRefine`)
- `verdict === 'revise'` → `revisedSections` may be empty or contain only the changed sections (not a full PRD rewrite)
- `concerns` may be non-empty on either verdict

## Budget-gating

The orchestrator checks `perAdvisorMaxUsd` from the project config before invoking this skill. If the advisor budget is exhausted, the workflow skips this skill entirely and the `write-prd` output proceeds without advisor review. This is a workflow-level guard — the skill has no knowledge of it.

## Decision-summary kinds

| Kind | When to use |
|---|---|
| `VERDICT` | Always — one entry describing the overall verdict and primary rationale |
| `UNCERTAINTY` | When the advisor is unsure about a section's intent or scope |
| `SCOPE_CHANGE` | When the PRD appears to expand scope beyond the originating work item |

## Tool allowlist

`read` and `core` bundles — the advisor can inspect the codebase to validate PRD claims against actual patterns, but cannot write or execute.

## Fresh context

`freshContext: true`. The advisor sees only `prdOutput` and `priority`. No ambient event-stream entries, no persona history, no developer decision summaries. CONTEXT.md "Context Assembly and Holdout Enforcement".

## Model pin

`opus`. PRD advisors run in fresh context as higher-tier reviewers.

## Context allowlist

| Key | Included |
|---|---|
| `prdOutput` | yes |
| `priority` | yes |
