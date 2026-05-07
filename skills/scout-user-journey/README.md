# skills/scout-user-journey

Wave-1 scout: walk the user-facing flow (UI route, API surface, or CLI command) implicated by the work item.

| File | Purpose |
|---|---|
| `prompt.md` | Walk-discipline + decision-summary expectations |
| `schema.ts` | Re-exports `ScoutOutputSchema` |
| `skill.config.ts` | `read` bundle, `freshContext: true`, haiku-tier |
| `slice.test.ts` | Schema acceptance + config invariants |

Dispatched by `dispatchWave` (M19.01, ADR 0030).
