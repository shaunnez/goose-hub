# bug-enhance skill

Enhances promoted inbox items by appending the missing structure before work-item creation. Bug promotions keep the existing UI/web-focused bug expansion, while feature, chore, and research promotions use type-specific templates.

## When it runs

Triggered at inbox promotion time when the user enables the enhancement option. Runs synchronously before the GitHub issue is created, so the issue lands with full structure from the start.

## Input context

| Field | Description |
|---|---|
| `workItem.title` | Inbox title |
| `workItem.body` | Inbox body as typed by the user |
| `workItem.type` | Validated promotion type: `bug`, `feature`, `chore`, or `research` |

## Output

| Field | Description |
|---|---|
| `enhancedContent` | Markdown string containing only the new or missing sections |
| `decisionSummaries` | Brief rationale describing which enhancement branch ran and what evidence drove the added structure |

## Behaviour

- `bug` keeps the UI/web classifier plus the structured `Repro steps`, `Expected`, `Actual`, and `Location` expansion.
- `feature` adds missing `Problem`, `Proposal`, `Acceptance clues`, and `Location` sections.
- `chore` adds missing `Why this maintenance matters`, `Scope`, `Completion signal`, and `Location` sections.
- `research` adds missing `Question`, `Why now`, `Suggested approach`, and `Definition of done` sections.
- Never repeats content already present in the original body.

## Model / role

`sonnet` / `triager` — text-only analysis, no tool access needed.
