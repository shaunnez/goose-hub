# skills/review

The **Review holdout skill** is the final gate before a PR is approved. It runs after QA passes and independently verifies that the PR satisfies every acceptance criterion in the original GitHub issue.

## Purpose

Review exists to enforce acceptance criteria — not code quality (that's QA's job). It answers one question: **does this PR do what the issue asked?**

Review is a holdout agent. It runs with `freshContext: true` and has no access to developer reasoning, implementation decisions, or investigation findings. It only sees:

1. The original issue (`workItem`)
2. The PR diff (`prDiff`)
3. The QA verdict for context (`qaVerdict`, optional)

This isolation is deliberate. The Review agent must form its own independent judgement, not validate the developer's self-assessment.

## Holdout discipline

Review and QA are the two holdout roles in the Factory workflow. Holdout means:

- The agent starts every run with a clean slate (no conversation history)
- The `contextAllowlist` explicitly excludes developer decision summaries and investigation findings
- The agent cannot be told "the developer said X" — it must verify from the artifact (the diff) alone

Violating holdout discipline — passing developer reasoning into the Review context — defeats the purpose of the review stage. The orchestrator enforces `contextAllowlist` at the AgentSpec level.

## Verdict table

| Verdict | When it triggers | Action |
|---------|-----------------|--------|
| `approved` | All criteria `met`, no blockers, confidence ≥ 0.7 | PR is ready to merge |
| `needs-fix` | Any criterion `unmet`, confidence ≥ 0.5, issue is fixable | Developer addresses findings and re-submits |
| `needs-human` | Confidence < 0.5 on any unclear criterion, OR security/architecture concern, OR ambiguous spec | Human reviewer steps in to decide |

The reviewer never produces `approved` by default. It is a positive assertion that requires all criteria to be explicitly verified as `met`.

## Context allowlist

The following keys are permitted in the Review agent's context:

| Key | Description |
|-----|-------------|
| `workItem` | Original GitHub issue: title, body (with checkboxes), number |
| `prDiff` | Complete git diff of the PR |
| `qaVerdict` | QA outcome (verdict + overallScore) — context only, not directive |

The following keys are **explicitly excluded** and must never be added:

| Key | Why excluded |
|-----|-------------|
| `devDecisionSummaries` | Developer reasoning — holdout discipline |
| `investigationFindings` | Root-cause analysis — holdout discipline |
| `implementationNotes` | Any form of developer intent — holdout discipline |

## Acceptance criteria verification

The Review agent parses every `- [ ]` checkbox from `workItem.body` and verifies each one independently against the diff. Pre-checked `- [x]` boxes are also verified — the agent does not trust that the developer checked them correctly.

For each criterion, the agent records a `CriterionCheck`:

```typescript
{
  criterion: string;       // the criterion text
  status: 'met' | 'unmet' | 'unclear';
  notes?: string;          // optional evidence or explanation
}
```

**All criteria must be checked.** The agent never skips a criterion, even if it seems obviously satisfied.

## Finding severities

| Severity | Meaning | Effect on verdict |
|----------|---------|------------------|
| `blocker` | Must fix — criterion unmet or structural violation | Forces `needs-fix` or `needs-human` |
| `major` | Should fix — meaningful risk or ambiguity | May force `needs-human` if confidence drops |
| `minor` | Nice to fix — low-impact quality improvement | Does not block `approved` |

Review findings use different severity labels from QA findings (`blocker/major/minor` vs. QA's `error/warning/info`). This distinction is intentional — Review is about acceptance criteria, QA is about code quality.

## Escalation policy

`needs-human` is triggered when the Review agent cannot make a confident decision. Common escalation triggers:

1. **Low confidence** — confidence falls below 0.5 on any unmet or unclear criterion
2. **Ambiguous spec** — the issue body does not clearly define what "done" looks like
3. **Security concern** — credentials in diff, overly permissive access, sensitive data exposure
4. **Architectural concern** — change contradicts `FACTORY_RULES.md` or `CONTEXT.md` in a way that requires human judgement
5. **Scope concern** — the diff appears to do more (or less) than the issue specifies

When `needs-human` is returned, the `escalationReason` field is **mandatory** and must contain a clear, actionable description of what question the human reviewer needs to answer. An empty or vague `escalationReason` is a schema validation failure.

## Schema

Output is validated against `ReviewOutputSchema` in `schema.ts`. The schema uses a Zod `discriminatedUnion` on `verdict` so that `needs-human` structurally requires `escalationReason` — the other two verdicts do not have this field.

```typescript
import { ReviewOutputSchema, type ReviewOutput } from './schema.js';
```

## Config

```typescript
import config, { ReviewContextSchema } from './skill.config.js';
// config.freshContext === true
// config.role === 'reviewer'
// config.contextAllowlist === ['workItem', 'prDiff', 'qaVerdict']
```

## Tests

Run the slice tests:

```bash
pnpm test --reporter=json skills/review/slice.test.ts
```

Tests cover:
- All three verdicts (`approved`, `needs-fix`, `needs-human`)
- `needs-human` without `escalationReason` is rejected
- `criteriaChecks` status enum validation (`met`, `unmet`, `unclear`)
- `findings` severity enum validation (`blocker`, `major`, `minor`)
- `confidence` range validation (0.0–1.0)
- Config: `freshContext: true`, `role: 'reviewer'`
- Config `contextAllowlist` inclusions and exclusions
- Context schema validation (required and optional fields)
