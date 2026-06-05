import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type AgentEvent, eventStore } from '@goose-hub/core/event-stream/store.js';
import { existingWorktreePath } from '@goose-hub/core/workspaces/worktree.js';
import type { Result } from '#shared/middleware.js';
import { isValidSlug } from '#shared/source.js';
import { resolveCanonicalWorkItemForRoute } from '#shared/work-item-resolution.js';

const CODE_TAB_DIFF_EXCLUDES = ['.claude/', '.pnpm-store/', 'node_modules/'] as const;

function isExcludedDiffPath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  return CODE_TAB_DIFF_EXCLUDES.some(
    (prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix),
  );
}

export function filterCodeTabDiff(rawDiff: string): string {
  const lines = rawDiff.split('\n');
  const filtered: string[] = [];
  let keepCurrentFile = true;

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/.+ b\/(.+)$/);
      keepCurrentFile = match == null || !isExcludedDiffPath(match[1]);
    }

    if (keepCurrentFile) filtered.push(line);
  }

  return filtered.join('\n');
}

/**
 * Live diff for the Code tab (#185). Returns the unified diff of the
 * current worktree for the most recent in-flight run on this issue, or
 * `{ diff: null }` when no worktree exists.
 *
 * Active-runId resolution: pick the latest event whose payload carries
 * a runId — preferring `pr.opened`, then `agent.implement-complete`,
 * then `agent.run-started` — and look for a worktree at
 * `~/.factory/workspaces/<runId>/`. If absent, return `{ diff: null }`.
 *
 * Trade-off: this is a one-shot diff, not a true SSE stream. The UI
 * polls (5 s default) — adequate for M2-style live UX. SSE-streamed
 * diff is M11+ work.
 */
export async function getIssueWorktreeDiff(
  slug: string,
  id: string,
  opts?: { fetchImpl?: typeof fetch },
): Promise<Result<{ diff: string | null; runId: string | null; reason?: string }>> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const resolved = await resolveCanonicalWorkItemForRoute(slug, id);
  if (!resolved.ok) return resolved;
  if (!isValidSlug(slug)) return { ok: false, error: 'invalid slug', status: 400 };

  const { canonicalWorkItemId: workItemId, repoRef } = resolved.data;
  const ascending = eventStore.replay({ projectId: slug, workItemId });

  // Newest-first scan for a runId on a fix-issue lifecycle event.
  const lifecycleKinds = new Set(['pr.opened', 'agent.implement-complete', 'agent.run-started']);
  let runId: string | null = null;
  for (let i = ascending.length - 1; i >= 0; i -= 1) {
    const e = ascending[i];
    if (lifecycleKinds.has(e.kind) && typeof e.runId === 'string' && e.runId.length > 0) {
      runId = e.runId;
      break;
    }
  }

  if (runId == null) {
    return {
      ok: true,
      data: { diff: null, runId: null, reason: 'no in-flight run for this issue' },
    };
  }

  const worktreePath =
    existingWorktreePath(runId, repoRef ?? undefined) ??
    join(homedir(), '.factory', 'workspaces', runId);
  if (!existsSync(worktreePath)) {
    const prResult = repoRef == null ? null : await tryGitHubPrDiff(ascending, repoRef, fetchImpl);
    if (prResult != null)
      return { ok: true, data: { diff: prResult.diff, runId: prResult.prRunId } };
    return {
      ok: true,
      data: { diff: null, runId, reason: 'worktree not found (cleaned up or pre-creation)' },
    };
  }

  if (!existsSync(join(worktreePath, '.git'))) {
    const prResult = repoRef == null ? null : await tryGitHubPrDiff(ascending, repoRef, fetchImpl);
    if (prResult != null)
      return { ok: true, data: { diff: prResult.diff, runId: prResult.prRunId } };
    return {
      ok: true,
      data: {
        diff: null,
        runId,
        reason: 'worktree directory exists but git repo not yet initialised',
      },
    };
  }

  try {
    const diff = filterCodeTabDiff(
      execFileSync(
        'git',
        ['diff', 'HEAD', '--', '.', ...CODE_TAB_DIFF_EXCLUDES.map((path) => `:(exclude)${path}`)],
        {
          cwd: worktreePath,
          encoding: 'utf8',
          maxBuffer: 4 * 1024 * 1024,
        },
      ),
    );
    if (diff.length > 0) return { ok: true, data: { diff, runId } };
    // Worktree exists but all changes are committed (e.g. PR already opened).
    // Fall through to the GitHub PR diff.
    const prResult = repoRef == null ? null : await tryGitHubPrDiff(ascending, repoRef, fetchImpl);
    if (prResult != null)
      return { ok: true, data: { diff: prResult.diff, runId: prResult.prRunId } };
    return {
      ok: true,
      data: { diff: null, runId, reason: 'no uncommitted changes and no PR diff available' },
    };
  } catch (err) {
    return {
      ok: true,
      data: {
        diff: null,
        runId,
        reason: `git diff failed: ${(err as Error).message}`,
      },
    };
  }
}

async function tryGitHubPrDiff(
  ascending: AgentEvent[],
  repo: string,
  fetchImpl: typeof fetch,
): Promise<{ diff: string; prRunId: string | null } | null> {
  if (process.env.MOCK_SOURCE === 'true') {
    return { diff: '--- a/mock.ts\n+++ b/mock.ts\n@@ -1 +1 @@\n-old\n+new\n', prRunId: null };
  }
  const token = process.env.GITHUB_TOKEN ?? '';
  if (token.length === 0) return null;
  const prEvent = [...ascending]
    .reverse()
    .find(
      (e) =>
        e.kind === 'pr.opened' &&
        typeof (e.payload as Record<string, unknown>)?.prNumber === 'number',
    );
  if (prEvent == null) return null;
  const prNumber = (prEvent.payload as { prNumber: number }).prNumber;
  const prRunId = typeof prEvent.runId === 'string' ? prEvent.runId : null;
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3.diff',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) return null;
    const diff = filterCodeTabDiff(await res.text());
    return { diff, prRunId };
  } catch {
    return null;
  }
}
