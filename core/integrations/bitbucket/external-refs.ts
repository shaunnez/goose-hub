import { LocalDbWorkItemRepository } from '../../state-source/local-db-repository.js';
import type { LocalDbExternalRefRow } from '../../state-source/local-db-repository.js';

export interface BitbucketPullRequestExternalRefInput {
  projectId: string;
  workItemId: string;
  workspace: string;
  repo: string;
  pullRequestId: number | string;
  url?: string | null;
  metadata?: unknown;
  repository?: LocalDbWorkItemRepository;
}

export function bitbucketRepoRef(input: { workspace: string; repo: string }): string {
  return `${input.workspace}/${input.repo}`;
}

export function bitbucketPullRequestUrl(input: {
  workspace: string;
  repo: string;
  pullRequestId: number | string;
}): string {
  return `https://bitbucket.org/${encodeURIComponent(input.workspace)}/${encodeURIComponent(
    input.repo,
  )}/pull-requests/${encodeURIComponent(String(input.pullRequestId))}`;
}

export function upsertBitbucketPullRequestRef(
  input: BitbucketPullRequestExternalRefInput,
): LocalDbExternalRefRow {
  const repository = input.repository ?? new LocalDbWorkItemRepository();
  return repository.upsertExternalRef({
    projectId: input.projectId,
    itemId: input.workItemId,
    provider: 'bitbucket',
    kind: 'pull_request',
    repoRef: bitbucketRepoRef(input),
    externalId: String(input.pullRequestId),
    url: input.url ?? bitbucketPullRequestUrl(input),
    metadata: input.metadata,
  });
}

export function latestBitbucketPullRequestRef(input: {
  projectId: string;
  workItemId: string;
  repository?: LocalDbWorkItemRepository;
}): LocalDbExternalRefRow | null {
  const repository = input.repository ?? new LocalDbWorkItemRepository();
  const refs = repository
    .listExternalRefs(input.projectId, input.workItemId)
    .filter((ref) => ref.provider === 'bitbucket' && ref.kind === 'pull_request');
  return refs.at(-1) ?? null;
}
