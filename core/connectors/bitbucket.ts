import { logger } from '../logger.js';

/**
 * Read-only Bitbucket connector (#323).
 *
 * Reaches a Bitbucket Cloud workspace via App Password auth and exposes
 * the minimum surface investigation workflows need: read a file, search
 * file content, and list PRs for context. Write operations (PR creation,
 * comment posting) are deferred to a future milestone.
 *
 * Authentication: HTTP Basic with `BITBUCKET_USER` + `BITBUCKET_APP_PASSWORD`.
 */

export interface BitbucketRepoRef {
  /** Workspace slug. */
  workspace: string;
  /** Repo slug. */
  repoSlug: string;
}

export interface BitbucketFileResult {
  path: string;
  content: string;
  /** Branch or commit ref the file was fetched at. */
  ref: string;
}

export interface BitbucketSearchHit {
  path: string;
  snippet: string;
  /** 1-based line number of the first hit. */
  line: number;
}

export interface BitbucketPullRequest {
  id: number;
  title: string;
  state: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED';
  authorDisplayName: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface BitbucketConnectorOptions {
  /** Override of native fetch — used by tests. */
  fetchImpl?: typeof fetch;
  /** Optional override of the auth string (otherwise read from env). */
  authOverride?: { user: string; appPassword: string };
}

export class BitbucketConnector {
  private readonly user: string;
  private readonly appPassword: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: BitbucketConnectorOptions = {}) {
    const user = options.authOverride?.user ?? process.env.BITBUCKET_USER;
    const appPassword = options.authOverride?.appPassword ?? process.env.BITBUCKET_APP_PASSWORD;
    if (user == null || user.length === 0) {
      throw new Error('BITBUCKET_USER is required for BitbucketConnector');
    }
    if (appPassword == null || appPassword.length === 0) {
      throw new Error('BITBUCKET_APP_PASSWORD is required for BitbucketConnector');
    }
    this.user = user;
    this.appPassword = appPassword;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private get baseHeaders(): Record<string, string> {
    const basic = Buffer.from(`${this.user}:${this.appPassword}`).toString('base64');
    return {
      Authorization: `Basic ${basic}`,
      Accept: 'application/json',
    };
  }

  private async bbFetch(path: string): Promise<Response> {
    const url = `https://api.bitbucket.org/2.0${path}`;
    const response = await this.fetchImpl(url, { headers: this.baseHeaders });
    if (response.status === 401) {
      throw new Error(`Bitbucket API authentication failed (401) for ${url}`);
    }
    if (response.status === 429) {
      throw new Error('Bitbucket API rate limited (429)');
    }
    if (!response.ok && response.status !== 404) {
      const text = await response.text().catch(() => '');
      throw new Error(`Bitbucket API error ${response.status} for ${url}: ${text}`);
    }
    return response;
  }

  /**
   * Fetch a file's contents at the repo's main branch (or specified ref).
   * Returns `null` if the file is not found.
   */
  async getFile(
    repo: BitbucketRepoRef,
    path: string,
    ref = 'HEAD',
  ): Promise<BitbucketFileResult | null> {
    const res = await this.bbFetch(
      `/repositories/${repo.workspace}/${repo.repoSlug}/src/${encodeURIComponent(ref)}/${path}`,
    );
    if (res.status === 404) return null;
    const content = await res.text();
    return { path, content, ref };
  }

  /**
   * Search the repo for `query`. Bitbucket's documented `/search/code`
   * endpoint scopes searches at the workspace level — we filter results
   * down to the requested repo. Falls back to an empty result on
   * unsupported workspaces (some legacy ones never expose the endpoint).
   */
  async searchCode(
    repo: BitbucketRepoRef,
    query: string,
    limit = 25,
  ): Promise<BitbucketSearchHit[]> {
    const params = new URLSearchParams({
      search_query: `${query} repo:${repo.repoSlug}`,
      pagelen: String(limit),
    });
    const res = await this.bbFetch(`/workspaces/${repo.workspace}/search/code?${params}`);
    if (res.status === 404) {
      logger.warn('bitbucket workspace does not expose /search/code', {
        workspace: repo.workspace,
      });
      return [];
    }
    const body = (await res.json()) as {
      values?: Array<{
        file?: { path?: string };
        content_match_count?: number;
        content_matches?: Array<{
          lines?: Array<{ line?: number; segments?: Array<{ text?: string; match?: boolean }> }>;
        }>;
      }>;
    };
    const hits: BitbucketSearchHit[] = [];
    for (const value of body.values ?? []) {
      const path = value.file?.path;
      if (path == null) continue;
      const firstLine = value.content_matches?.[0]?.lines?.[0];
      const snippet = (firstLine?.segments ?? []).map((s) => s.text ?? '').join('');
      hits.push({
        path,
        snippet,
        line: firstLine?.line ?? 1,
      });
    }
    return hits;
  }

  /**
   * List pull requests on the repo, optionally filtered by state.
   * Returns at most one page (Bitbucket default 50). Higher-volume callers
   * should paginate with their own loop.
   */
  async listPullRequests(
    repo: BitbucketRepoRef,
    state: 'OPEN' | 'MERGED' | 'DECLINED' | 'all' = 'OPEN',
  ): Promise<BitbucketPullRequest[]> {
    const params = new URLSearchParams({ pagelen: '50' });
    if (state !== 'all') params.set('state', state);
    const res = await this.bbFetch(
      `/repositories/${repo.workspace}/${repo.repoSlug}/pullrequests?${params}`,
    );
    if (res.status === 404) return [];
    const body = (await res.json()) as {
      values?: Array<{
        id: number;
        title: string;
        state: BitbucketPullRequest['state'];
        author?: { display_name?: string };
        links?: { html?: { href?: string } };
        created_on: string;
        updated_on: string;
      }>;
    };
    return (body.values ?? []).map((v) => ({
      id: v.id,
      title: v.title,
      state: v.state,
      authorDisplayName: v.author?.display_name ?? 'unknown',
      htmlUrl: v.links?.html?.href ?? '',
      createdAt: v.created_on,
      updatedAt: v.updated_on,
    }));
  }

  /** Fetch repo metadata. Used by the repo-matcher (#326). */
  async getRepoMetadata(
    repo: BitbucketRepoRef,
  ): Promise<{ description: string; name: string; mainbranch: string } | null> {
    const res = await this.bbFetch(`/repositories/${repo.workspace}/${repo.repoSlug}`);
    if (res.status === 404) return null;
    const body = (await res.json()) as {
      name?: string;
      description?: string;
      mainbranch?: { name?: string };
    };
    return {
      name: body.name ?? repo.repoSlug,
      description: body.description ?? '',
      mainbranch: body.mainbranch?.name ?? 'main',
    };
  }

  /** List repos under a workspace. Used by the repo-matcher. */
  async listWorkspaceRepos(workspace: string): Promise<BitbucketRepoRef[]> {
    const res = await this.bbFetch(`/repositories/${workspace}?pagelen=100`);
    if (res.status === 404) return [];
    const body = (await res.json()) as {
      values?: Array<{ slug?: string; name?: string }>;
    };
    return (body.values ?? [])
      .filter((v) => typeof v.slug === 'string')
      .map((v) => ({ workspace, repoSlug: v.slug as string }));
  }
}

/**
 * Parse a Bitbucket clone URL (SSH or HTTPS) into a `BitbucketRepoRef`.
 * Returns `null` if the URL is not a Bitbucket clone URL.
 */
export function parseBitbucketCloneUrl(url: string): BitbucketRepoRef | null {
  // SSH: git@bitbucket.org:workspace/repo.git
  const ssh = url.match(/^git@bitbucket\.org:([^/]+)\/(.+?)(?:\.git)?$/);
  if (ssh != null) return { workspace: ssh[1], repoSlug: ssh[2] };
  // HTTPS: https://bitbucket.org/workspace/repo.git OR https://user@bitbucket.org/workspace/repo.git
  const https = url.match(/^https:\/\/(?:[^@]+@)?bitbucket\.org\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (https != null) return { workspace: https[1], repoSlug: https[2] };
  return null;
}
