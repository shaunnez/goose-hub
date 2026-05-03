import { execFileSync } from 'node:child_process';

/**
 * Lightweight GitHub PR-opening connector (#184).
 *
 * Pushes the current worktree HEAD to a feature branch and opens a PR via
 * the GitHub REST API. Returns the PR number and HTML URL.
 *
 * Title format (CLAUDE.md "PR conventions"): `M<milestone>.<task>: <description>`.
 * Body MUST contain `Closes #N` on its own line — the workflow caller is
 * responsible for ensuring this is present and that no implementation
 * reasoning is included (QA / Reviewer holdouts must not see it).
 */

export interface OpenPrInput {
  /** Absolute path to the worktree containing the changes to push. */
  worktreePath: string;
  /** Repo full name, e.g. `shaunnez/goose-hub`. */
  repo: string;
  /** Issue this PR closes. Must match `Closes #N` in the body. */
  issueNumber: number;
  /** PR title — short, follows the `M<milestone>.<task>: ...` convention. */
  title: string;
  /** PR body — must contain `Closes #N`; must NOT contain implementation reasoning. */
  body: string;
  /** Source branch name to push from the worktree. Defaults to `factory/<runId>`. */
  branchName: string;
  /** Base branch to merge into. Defaults to `main`. */
  baseBranch?: string;
  /** GitHub token (`repo` scope). Required. */
  token: string;
  /** Optional override of the fetch implementation — used by tests. */
  fetchImpl?: typeof fetch;
  /** Optional override of the git invocation — used by tests. */
  gitExec?: (args: string[], cwd: string) => string;
}

export interface OpenPrResult {
  prNumber: number;
  prUrl: string;
  branch: string;
  base: string;
}

const CLOSES_PATTERN = /^Closes #(\d+)$/m;

export function validatePrBody(body: string, issueNumber: number): void {
  const match = CLOSES_PATTERN.exec(body);
  if (match == null) {
    throw new Error('PR body must contain `Closes #N` on its own line');
  }
  if (Number.parseInt(match[1], 10) !== issueNumber) {
    throw new Error(`PR body Closes #${match[1]} does not match expected issue #${issueNumber}`);
  }
}

export async function openPR(input: OpenPrInput): Promise<OpenPrResult> {
  const {
    worktreePath,
    repo,
    issueNumber,
    title,
    body,
    branchName,
    baseBranch = 'main',
    token,
    fetchImpl = fetch,
    gitExec = defaultGitExec,
  } = input;

  if (title.length === 0 || title.length > 70) {
    throw new Error(`PR title must be 1–70 chars; got ${title.length}`);
  }
  validatePrBody(body, issueNumber);

  // 1. Push the current worktree HEAD to the named feature branch.
  // `--force-with-lease` is intentional: replays of the same workflow run
  // (after retry) push the same logical change to the same branch. Forcing
  // without lease would clobber upstream commits — refused by callers.
  gitExec(['push', '--force-with-lease', 'origin', `HEAD:refs/heads/${branchName}`], worktreePath);

  // 2. Open the PR via REST.
  const url = `https://api.github.com/repos/${repo}/pulls`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, body, head: branchName, base: baseBranch }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '<no body>');
    throw new Error(`GitHub PR open failed: ${response.status} ${response.statusText} — ${detail}`);
  }

  const json = (await response.json()) as { number: number; html_url: string };
  return {
    prNumber: json.number,
    prUrl: json.html_url,
    branch: branchName,
    base: baseBranch,
  };
}

function defaultGitExec(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}
