/**
 * Merge a PR via the GitHub REST API (#186).
 *
 * Uses the merge-commit method by default — same default the gh CLI uses
 * and the same default that produced the merge commits for PRs #237 and
 * #238 in this branch's history. Squash and rebase are exposed as options
 * for future use.
 */

/**
 * Thrown when GitHub rejects the merge with HTTP 405 — i.e. the PR is not
 * mergeable. Callers (e.g. `approveIssue`) branch on this to dispatch the
 * resolve-conflict workflow instead of bubbling a 500.
 */
export class MergeConflictError extends Error {
  constructor(public readonly prNumber: number) {
    super(`PR #${prNumber} is not mergeable (merge conflict)`);
    this.name = 'MergeConflictError';
  }
}

export interface MergePrInput {
  /** Repo full name, e.g. `shaunnez/goose-hub`. */
  repo: string;
  /** PR number to merge. */
  prNumber: number;
  /** GitHub token (`repo` scope). Required. */
  token: string;
  /** Merge method. Defaults to `merge`. */
  mergeMethod?: 'merge' | 'squash' | 'rebase';
  /** Optional override of fetch — used by tests. */
  fetchImpl?: typeof fetch;
}

export interface MergePrResult {
  sha: string;
  merged: boolean;
}

export async function mergePR(input: MergePrInput): Promise<MergePrResult> {
  if (process.env.MOCK_SOURCE === 'true') {
    return { sha: 'mock-sha', merged: true };
  }

  const { repo, prNumber, token, mergeMethod = 'merge', fetchImpl = fetch } = input;
  const url = `https://api.github.com/repos/${repo}/pulls/${prNumber}/merge`;
  const response = await fetchImpl(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ merge_method: mergeMethod }),
  });

  if (response.status === 405) {
    throw new MergeConflictError(prNumber);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '<no body>');
    throw new Error(
      `GitHub PR merge failed: ${response.status} ${response.statusText} — ${detail}`,
    );
  }

  const json = (await response.json()) as { sha: string; merged: boolean };
  return { sha: json.sha, merged: json.merged };
}
