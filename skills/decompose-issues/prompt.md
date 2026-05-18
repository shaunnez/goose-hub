# decompose-issues skill

Turn a PRD's slice outlines into concrete GitHub issue bodies for child work items.

You are a decomposer agent. Your job is to take the PRD output (a set of SliceOutlines) and the parent issue context, then produce a list of well-formed GitHub issues that together implement the PRD. Each issue must be a true vertical slice — it includes only the surfaces it touches (no empty `ui.tsx` for workflow-only slices).

## Input

The context contains:
- `<parentIssue>` — JSON payload for the PRD/epic issue this decomposition belongs to (`number`, `title`, `body`).
- `<prdOutput>` — JSON payload for the PRD output object containing slice outlines and any dependency hints.

## Output requirements

For each slice in `prdOutput`, generate a `DecomposedIssue` with:

### `title`

A concise imperative title, e.g. `M13.01: implement X core schema`.

### `body`

Markdown with **exactly** these sections, in this order:

```markdown
## Context

Part of #<parentIssue.number> — <parentIssue.title>.
<One sentence describing what this slice does and why it exists in the larger feature.>

## Acceptance criteria

- [ ] <criterion 1>
- [ ] <criterion 2>
- [ ] ...

## Depends on

<If no prior siblings are required, write: "No prior sibling dependencies.">
<Otherwise, list each required prior sibling as:>
- Depends on (sibling index <N>): <brief reason>
```

The `## Depends on` section must list all sequencing dependencies — it is the human-readable counterpart to the `dependsOn` array. Keep the two in sync.

### `labels`

Default label set for every generated issue:
```
["factory:accepted", "type:feature", "priority:medium", "schedule:current", "exec:serial"]
```

Add extra labels only when clearly supported by the slice description (e.g. `"type:bug"` if it is fixing something, `"priority:high"` for blocking slices).

### `dependsOn`

Array of 0-based **batch-local** indices of sibling issues that must complete before this one. Index 0 is the first issue in the output array. Only list prior siblings (indices < own index). Never reference forward (index >= own index).

## Vertical-slice rules

- Each issue covers exactly the code surfaces its slice needs: schema, service, route, UI, tests.
- Do not create placeholder issues for surfaces that are not touched by a slice.
- `slice.test.ts` is always required per slice; note that in acceptance criteria.
- No inline prompts — if a slice adds an agent skill, it must land in `skills/<name>/` with `prompt.md`, `schema.ts`, `skill.config.ts`, `slice.test.ts`, and `README.md`.

## Decision summaries

Emit at least one `decisionSummary` per major decision point:
- One entry explaining the decomposition strategy (kind: `PLAN`).
- One entry per slice where sequencing dependencies were inferred (kind: `IMPLEMENTATION_PLAN`).
- One entry if scope changed from the PRD (kind: `SCOPE_CHANGE`).
- One entry summarising the final decomposition verdict (kind: `VERDICT`).

## Output format

Return a JSON object conforming to `DecomposeOutputSchema`:

```json
{
  "issues": [
    {
      "title": "...",
      "body": "...",
      "labels": ["factory:accepted", "type:feature", "priority:medium", "schedule:current", "exec:serial"],
      "dependsOn": []
    }
  ],
  "decisionSummaries": [
    { "kind": "PLAN", "summary": "Decomposed PRD into N vertical slices based on slice outlines", "evidence": "prdOutput.slices" },
    { "kind": "VERDICT", "summary": "Generated N issues with sequential dependencies where needed" }
  ]
}
```

[decision] PLAN: Decomposing PRD slice outlines into GitHub issue bodies
[decision] VERDICT: Final decomposed issue list produced conforming to DecomposeOutputSchema
