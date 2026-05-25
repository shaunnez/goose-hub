# core/findings

Shared Zod schema for holdout-emitted findings. QA and Review re-export `DispositionSchema` from here so the two skills cannot drift on what counts as a recorded disposition.

## Exports

### `DispositionSchema` / `Disposition`

`z.enum(['fixed', 'needs-fix', 'out-of-scope', 'follow-up'])`. Every error-severity QA finding and every blocker-severity Review finding must declare one of these:

- **`fixed`** — addressed in this PR. `dispositionRef` is the commit SHA.
- **`needs-fix`** — in scope for this story/PR and must enter the repair loop.
- **`out-of-scope`** — not in scope for this issue. `dispositionRef` is a one-sentence rationale.
- **`follow-up`** — filed as a follow-up issue. `dispositionRef` is the issue number (`#234`).

### `DISPOSITIONS`

Readonly array of the enum options, for UI rendering and validation.

## Holdout note

QA and Review only *record* findings and the chosen disposition. They never file the follow-up issue themselves — the orchestrator (or the human reviewer in supervised mode) is responsible for actually creating `follow-up` issues. See FACTORY_RULES rule 1.
