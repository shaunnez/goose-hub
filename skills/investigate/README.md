# skills/investigate

Investigates a bug issue by reading the worktree with read/search tools, then produces structured findings conforming to `InvestigateSchema`.

## Role

`investigator` — opus-tier model. No advisor (PLAN.md: "no advisor on investigator, already opus-tier").

## Tool access

Read and search only (`toolBundles: ['read']` → maps to `['read', 'search', 'work-item-read']`). No write access.

## Inputs

`contextSchema` (`InvestigateContextSchema`) requires:

| Field | Type | Description |
|-------|------|-------------|
| `workItem.title` | `string` | Issue title |
| `workItem.body` | `string` | Issue body with reproduction steps |
| `workItem.number` | `number` | Issue number for reference |
| `worktreePath` | `string` | Absolute path to the checked-out worktree |

Context is delivered as structured XML:

```xml
<task>
  <work_item>
    <title>...</title>
    <body>...</body>
    <number>...</number>
  </work_item>
  <worktree_path>...</worktree_path>
</task>
```

## Outputs

`InvestigateSchema`:

| Field | Type | Description |
|-------|------|-------------|
| `findings` | `string` | Root cause hypothesis and analysis (2–5 paragraphs) |
| `keyFiles` | `KeyFile[]` | Files most relevant to the bug |
| `confidence` | `"low" \| "medium" \| "high"` | Confidence in root cause hypothesis |
| `openQuestions` | `string[]` | Unresolved questions requiring more investigation |
| `decisionSummaries` | `DecisionSummary[]` | Per-step audit trail (min 1) |

`KeyFile`:

| Field | Type | Description |
|-------|------|-------------|
| `path` | `string` | File path (relative or absolute) |
| `reason` | `string` | Why this file is relevant to the bug |

## Decision-summary pattern

The agent emits `[decision] <one sentence>` marker lines during its text turn after each major investigation step. These are parsed by the orchestrator and stored as `agent.decision-summary` events. They are NOT forwarded to QA or Reviewer agents.

Standard decision steps:

| Step | Trigger |
|------|---------|
| `issue-read` | After reading and understanding the issue |
| `entry-point-identification` | After identifying likely entry points |
| `code-path-trace` | After tracing the execution path through source files |
| `root-cause-hypothesis` | After forming the root cause hypothesis |

## Holdout discipline

The investigator is NOT a holdout role. Decision summaries are saved to the event stream but not forwarded to QA or Reviewer agents. Implementation reasoning stays in `decisionSummaries`, not in the `findings` field (which QA reads).
