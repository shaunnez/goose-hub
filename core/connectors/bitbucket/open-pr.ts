import { execFileSync } from 'node:child_process';
import { createBitbucketPullRequest } from '../../integrations/bitbucket/rest.js';
import type { OpenPrResult } from '../github/open-pr.js';

export interface OpenBitbucketPrInput {
  worktreePath: string;
  workspace: string;
  repo: string;
  title: string;
  body: string;
  branchName: string;
  baseBranch?: string;
  fetchImpl?: typeof fetch;
  gitExec?: (args: string[], cwd: string) => string;
  skipPush?: boolean;
}

/**
 * Pushes the current worktree HEAD to a feature branch and opens a PR via
 * the Bitbucket REST API. Returns the PR number and web URL.
 *
 * Requires pullrequest:write scope on the app password or access token.
 * Credentials are read from BITBUCKET_USERNAME+BITBUCKET_APP_PASSWORD or BITBUCKET_TOKEN.
 */
export async function openBitbucketPR(input: OpenBitbucketPrInput): Promise<OpenPrResult> {
  if (process.env.MOCK_SOURCE === 'true') {
    return {
      prNumber: 999,
      prUrl: `https://bitbucket.org/${input.workspace}/${input.repo}/pull-requests/999`,
      branch: input.branchName,
      base: input.baseBranch ?? 'main',
    };
  }

  const {
    worktreePath,
    workspace,
    repo,
    title,
    body,
    branchName,
    baseBranch = 'main',
    fetchImpl = fetch,
    gitExec = defaultGitExec,
    skipPush = false,
  } = input;

  if (!skipPush) {
    gitExec(
      ['push', '--force-with-lease', 'origin', `HEAD:refs/heads/${branchName}`],
      worktreePath,
    );
  }

  const { prNumber, prUrl } = await createBitbucketPullRequest({
    workspace,
    repo,
    title,
    description: body,
    sourceBranch: branchName,
    targetBranch: baseBranch,
    fetchImpl,
  });

  return { prNumber, prUrl, branch: branchName, base: baseBranch };
}

function defaultGitExec(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}
