# idea-promotion-enhance skill

Enhances promoted inbox ideas for non-bug work-item types by appending structured markdown that makes a feature, chore, or research issue actionable before it is created.

## When it runs

Triggered at inbox promotion time when the operator enables enhancement for a `feature`, `chore`, or `research` promotion. It preserves the existing `bug-enhance` path for bug reports and only handles the non-bug branch.

## Input context

| Field | Description |
|---|---|
| `workItem.type` | Promotion type: `feature`, `chore`, or `research` |
| `workItem.title` | Promoted work-item title |
| `workItem.body` | Original idea body from the inbox item |

## Output

| Field | Description |
|---|---|
| `enhancedContent` | Markdown string containing only the new sections to append |
| `decisionSummaries` | One or more entries describing the framing that was added |

## Behaviour

- Rejects missing or unsupported promotion types through the context schema.
- Keeps the original body intact and returns only append-only enhancement content.
- Uses a different template for `feature`, `chore`, and `research` promotions.
- Avoids repeating information already present in the original body.

## Model / role

`sonnet` / `triager` — text-only enhancement with no tool access.
