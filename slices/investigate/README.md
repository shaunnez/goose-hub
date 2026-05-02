# slices/investigate

Workflow slice that drives `type:bug` and `type:chore` work items through the investigation phase.

## State Transition

```
factory:investigating → factory:investigation-complete
factory:investigating → factory:needs-human  (on failure)
```

## Workflow Steps

1. **createWorktree** — Creates a detached git worktree of the target repo at `~/.factory/workspaces/<runId>/`
2. **investigate skill** — Runs the `investigate` skill (role: investigator, tier: opus) to analyse the codebase and produce structured findings
3. **playwright-repro skill** — If `workItem.type === 'bug'`, runs the `playwright-repro` skill (role: investigator, tool bundle: validate) to capture the before-state
4. **persist findings** — Appends `agent.investigation-complete` event with `{ investigate, playwrightRepro? }` payload
5. **transition state** — Moves the work item to `factory:investigation-complete`
6. **cleanupWorktree** — Always runs (finally block, idempotent)

## On Failure

If any step throws:
- `agent.run-failed` event is persisted
- A GitHub comment is posted: `Investigation failed: <error.message>`
- State transitions to `factory:needs-human`
- Worktree is cleaned up (finally block ensures this)

## Persona Routing

Uses `selectPersona(projectId, 'investigator')` for both the investigate and playwright-repro runs. Round-robin across 3 seeded personas per `(projectId, role)` pair.

## Event Payload

```ts
{
  kind: 'agent.investigation-complete',
  payload: {
    investigate: InvestigateOutput,    // always present
    playwrightRepro?: PlaywrightReproOutput,  // only for type:bug
  }
}
```

## Skills

- `skills/investigate/` — Static analysis, root-cause hypothesis, key file identification
- `skills/playwright-repro/` — Browser-based before-state capture (bug type only)

## Files

- `workflow.ts` — Main workflow implementation
- `slice.test.ts` — Unit tests covering happy path, bug type, failure path, and AgentSpec fields
- `README.md` — This file
