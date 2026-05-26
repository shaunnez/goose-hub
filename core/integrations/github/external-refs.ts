import { LocalDbWorkItemRepository } from '../../state-source/local-db-repository.js';
import type { LocalDbExternalRefRow } from '../../state-source/local-db-repository.js';

export interface GithubExternalRefInput {
  projectId: string;
  workItemId: string;
  kind: 'issue' | 'pull_request' | 'branch' | 'comment' | 'commit' | string;
  repoRef: string;
  externalId: string;
  url?: string | null;
  metadata?: unknown;
  repository?: LocalDbWorkItemRepository;
}

export function upsertGithubExternalRef(input: GithubExternalRefInput): LocalDbExternalRefRow {
  const repository = input.repository ?? new LocalDbWorkItemRepository();
  return repository.upsertExternalRef({
    projectId: input.projectId,
    itemId: input.workItemId,
    provider: 'github',
    kind: input.kind,
    repoRef: input.repoRef,
    externalId: input.externalId,
    url: input.url,
    metadata: input.metadata,
  });
}

export function findWorkItemByGithubIssue(input: {
  projectId: string;
  repoRef: string;
  issueNumber: number | string;
  repository?: LocalDbWorkItemRepository;
}) {
  const repository = input.repository ?? new LocalDbWorkItemRepository();
  return repository.getWorkItemByExternalRef({
    projectId: input.projectId,
    provider: 'github',
    kind: 'issue',
    repoRef: input.repoRef,
    externalId: String(input.issueNumber),
  });
}

export function latestGithubRef(input: {
  projectId: string;
  workItemId: string;
  kind: string;
  repository?: LocalDbWorkItemRepository;
}): LocalDbExternalRefRow | null {
  const repository = input.repository ?? new LocalDbWorkItemRepository();
  const refs = repository
    .listExternalRefs(input.projectId, input.workItemId)
    .filter((ref) => ref.provider === 'github' && ref.kind === input.kind);
  return refs.at(-1) ?? null;
}
