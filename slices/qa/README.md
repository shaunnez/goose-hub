# slices/qa

QA holdout workflow. Handles work items in `factory:needs-qa` state.

## What it does

Invokes the `qa` skill (holdout agent) to independently verify a PR against its acceptance criteria using a three-tier framework (structural, functional, regression). Based on the verdict and quality score, transitions the issue to:

- `factory:needs-review` — pass, or partial with score >= 70
- `factory:qa-failed` — fail, or partial with score < 70
- `factory:needs-human` — on runtime error

## Holdout discipline

`freshContext: true` is mandatory. The QA agent never sees developer decision summaries or investigation findings. It only receives the original issue (`workItem`), the PR diff (`prDiff`), and project commands (`projectCommands`).

## Files

- `workflow.ts` — `runQaWorkflow(workItem, stateSource, projectId, targetRepo, deps?)`
- `slice.test.ts` — unit tests (mocked runtime)
- `README.md` — this file

## Skill

Uses `skills/qa/` — see `skills/qa/skill.md` for the prompt and `skills/qa/schema.ts` for `QaOutputSchema`.

## Entry point (server)

`POST /:slug/run-qa` in `apps/server/src/domains/workflows/router.ts` dispatches to `qa-batch.ts`, which filters open work items by state and calls this workflow for each.
