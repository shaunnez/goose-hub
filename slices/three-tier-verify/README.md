# slices/three-tier-verify

Orchestrates Steve's 3-tier verification cascade (M19.05, issue #562).

## What it does

Runs verification in three sequential tiers — each must pass before the next is attempted:

| Tier | Question | Method |
|------|----------|--------|
| **1 — Structural** | Was the change executed? | File existence + interface-contract export checks |
| **2 — Functional** | Does the new code work? | Runs `spec.verificationTooling[]` scripts, checks exit codes |
| **3 — Regression** | Did anything break? | Full test suite + carry-forward WP failure check |

Source: `docs/steves-training-materials/Markdown Files/Autonomous Decelopment/03-lifecycle-harness.md:121-142`

## Key files

| File | Purpose |
|------|---------|
| `workflow.ts` | Tier cascade orchestrator — calls `core/verify/tiers.ts` in sequence |
| `slice.test.ts` | Golden tests per tier + end-to-end workflow test |
| `core/verify/tiers.ts` | Pure verification logic (no workflow state transitions) |

## Regression policy

Controlled by `ProjectConfig.regressionPolicy` (default `'escalate'`).  
See `docs/adr/0032-regression-policy.md` for the decision record.

| Policy | Tier-3 failure outcome |
|--------|----------------------|
| `escalate` (default) | Transition to `factory:needs-human` |
| `revert` | Transition to `factory:needs-human` (caller expected to revert WP commits first) |
| `ignore` | Log as warning; workflow continues as if passed |

## Events emitted

| Event kind | When |
|-----------|------|
| `qa.structural-passed` / `qa.structural-failed` | After Tier 1 |
| `qa.functional-passed` / `qa.functional-failed` | After Tier 2 |
| `qa.regression-passed` / `qa.regression-failed` | After Tier 3 |

## Imports

- `core/verify/tiers.ts` via `@goose-hub/core/verify/tiers.js`
- `core/event-stream/store.ts` for event emission
- `core/agent-comment/index.ts` for structured GitHub comments
