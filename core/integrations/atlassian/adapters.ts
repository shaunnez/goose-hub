import type {
  BitbucketPullRequestDetailDto,
  BitbucketPullRequestDiffDto,
  JiraIssueCardDto,
  JiraIssueDetailDto,
} from './dtos.js';
import type { ProviderResult } from './errors.js';

export type JiraQueryLevel = 'L0' | 'L1' | 'L2' | 'L3';

export interface JiraIssueSearchRequest {
  level: Exclude<JiraQueryLevel, 'L0'>;
  projects: string[];
  maxResults: number;
  updated: {
    from: string;
    to: string;
  };
  text?: string;
  assignee?: {
    accountId: string;
  };
}

export interface AtlassianSearchPage<T> {
  provider: 'jira' | 'bitbucket';
  tier: 'headline' | 'card' | 'detail';
  issues?: T[];
  pullRequests?: T[];
  totalCount: number;
  hasMore: boolean;
}

export interface JiraProviderAdapter {
  getIssue(input: { key: string; tier: 'headline' | 'card' | 'detail' }): Promise<
    ProviderResult<JiraIssueDetailDto>
  >;
  searchIssues(
    input: JiraIssueSearchRequest,
  ): Promise<ProviderResult<AtlassianSearchPage<JiraIssueCardDto>>>;
  getCurrentUser(): Promise<ProviderResult<{ accountId: string; displayName?: string }>>;
}

export interface BitbucketPullRequestSearchRequest {
  workspace: string;
  repos: string[];
  maxResults: number;
  updated: {
    from: string;
    to: string;
  };
  text?: string;
}

export interface BitbucketProviderAdapter {
  getPullRequest(input: {
    workspace: string;
    repo: string;
    pullRequestId: string;
    tier: 'headline' | 'card' | 'detail';
  }): Promise<ProviderResult<BitbucketPullRequestDetailDto>>;
  searchPullRequests(
    input: BitbucketPullRequestSearchRequest,
  ): Promise<ProviderResult<AtlassianSearchPage<BitbucketPullRequestDetailDto>>>;
  getPullRequestDiff(input: {
    workspace: string;
    repo: string;
    pullRequestId: string;
  }): Promise<ProviderResult<BitbucketPullRequestDiffDto>>;
}
