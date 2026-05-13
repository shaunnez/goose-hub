# core/workspaces

Git worktree lifecycle management for Factory investigation runs.

## Files

| File | Exports |
|------|---------|
| `worktree.ts` | `createWorktree`, `cleanupWorktree`, `parseCloneUrl`, `ensureClonedRepo` |

## Interface

### `createWorktree(repoOrUrl, runId): string`

Creates a git worktree at `~/.factory/workspaces/<runId>/`.

- **`repoOrUrl`** — Absolute path to a local git repository, OR an SSH /
  HTTPS clone URL (M14.07 / #328). Clone URLs are recognised via
  `parseCloneUrl` and lazily cloned into
  `~/.factory/clones/<host>/<workspace>/<repoSlug>` if not already
  present. Bitbucket HTTPS URLs are authenticated by injecting
  `BITBUCKET_USER` / `BITBUCKET_APP_PASSWORD` from the environment; SSH
  URLs rely on the agent host's SSH key configuration.
- **`runId`** — Canonical workflow isolation key (ULID/UUID string). Matches the `runId` used by `AgentSpec`, events, and tool hooks.
- **Returns** — The absolute path to the created worktree (`~/.factory/workspaces/<runId>/`).
- **Throws** — If `git clone` (for URL inputs) or `git worktree add` fails (bad credentials, missing repo, etc.).

Internally uses `git worktree add --detach` so the worktree starts at the current HEAD without creating or checking out a branch. This avoids branch conflicts when multiple parallel runs use the same repo.

### `parseCloneUrl(url): ParsedCloneUrl | null`

Parse an SSH (`git@host:workspace/repo.git`) or HTTPS
(`https://host/workspace/repo.git`) git URL into its components. Returns
`null` for non-URL inputs so callers can treat the value as a local
path. The `isBitbucket` flag is set for `bitbucket.org` hosts and drives
credential injection in `ensureClonedRepo`.

### `ensureClonedRepo(cloneUrl): string`

Idempotent clone — clones the URL if no local copy exists at
`~/.factory/clones/<host>/<workspace>/<repoSlug>`, otherwise returns the
cached path. Used internally by `createWorktree` when given a URL.

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
