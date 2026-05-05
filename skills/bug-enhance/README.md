# bug-enhance skill

Analyzes a UI/web bug report and appends structured sections (Repro steps, Expected, Actual, Location) that are absent or too vague.

## When it runs

Triggered at inbox promotion time when the user enables the "Enhance bug report" option. Runs synchronously before the GitHub issue is created, so the issue lands with full structure from the start.

## Input context

| Field | Description |
|---|---|
| `workItem.title` | Bug title from the inbox item |
| `workItem.body` | Bug body as typed by the user |

## Output

| Field | Description |
|---|---|
| `enhancedContent` | Markdown string containing only the new/missing sections |
| `decisionSummaries` | One entry describing which sections were added and what evidence drove inference |

## Behaviour

- Only adds sections that are genuinely missing or too vague.
- Assumes the app is served at `http://localhost:5173/`.
- Infers `Location` from component/UI element names in the bug text; falls back to the most likely directory.
- Never repeats content already present in the original body.

## Model / role

`sonnet` / `triager` — text-only analysis, no tool access needed.
