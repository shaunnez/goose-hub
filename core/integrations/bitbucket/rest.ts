import type {
  AtlassianSearchPage,
  BitbucketProviderAdapter,
  BitbucketPullRequestSearchRequest,
} from '../atlassian/adapters.js';
import type {
  BitbucketPullRequestDetailDto,
  BitbucketPullRequestDiffDto,
} from '../atlassian/dtos.js';
import {
  BitbucketPullRequestDetailSchema,
  BitbucketPullRequestDiffSchema,
} from '../atlassian/dtos.js';
import {
  type ProviderResult,
  mapHttpStatusToProviderErrorKind,
  providerFailure,
} from '../atlassian/errors.js';

export interface BitbucketRestAdapterOptions {
  baseUrl?: string;
  username?: string;
  appPassword?: string;
  accessToken?: string;
  fetchImpl?: typeof fetch;
}

export interface BitbucketRestAdapterFromEnvOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface BitbucketPullRequestRest {
  id?: unknown;
  title?: unknown;
  state?: unknown;
  description?: unknown;
  created_on?: unknown;
  updated_on?: unknown;
  links?: {
    html?: {
      href?: unknown;
    };
  };
  source?: {
    repository?: {
      full_name?: unknown;
    };
  };
  destination?: {
    repository?: {
      full_name?: unknown;
    };
  };
}

interface BitbucketPullRequestSearchResponse {
  values?: unknown;
  size?: unknown;
  pagelen?: unknown;
  next?: unknown;
}

export function createBitbucketRestAdapterFromEnv(
  options: BitbucketRestAdapterFromEnvOptions = {},
): BitbucketProviderAdapter {
  return createBitbucketRestAdapter({
    ...options,
    username: process.env.BITBUCKET_USERNAME,
    appPassword: process.env.BITBUCKET_APP_PASSWORD,
    accessToken: process.env.BITBUCKET_TOKEN,
  });
}

export function createBitbucketRestAdapter(
  options: BitbucketRestAdapterOptions,
): BitbucketProviderAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? 'https://api.bitbucket.org/2.0').replace(/\/+$/, '');
  const authorization = authorizationHeader(options);

  if (authorization == null) return missingCredentialsAdapter();

  return {
    async getPullRequest(input): Promise<ProviderResult<BitbucketPullRequestDetailDto>> {
      const url = pullRequestApiUrl(baseUrl, input);
      const response = await requestBitbucket(fetchImpl, url, authorization, 'application/json');
      if (!response.ok) return response;

      let raw: unknown;
      try {
        raw = await response.data.json();
      } catch (err) {
        return providerFailure('connection', `Failed to parse Bitbucket response: ${String(err)}`);
      }

      try {
        return {
          ok: true,
          data: BitbucketPullRequestDetailSchema.parse(mapPullRequest(raw, input)),
        };
      } catch (err) {
        return providerFailure(
          'validation',
          `Bitbucket pull request response failed validation: ${String(err)}`,
        );
      }
    },

    async searchPullRequests(
      input: BitbucketPullRequestSearchRequest,
    ): Promise<ProviderResult<AtlassianSearchPage<BitbucketPullRequestDetailDto>>> {
      const pullRequests: BitbucketPullRequestDetailDto[] = [];
      let totalCount = 0;
      let hasMore = false;

      for (const repo of input.repos) {
        const url = new URL(
          `${baseUrl}/repositories/${encodeURIComponent(input.workspace)}/${encodeURIComponent(
            repo,
          )}/pullrequests`,
        );
        url.searchParams.set('pagelen', String(input.maxResults));
        url.searchParams.set('q', buildPullRequestQuery(input));

        const response = await requestBitbucket(
          fetchImpl,
          url.toString(),
          authorization,
          'application/json',
        );
        if (!response.ok) return response;

        let raw: unknown;
        try {
          raw = await response.data.json();
        } catch (err) {
          return providerFailure(
            'connection',
            `Failed to parse Bitbucket search response: ${String(err)}`,
          );
        }

        try {
          const page = mapSearchResponse(raw, input.workspace, repo);
          totalCount += page.totalCount;
          hasMore = hasMore || page.hasMore;
          pullRequests.push(...page.pullRequests);
        } catch (err) {
          return providerFailure(
            'validation',
            `Bitbucket search response failed validation: ${String(err)}`,
          );
        }
      }

      return {
        ok: true,
        data: {
          provider: 'bitbucket',
          tier: 'detail',
          pullRequests: pullRequests.slice(0, input.maxResults),
          totalCount,
          hasMore: hasMore || pullRequests.length > input.maxResults,
        },
      };
    },

    async getPullRequestDiff(input): Promise<ProviderResult<BitbucketPullRequestDiffDto>> {
      const url = `${pullRequestApiUrl(baseUrl, input)}/diff`;
      const response = await requestBitbucket(fetchImpl, url, authorization, 'text/plain');
      if (!response.ok) return response;

      let diff: string;
      try {
        diff = await response.data.text();
      } catch (err) {
        return providerFailure('connection', `Failed to read Bitbucket diff: ${String(err)}`);
      }

      try {
        return {
          ok: true,
          data: BitbucketPullRequestDiffSchema.parse({
            provider: 'bitbucket',
            resourceKind: 'pull_request',
            repoRef: `${input.workspace}/${input.repo}`,
            externalId: input.pullRequestId,
            diff,
            url: bitbucketWebPullRequestUrl(input),
          }),
        };
      } catch (err) {
        return providerFailure(
          'validation',
          `Bitbucket pull request diff failed validation: ${String(err)}`,
        );
      }
    },
  };
}

function missingCredentialsAdapter(): BitbucketProviderAdapter {
  return {
    async getPullRequest() {
      return providerFailure('auth', 'Bitbucket credentials are not configured');
    },
    async searchPullRequests() {
      return providerFailure('auth', 'Bitbucket credentials are not configured');
    },
    async getPullRequestDiff() {
      return providerFailure('auth', 'Bitbucket credentials are not configured');
    },
  };
}

async function requestBitbucket(
  fetchImpl: typeof fetch,
  url: string,
  authorization: string,
  accept: string,
): Promise<ProviderResult<Response>> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Accept: accept,
        Authorization: authorization,
      },
    });
  } catch (err) {
    return providerFailure('connection', `Failed to connect to Bitbucket: ${String(err)}`);
  }

  if (!response.ok) {
    return providerFailure(
      mapHttpStatusToProviderErrorKind(response.status, 'read'),
      response.statusText || `Bitbucket request failed with ${response.status}`,
      { status: response.status },
    );
  }

  return { ok: true, data: response };
}

function authorizationHeader(options: BitbucketRestAdapterOptions): string | null {
  if (options.accessToken != null && options.accessToken.trim().length > 0) {
    return `Bearer ${options.accessToken.trim()}`;
  }
  if (
    options.username != null &&
    options.username.trim().length > 0 &&
    options.appPassword != null &&
    options.appPassword.trim().length > 0
  ) {
    return `Basic ${Buffer.from(`${options.username}:${options.appPassword}`).toString('base64')}`;
  }
  return null;
}

function pullRequestApiUrl(
  baseUrl: string,
  input: { workspace: string; repo: string; pullRequestId: string },
): string {
  return `${baseUrl}/repositories/${encodeURIComponent(input.workspace)}/${encodeURIComponent(
    input.repo,
  )}/pullrequests/${encodeURIComponent(input.pullRequestId)}`;
}

function bitbucketWebPullRequestUrl(input: {
  workspace: string;
  repo: string;
  pullRequestId: string;
}): string {
  return `https://bitbucket.org/${encodeURIComponent(input.workspace)}/${encodeURIComponent(
    input.repo,
  )}/pull-requests/${encodeURIComponent(input.pullRequestId)}`;
}

function mapPullRequest(
  raw: unknown,
  input: { workspace: string; repo: string; pullRequestId: string },
): BitbucketPullRequestDetailDto {
  const pullRequest = raw as BitbucketPullRequestRest;
  const id = stringValue(pullRequest.id) || input.pullRequestId;
  const title = stringValue(pullRequest.title) || `Pull request ${id}`;
  const repoRef =
    stringValue(pullRequest.destination?.repository?.full_name) ||
    stringValue(pullRequest.source?.repository?.full_name) ||
    `${input.workspace}/${input.repo}`;
  return {
    provider: 'bitbucket',
    resourceKind: 'pull_request',
    tier: 'detail',
    id,
    title,
    status: stringValue(pullRequest.state) || 'UNKNOWN',
    url: stringValue(pullRequest.links?.html?.href) || bitbucketWebPullRequestUrl(input),
    repoRef,
    created: stringValue(pullRequest.created_on) || undefined,
    updated: stringValue(pullRequest.updated_on) || undefined,
    bodyPreview: stringValue(pullRequest.description) || undefined,
    labels: [],
    components: [],
    linkedKeys: [],
  };
}

function mapSearchResponse(
  raw: unknown,
  workspace: string,
  repo: string,
): { pullRequests: BitbucketPullRequestDetailDto[]; totalCount: number; hasMore: boolean } {
  const response = raw as BitbucketPullRequestSearchResponse;
  const values = Array.isArray(response.values) ? response.values : [];
  const pullRequests = values.map((value) =>
    BitbucketPullRequestDetailSchema.parse(
      mapPullRequest(value, {
        workspace,
        repo,
        pullRequestId: stringValue((value as BitbucketPullRequestRest).id),
      }),
    ),
  );
  return {
    pullRequests,
    totalCount: numberValue(response.size) ?? pullRequests.length,
    hasMore: stringValue(response.next).length > 0,
  };
}

function buildPullRequestQuery(input: BitbucketPullRequestSearchRequest): string {
  const clauses = [
    `updated_on >= ${bitbucketQueryString(input.updated.from)}`,
    `updated_on <= ${bitbucketQueryString(input.updated.to)}`,
    input.text != null && input.text.trim().length > 0
      ? `title ~ ${bitbucketQueryString(input.text)}`
      : undefined,
  ].filter((clause): clause is string => clause != null);
  return clauses.join(' AND ');
}

function bitbucketQueryString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export interface BitbucketCreatePrInput {
  workspace: string;
  repo: string;
  title: string;
  description?: string;
  sourceBranch: string;
  targetBranch: string;
  username?: string;
  appPassword?: string;
  accessToken?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface BitbucketCreatePrResult {
  prNumber: number;
  prUrl: string;
}

/**
 * Creates a pull request in Bitbucket via the REST API.
 * Auth reads from explicit options first, then env vars (BITBUCKET_TOKEN or
 * BITBUCKET_USERNAME + BITBUCKET_APP_PASSWORD). Requires pullrequest:write scope.
 */
export async function createBitbucketPullRequest(
  input: BitbucketCreatePrInput,
): Promise<BitbucketCreatePrResult> {
  const auth = authorizationHeader({
    username: input.username ?? process.env.BITBUCKET_USERNAME,
    appPassword: input.appPassword ?? process.env.BITBUCKET_APP_PASSWORD,
    accessToken: input.accessToken ?? process.env.BITBUCKET_TOKEN,
  });
  if (auth == null) {
    throw new Error(
      'Bitbucket credentials required: set BITBUCKET_USERNAME+BITBUCKET_APP_PASSWORD or BITBUCKET_TOKEN',
    );
  }

  const baseUrl = (input.baseUrl ?? 'https://api.bitbucket.org/2.0').replace(/\/+$/, '');
  const url = `${baseUrl}/repositories/${encodeURIComponent(input.workspace)}/${encodeURIComponent(input.repo)}/pullrequests`;
  const fetchImpl = input.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: auth,
      },
      body: JSON.stringify({
        title: input.title,
        description: input.description ?? '',
        source: { branch: { name: input.sourceBranch } },
        destination: { branch: { name: input.targetBranch } },
        close_source_branch: false,
      }),
    });
  } catch (err) {
    throw new Error(`Failed to connect to Bitbucket: ${String(err)}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '<no body>');
    throw new Error(
      `Bitbucket PR creation failed: ${response.status} ${response.statusText} — ${detail}`,
    );
  }

  const json = (await response.json()) as {
    id?: unknown;
    links?: { html?: { href?: unknown } };
  };
  const prNumber = typeof json.id === 'number' ? json.id : Number(json.id);
  const prUrl =
    typeof json.links?.html?.href === 'string'
      ? json.links.html.href
      : `https://bitbucket.org/${encodeURIComponent(input.workspace)}/${encodeURIComponent(input.repo)}/pull-requests/${prNumber}`;

  return { prNumber, prUrl };
}
