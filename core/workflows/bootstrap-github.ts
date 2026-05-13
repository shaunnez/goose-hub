/**
 * bootstrap-github.ts — GitHub Contents API helpers for the bootstrap workflow.
 *
 * Extracted from bootstrap-project.ts. All functions make HTTP calls to the
 * GitHub REST API; no rendering or business logic.
 */

// ---------------------------------------------------------------------------
// The registration repo is a constant shared by all helpers here.
// ---------------------------------------------------------------------------

const REGISTRATION_REPO = 'shaunnez/goose-hub';

// ---------------------------------------------------------------------------
// Internal JSON helper
// ---------------------------------------------------------------------------

interface GhJson {
  [key: string]: unknown;
}

async function ghJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit & { token: string },
): Promise<GhJson> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${init.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'goose-hub-bootstrap',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetchImpl(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${init.method ?? 'GET'} ${url} → ${res.status}: ${text}`);
  }
  return (await res.json()) as GhJson;
}

// ---------------------------------------------------------------------------
// Branch management
// ---------------------------------------------------------------------------

export async function getDefaultBranchSha(
  fetchImpl: typeof fetch,
  token: string,
): Promise<{ defaultBranch: string; sha: string }> {
  const repoMeta = await ghJson(fetchImpl, `https://api.github.com/repos/${REGISTRATION_REPO}`, {
    method: 'GET',
    token,
  });
  const defaultBranch = String(repoMeta.default_branch ?? 'main');
  const refMeta = await ghJson(
    fetchImpl,
    `https://api.github.com/repos/${REGISTRATION_REPO}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
    { method: 'GET', token },
  );
  const sha = String((refMeta.object as GhJson | undefined)?.sha ?? '');
  if (!sha) throw new Error(`could not resolve default branch sha for ${REGISTRATION_REPO}`);
  return { defaultBranch, sha };
}

export interface CreateBranchInput {
  fetchImpl: typeof fetch;
  token: string;
  baseSha: string;
  branchName: string;
}

export async function createBranch(input: CreateBranchInput): Promise<void> {
  try {
    await ghJson(input.fetchImpl, `https://api.github.com/repos/${REGISTRATION_REPO}/git/refs`, {
      method: 'POST',
      token: input.token,
      body: JSON.stringify({ ref: `refs/heads/${input.branchName}`, sha: input.baseSha }),
    });
  } catch (err) {
    // GitHub returns 422 "Reference already exists" if a previous run created
    // the branch but errored before opening the PR. Treat that as a no-op so
    // the workflow can self-recover. Any other error must propagate.
    const msg = err instanceof Error ? err.message : String(err);
    if (/422/.test(msg) && /already exists/i.test(msg)) {
      return;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Repo metadata
// ---------------------------------------------------------------------------

export async function getRepoInfo(
  fetchImpl: typeof fetch,
  token: string,
  repoRef: string,
): Promise<{ defaultBranch: string; description: string }> {
  const meta = await ghJson(fetchImpl, `https://api.github.com/repos/${repoRef}`, {
    method: 'GET',
    token,
  });
  return {
    defaultBranch: String(meta.default_branch ?? 'main'),
    description: String(meta.description ?? ''),
  };
}

// ---------------------------------------------------------------------------
// File + PR operations
// ---------------------------------------------------------------------------

export async function putFileOnBranch(input: {
  fetchImpl: typeof fetch;
  token: string;
  branch: string;
  path: string;
  content: string;
  message: string;
}): Promise<void> {
  const url = `https://api.github.com/repos/${REGISTRATION_REPO}/contents/${input.path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
  // Encode without relying on Buffer typings (works in Node 18+).
  const encoded = Buffer.from(input.content, 'utf-8').toString('base64');
  await ghJson(input.fetchImpl, url, {
    method: 'PUT',
    token: input.token,
    body: JSON.stringify({ message: input.message, content: encoded, branch: input.branch }),
  });
}

interface OpenedPr {
  number: number;
  html_url: string;
}

export async function openPullRequest(input: {
  fetchImpl: typeof fetch;
  token: string;
  branch: string;
  base: string;
  title: string;
  body: string;
}): Promise<OpenedPr> {
  const data = await ghJson(
    input.fetchImpl,
    `https://api.github.com/repos/${REGISTRATION_REPO}/pulls`,
    {
      method: 'POST',
      token: input.token,
      body: JSON.stringify({
        title: input.title,
        head: input.branch,
        base: input.base,
        body: input.body,
        draft: false,
      }),
    },
  );
  return { number: Number(data.number), html_url: String(data.html_url) };
}

export async function applyLabels(input: {
  fetchImpl: typeof fetch;
  token: string;
  issueNumber: number;
  labels: string[];
}): Promise<void> {
  await ghJson(
    input.fetchImpl,
    `https://api.github.com/repos/${REGISTRATION_REPO}/issues/${input.issueNumber}/labels`,
    {
      method: 'POST',
      token: input.token,
      body: JSON.stringify({ labels: input.labels }),
    },
  );
}

// ---------------------------------------------------------------------------
// Idempotency check
// ---------------------------------------------------------------------------

interface GhPullRefSummary {
  number: number;
  state: string;
  html_url: string;
  head?: { ref?: string };
}

/**
 * List PRs in shaunnez/goose-hub whose head ref equals `bootstrap/<slug>`.
 * GitHub's `head` filter requires the form `<owner>:<branch>`.
 */
export async function findExistingRegistrationPrs(
  slug: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<GhPullRefSummary[]> {
  const branch = `bootstrap/${slug}`;
  // Owner of the registration repo; we filter on this owner's branches.
  const [registrationOwner] = REGISTRATION_REPO.split('/');
  const url = `https://api.github.com/repos/${REGISTRATION_REPO}/pulls?head=${encodeURIComponent(`${registrationOwner}:${branch}`)}&state=all&per_page=100`;
  const res = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'goose-hub-bootstrap',
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to list registration PRs: ${res.status} ${res.statusText}`);
  }
  const all = (await res.json()) as GhPullRefSummary[];
  // Defensive: GitHub honours the head filter, but verify ref equality anyway.
  return all.filter((p) => p.head?.ref === branch);
}
