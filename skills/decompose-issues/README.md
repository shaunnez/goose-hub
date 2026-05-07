# skills/decompose-issues

Turns a PRD's slice outlines into concrete GitHub issue bodies. Produces structured output conforming to `DecomposeOutputSchema`.

## Inputs

`contextSchema` (`DecomposeIssuesContextSchema`) requires:

| Field | Type | Description |
|-------|------|-------------|
| `parentIssue.number` | `number` | GitHub issue number of the parent PRD/epic |
| `parentIssue.title` | `string` | Title of the parent PRD/epic issue |
| `parentIssue.body` | `string` | Body of the parent PRD/epic issue |
| `prdOutput` | `unknown` | PRD output from the `write-prd` skill (validated by workflow before passing in) |

## Outputs

`DecomposeOutputSchema`:

| Field | Type | Description |
|-------|------|-------------|
| `issues` | `DecomposedIssue[]` | Array of generated GitHub issue specs |
| `decisionSummaries` | `DecisionSummary[]` | Per-decision audit trail (min 1) |

### `DecomposedIssue`

| Field | Type | Description |
|-------|------|-------------|
| `title` | `string` | Issue title (imperative, includes milestone prefix) |
| `body` | `string` | Full GitHub issue body (Markdown with `## Context`, `## Acceptance criteria`, `## Depends on`) |
| `labels` | `string[]` | GitHub label names to apply (defaults: `factory:accepted`, `type:feature`, `priority:medium`, `schedule:current`, `exec:serial`) |
| `dependsOn` | `number[]` | 0-based indices of prior sibling issues in this batch that must complete first (no forward refs) |

### `dependsOn` constraint

Every entry `n` in `dependsOn` for issue at index `i` must satisfy `n < i`. Forward references (including self-references) are rejected by the schema's `.superRefine` rule.

## Decision-summary kinds

The `kind` field on each `decisionSummaries` entry is constrained to `DecisionKindSchema` in `core/agent-runtime/decision-types.ts` (see ADR 0018). This skill most commonly emits:

| Kind | Trigger |
|------|---------|
| `PLAN` | Initial decomposition strategy — how slices were divided from the PRD |
| `IMPLEMENTATION_PLAN` | When sequencing dependencies between slices were inferred |
| `SCOPE_CHANGE` | When the final issue list diverges from the PRD slice count or boundaries |
| `VERDICT` | Final summary of the decomposed issue list |
