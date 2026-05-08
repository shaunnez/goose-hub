# skill: dev-review

Codex pre-QA dev-review skill (M19.11). Adversarial reading of the developer's diff before QA sees it. Findings flow back into the dev's next turn (M19.12 wires the workflow), but **never** into QA or Reviewer contexts.

## Position in the lifecycle

```
developer → DEV-REVIEW (this skill) → developer (one revision turn) → qa → reviewer
                       │
                       └── findings + verdict
                           visible to dev + retro
                           NEVER to QA / Reviewer (holdout-context-exclusion guard)
```

## Why it exists

Codex bots reviewing PRs on GitHub consistently surface real issues the dev cycle missed (correctness, edge cases, security, design — not style). Centralising this *inside* the dev cycle as an advisor gives us those findings without leaking implementation reasoning into the QA holdout.

The dev agent already self-scores against an 8-category 100-point quality rubric (`skills/implement/prompt.md`). Self-scoring is the dev's own perspective; dev-review is an independent re-read by a different model on a different provider.

## Files

```
skills/dev-review/
  prompt.md           — the agent prompt
  schema.ts           — Zod output schema (findings + verdict + decision summaries)
  skill.config.ts     — provider: 'codex', role: 'dev-reviewer', read-only tools, fresh context
  slice.test.ts       — schema validation, role registration, finding evidence requirement, holdout-exclusion guard
  README.md           — this file
  eval.json           — Layer-1 binary assertions (FACTORY_RULES eval framework)
```

## Holdout discipline

`dev-reviewer` is a registered role in `core/agent-runtime/roles.ts` but is NOT in the holdout set. The discipline is enforced at the **context-allowlist** layer:

- QA's `contextAllowlist` does not contain dev-review keys.
- Reviewer's `contextAllowlist` does not contain dev-review keys.
- `assembleSpawnContext()` exposes `assertHoldoutContextSafe(spec)` which, for holdout roles, hard-rejects forbidden dev-review keys regardless of allowlist composition. Defense in depth — even if a future caller adds `devReviewFindings` to QA's allowlist, the runtime emits `tool.violation` and strips the key.

The `DEV_REVIEW_*` decision-summary kinds (added in M19.12) are emitted into the event stream but never injected into holdout specs.

## Output schema

```ts
{
  verdict: 'no-blockers' | 'blockers-found' | 'inconclusive',
  findings: Array<{
    severity: 'P0' | 'P1' | 'P2' | 'P3',
    category: 'correctness' | 'security' | 'edge-case' | 'design' | 'other',
    file: string,    // required
    line: number,    // required (non-negative integer)
    summary: string, // one sentence
    suggestion: string,
  }>,
  decisionSummaries: Array<{ kind: DecisionKind, summary: string, evidence?: string }>,
}
```

`file` and `line` are required by the schema — findings without grounded evidence fail validation.

## See also

- ADR 0036 — Codex CLI runtime sibling and `runtime: 'auto'` dispatch (M19.10)
- ADR 0010 — Tool layer architecture (bundles, allowlists, holdout enforcement)
- ADR 0018 — Decision-kind taxonomy
- `skills/implement/prompt.md` — developer's self-scoring rubric (different perspective, same diff)
- `skills/review/` — Claude reviewer holdout (independent of dev-review)
- M19.12 issue (#596) — wires this skill into the implement workflow with a one-pass loop bound
