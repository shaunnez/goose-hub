# skills/scout-test-inventory

Wave-1 scout: catalog existing tests covering the work-item area.

| File | Purpose |
|---|---|
| `prompt.md` | Inventory discipline + decision-summary expectations |
| `schema.ts` | Re-exports `ScoutOutputSchema` |
| `skill.config.ts` | `read` bundle, `freshContext: true`, haiku-tier |
| `slice.test.ts` | Schema acceptance + config invariants |

Dispatched by `dispatchWave` (M19.01, ADR 0030).
