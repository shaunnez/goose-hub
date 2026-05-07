# slices/claude-md-auditor

CLAUDE.md auditor — create and diff. Closes M12.02 (#303).

## What it does

Given a repository path and detected stack information, the auditor determines
whether a `CLAUDE.md` file needs to be created, updated, or left as-is:

- **No `CLAUDE.md`** → generates a fully-populated template (`action='create'`)
- **Partial `CLAUDE.md`** (missing required sections) → produces a unified diff
  showing additions only; never overwrites the existing file (`action='update'`)
- **Complete `CLAUDE.md`** (all required sections present) → returns `action='ok'`
  with empty content

## Vertical surfaces touched

- **Core lib**: `core/bootstrap/claude-md-auditor.ts`
  - `auditClaudeMd(repoPath, stackInfo)` — main entry point
  - `AuditResult` — typed result `{ action, content, rationale }`
  - `StackInfo` — local type (to be reconciled with M12.01 stack-detector in #307)

## Required sections

The auditor checks for these `## ` headings:

| Heading | Description |
|---------|-------------|
| `What this repo is` | Project description placeholder |
| `Stack` | Technology list with detected stack type |
| `Commands` | Lifecycle commands (build/test/lint/typecheck/e2e) |
| `Hard rules` | Factory governance reminders |
| `PR conventions` | PR title + body format requirements |

## AuditResult shape

```typescript
type AuditResult = {
  action: 'create' | 'update' | 'ok';
  content: string;   // template (create) | unified diff (update) | '' (ok)
  rationale: string; // human-readable explanation
};
```

## Diff format

The diff uses standard unified diff markers (`---`, `+++`, `@@`) and is
addition-only (no deletions). It is human-readable and can be rendered
directly in the UI or in a bootstrap PR description.

## Test fixtures

| Fixture | Purpose |
|---------|---------|
| `fixtures/no-claude-md/` | Empty directory — no CLAUDE.md present |
| `fixtures/partial-claude-md/CLAUDE.md` | Has `What this repo is` and `Stack` only |
| `fixtures/complete-claude-md/CLAUDE.md` | Has all five required sections |

## Running the tests

```bash
pnpm vitest run slices/claude-md-auditor/slice.test.ts
```

No live filesystem writes — the auditor never mutates disk. All scenarios use
the fixture directories above as read targets.
