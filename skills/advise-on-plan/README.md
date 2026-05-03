# skills/advise-on-plan

Reviews a developer's plan for `priority:high` and `priority:critical` work items before implementation begins. Produces a typed advisor verdict (`proceed | revise | abort`) per CONTEXT.md "Advisor Flow".

## When this skill runs

- Triggered by the orchestrator after the developer skill writes a plan but before it writes implementation
- Only for `priority:high` and `priority:critical` issues (FACTORY_RULES rule 22 — advisor disabled by default in autonomous mode; explicit opt-in per project)
- Not for `priority:medium` or `priority:low` (the developer ships without advisor review)
- Never for QA or Reviewer holdouts (FACTORY_RULES rule 20)

## Inputs

`AdviseOnPlanContextSchema`:

| Field | Type | Description |
|---|---|---|
| `workItem.title` | `string` | Issue title |
| `workItem.body` | `string` | Issue body (acceptance criteria) |
| `workItem.number` | `number` | Issue number |
| `workItem.priority` | `'high' \| 'critical'` | Constrained — orchestrator only invokes advisor for these two |
| `plan` | `string` | The developer's written plan, verbatim |
| `revisionPass` | `0 \| 1` (optional) | Advisor pass index. Omitted == 0. 1 means informed second pass. |
| `previousAdvisorFeedback` | `string` (optional) | Advisor's own pass-0 output, present only when `revisionPass === 1` |

## Outputs

`AdviseOnPlanSchema` is a discriminated union on `verdict`:

| Verdict | Required fields | Meaning |
|---|---|---|
| `proceed` | `confidence` | Plan is sound; primary continues |
| `revise` | `feedback` (non-empty), `confidence` | Plan has a fixable issue; primary re-spawned with feedback. Maximum **one** revise pass |
| `abort` | `reason` (non-empty), `confidence` | Plan is unsafe / out of scope; immediate human escalation. **Unconditional** — no revision pass |

All variants require `decisionSummaries: DecisionSummary[]` with at least one entry (FACTORY_RULES rule 6).

## Tool allowlist

`read` bundle only — `read`, `search`, `work-item-read`. The advisor reviews; it does not edit. Any write attempt is rejected at the runtime layer.

## Fresh context

`freshContext: true`. The advisor sees only the `<task>` XML built from `contextAllowlist`. No ambient event-stream entries, no persona history, no inbox notes, no developer decision-summaries from prior runs. CONTEXT.md "Context Assembly and Holdout Enforcement" — the advisor is structurally distinct from the holdouts (it CAN see its own pass-0 output on a revision pass), but it must not see the developer's reasoning.

## Model pin

`opus`. Advisors are higher-tier reviewers running in fresh context — sonnet is the routine implementation tier; opus is the advisor tier. CONTEXT.md "Model Tier Registry" + "Advisor Flow".

## Pass discipline

Per FACTORY_RULES rule 21 and CONTEXT.md state-machine table:

| Pass | Verdict | Action |
|---|---|---|
| 0 | proceed | Primary continues with original plan |
| 0 | revise | Primary re-spawned with feedback; advisor re-runs as pass 1 |
| 0 | abort | Escalate to human (`factory:needs-human`) |
| 1 | proceed | Primary continues with revised plan |
| 1 | revise | Escalate to human (both feedback rounds in comment) |
| 1 | abort | Escalate to human |

`abort` is categorically distinct from `revise`: "fixable, try again" vs. "unsafe, stop". Collapsing them destroys the safety signal.

## Eval

`eval/eval.json` covers the three verdict variants:
1. Plan that should pass (`proceed`)
2. Plan that duplicates an existing utility (`revise` with concrete feedback)
3. Plan that modifies a governance file (`abort` — never revisable)

## Context allowlist

| Key | Included |
|---|---|
| `workItem.title` | yes |
| `workItem.body` | yes |
| `workItem.number` | yes |
| `workItem.priority` | yes |
| `plan` | yes |
| `revisionPass` | yes |
| `previousAdvisorFeedback` | yes |
