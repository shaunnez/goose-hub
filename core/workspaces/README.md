# core/workspaces

Git worktree lifecycle management for Factory investigation runs.

## Files

| File | Exports |
|------|---------|
| `worktree.ts` | `createWorktree`, `cleanupWorktree` |

## Interface

### `createWorktree(repo, runId): string`

Creates a git worktree for the given local repo at `~/.factory/workspaces/<runId>/`.

- **`repo`** — Absolute path to a local git repository (already cloned on disk).
- **`runId`** — Canonical workflow isolation key (ULID/UUID string). Matches the `runId` used by `AgentSpec`, events, and tool hooks.
- **Returns** — The absolute path to the created worktree (`~/.factory/workspaces/<runId>/`).
- **Throws** — If `git worktree add` fails (e.g. repo path is invalid or not a git repo).

Internally uses `git worktree add --detach` so the worktree starts at the current HEAD without creating or checking out a branch. This avoids branch conflicts when multiple parallel runs use the same repo.

### `cleanupWorktree(runId): void`

Removes the worktree directory at `~/.factory/workspaces/<runId>/`.

- **`runId`** — The same isolation key used in `createWorktree`.
- **Idempotent** — Calling this on a path that does not exist is a no-op (no error thrown).
- If `git worktree remove` fails (e.g. the backing git repo has already been deleted), the directory is still removed via `fs.rmSync` with `force: true`.

## Workspace path pattern

```
~/.factory/workspaces/<runId>/
```

All worktrees live under `~/.factory/workspaces/`. Each runId gets its own isolated subdirectory.

## Import path

```ts
import { createWorktree, cleanupWorktree } from '@goose-hub/core/workspaces/worktree.js';
```

## Usage example

```ts
import { createWorktree, cleanupWorktree } from '@goose-hub/core/workspaces/worktree.js';

// During investigation setup:
const wtPath = createWorktree('/path/to/cloned/repo', runId);
// wtPath === '~/.factory/workspaces/<runId>/'

// After investigation completes or errors:
cleanupWorktree(runId); // idempotent — safe to call multiple times
```
