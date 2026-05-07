# skills/scout-schema

Wave-1 scout: locate DB schema, Zod schemas, and TypeScript boundary types relevant to a work item.

Read-only. Returns a flat list of `{file, line, fact, confidence}` findings with no synthesis. Synthesis happens in Wave 2 (`wave2-interface-designer`).

| File | Purpose |
|---|---|
| `prompt.md` | System prompt: discipline + decision-summary expectations |
| `schema.ts` | Re-exports the canonical `ScoutOutputSchema` from `core/agent-runtime/scout-output.ts` |
| `skill.config.ts` | `read` bundle, `freshContext: true`, `role: investigator`, haiku-tier |
| `slice.test.ts` | Schema acceptance + config invariants |

Dispatched by `dispatchWave` in `core/agent-runtime/swarm.ts` (M19.01, ADR 0030). Each scout spawn routes through `assembleSpawnContext()` so context isolation is enforced at the same gateway as every other agent.
