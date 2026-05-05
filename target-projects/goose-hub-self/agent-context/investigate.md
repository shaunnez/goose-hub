## Codebase map — orient here first

```
core/
  agent-runtime/    — agent spawn, context assembly, Claude CLI wrapper, prompt loading
  event-stream/     — SQLite event log (store.ts = appendEvent)
  workflows/        — retrospective workflow
  connectors/       — GitHub API (open-pr.ts)
  persona/          — persona accumulation
  state-source/     — work item abstraction (StateSource interface)
  workspaces/       — worktree management (createWorktree, cleanupWorktree)
apps/
  server/           — Express API, SSE endpoint, workflow dispatch (shared/dispatch.ts)
  web/              — React + Vite + shadcn/ui frontend
slices/
  fix-issue/        — developer workflow (runFixIssueWorkflow)
  investigate/      — investigator workflow (runInvestigateWorkflow)
  qa/               — QA workflow (runQaWorkflow)
  review/           — reviewer workflow (runReviewWorkflow)
skills/             — skill.md prompts and Zod schemas
target-projects/    — per-project config
```

## Key patterns

- Events emitted via `eventStore.appendEvent(...)` in `core/event-stream/store.ts`
- Agent spawned via `AgentSpec` → `ClaudeCliRuntime.run()` in `core/agent-runtime/claude-cli.ts`
- Context filtering in `core/agent-runtime/context-assembly.ts` (holdout isolation here)
- Prompt loading: `readPromptWithContext(skillName, projectId)` in `core/agent-runtime/read-prompt.ts`
- State machine: GitHub label transitions via `StateSource` implementations

## Common bug locations

| Area | Where to look |
|---|---|
| Context leaking to holdouts | `core/agent-runtime/context-assembly.ts` — `renderManifest` |
| Wrong prompt content | `skills/<name>/skill.md` + `target-projects/goose-hub-self/agent-context/<name>.md` |
| Agent spawn config | Slice workflow file `slices/<name>/workflow.ts` |
| Test environment | Workspace `vitest.config.ts` and `apps/web/vitest.config.ts` |
| Worktree isolation | `core/workspaces/worktree.ts` |
