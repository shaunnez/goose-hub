import type { GithubIssue } from '../../state-source/github-issue-mapper.js';

export interface ListGithubIssuesInput {
  repoRef: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export async function listGithubIssues(input: ListGithubIssuesInput): Promise<GithubIssue[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const headers = {
    Authorization: `Bearer ${input.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const out: GithubIssue[] = [];
  let url: string | null =
    `https://api.github.com/repos/${input.repoRef}/issues?state=all&per_page=100`;
  while (url != null) {
    const response = await fetchImpl(url, { headers });
    if (!response.ok) {
      throw new Error(`GitHub issues list failed: ${response.status} ${response.statusText}`);
    }
    const page = (await response.json()) as GithubIssue[];
    out.push(...page.filter((issue) => issue.pull_request == null));
    const link = response.headers.get('Link') ?? '';
    url = link.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
  }
  return out;
}
