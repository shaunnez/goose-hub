# skills/scout-dependency

Wave-1 scout: map direct + first-tier transitive imports of a module.

| File | Purpose |
|---|---|
| `prompt.md` | Dependency-mapping discipline + decision-summary expectations |
| `schema.ts` | Re-exports `ScoutOutputSchema` |
| `skill.config.ts` | `read` bundle, `freshContext: true`, haiku-tier |
| `slice.test.ts` | Schema acceptance + config invariants |

Dispatched by `dispatchWave` (M19.01, ADR 0030).
