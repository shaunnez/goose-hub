# skills/scout-code-path

Wave-1 scout: trace the execution path of one symbol or function relevant to the work item.

Read-only. Returns `{file, line, fact, confidence}` findings with no synthesis. Synthesis happens in Wave 2.

| File | Purpose |
|---|---|
| `prompt.md` | System prompt: trace discipline + decision-summary expectations |
| `schema.ts` | Re-exports `ScoutOutputSchema` |
| `skill.config.ts` | `read` bundle, `freshContext: true`, `role: investigator`, haiku-tier |
| `slice.test.ts` | Schema acceptance + config invariants |

Dispatched by `dispatchWave` in `core/agent-runtime/swarm.ts` (M19.01, ADR 0030).
