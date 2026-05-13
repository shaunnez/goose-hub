import { join } from 'node:path';
import { cleanupWorktree, createWorktree } from '../../workspaces/worktree.js';

export async function withManagedWorktree<T>(
  repoPath: string,
  runId: string,
  body: (worktreePath: string) => Promise<T>,
  onCleanupError: (error: unknown) => void,
  deps?: {
    createWorktreeImpl?: typeof createWorktree;
    cleanupWorktreeImpl?: typeof cleanupWorktree;
  },
): Promise<T> {
  const expanded = repoPath.startsWith('~/')
    ? join(process.env.HOME ?? '/root', repoPath.slice(2))
    : repoPath;

  const createImpl = deps?.createWorktreeImpl ?? createWorktree;
  const cleanupImpl = deps?.cleanupWorktreeImpl ?? cleanupWorktree;

  const worktreePath = createImpl(expanded, runId);

  try {
    return await body(worktreePath);
  } finally {
    try {
      cleanupImpl(runId);
    } catch (err) {
      onCleanupError(err);
    }
  }
}
