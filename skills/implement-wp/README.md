# implement-wp skill

**Role:** Developer (WP builder)
**Model pin:** sonnet (orchestrator may upgrade to opus per WP `builderTier`)
**Tool bundle:** `dev-tools` + sandbox denylist `Bash(git *)` (hard git block, ADR 0031)
**Fresh context:** false

## What it does

Implements a single Work Package from an Engineering Spec. The builder receives only its WP
context (id, filesOwned, changes, dependencies, code snippets). It writes files, runs tests,
runs lint, then returns structured JSON. The orchestrator stages and commits the written files.

## What it never does

- `git commit`, `git add`, `git push`, `git checkout <branch>` — blocked at sandbox denylist
- Write files outside `wp.filesOwned` — blocked at `hooks/wp-file-guard.sh` PreToolUse hook
- See other WPs' context or the full engineering spec (holdout-style narrow context)

## Context inputs

| Field | Required | Description |
|-------|----------|-------------|
| `workItem.{title,body,number,priority}` | ✓ | Issue identity |
| `wp.id` | ✓ | Work Package identifier |
| `wp.filesOwned` | ✓ | Paths this WP may write |
| `wp.changes` | ✓ | What this WP must implement |
| `wp.dependsOn` | ✓ | Upstream WP ids (already committed) |
| `codeSnippets` | — | Relevant code excerpts from scout wave |
| `worktreePath` | ✓ | Absolute path to scratch worktree |
| `stack.testCommand` | ✓ | e.g. `pnpm test` |
| `stack.lintCommand` | — | e.g. `pnpm lint` |
| `stack.typecheckCommand` | — | e.g. `pnpm typecheck` |

## Output shape (`ImplementWpSchema`)

```typescript
{
  wpId: string;                                       // must match wp.id
  plan: string;                                       // markdown
  filesWritten: { path: string; reason: string }[];
  testsWritten: { path: string; cases: number }[];
  testsRun: { command: string; paths: string[] };
  confidence: 'low' | 'medium' | 'high';
  decisionSummaries: DecisionSummary[];               // ≥1
}
```

## Orchestrator contract (ADR 0031)

After this skill returns with a validated `ImplementWpSchema`:

1. Orchestrator calls `orchestratorCommitWp(worktreePath, filesOwned, commitMsg)`.
2. Commit SHA is recorded in the WP result.
3. On failure (schema validation fails / builder errors): orchestrator calls `revertWpChanges()`.

## Testing

See `slice.test.ts` — covers schema validation, context-allowlist enforcement, and the
file-guard hook integration (cross-WP write denial).
