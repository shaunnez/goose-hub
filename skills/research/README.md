# research

Research answers what is true, what options exist, and what follow-up work may be needed for a `type:research` work item.

## Contract

| File | Purpose |
| --- | --- |
| `prompt.md` | Researcher instructions and explicit non-goals. |
| `schema.ts` | Structured research artifact emitted by the skill. |
| `skill.config.ts` | Read-only researcher runtime config. |
| `slice.test.ts` | Contract tests for schema and config. |

The skill runs with role `researcher`, read-only tools, and context limited to `workItem` plus an optional `scoutDigest`. It emits facts, options, follow-up candidates, actionability, open questions, and canonical decision summaries.

Final state routing is not part of this skill. The server dispatch for `factory:research-complete` decides whether the work item moves to `factory:dev-ready` or `factory:needs-human`.
