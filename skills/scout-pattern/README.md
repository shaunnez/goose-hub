# skills/scout-pattern

Wave-1 scout: find existing usages (and conspicuous absences) of a code pattern or idiom.

| File | Purpose |
|---|---|
| `prompt.md` | Pattern-search discipline + decision-summary expectations |
| `schema.ts` | Re-exports `ScoutOutputSchema` |
| `skill.config.ts` | `read` bundle, `freshContext: true`, haiku-tier |
| `slice.test.ts` | Schema acceptance + config invariants |

Dispatched by `dispatchWave` (M19.01, ADR 0030).
