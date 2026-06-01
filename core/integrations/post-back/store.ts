import type { LocalDbExternalRefRow } from '../../state-source/local-db-repository.js';
import { LocalDbWorkItemRepository } from '../../state-source/local-db-repository.js';
import type { PostBackKind, PostBackProvider } from './types.js';

export function storeCommentRef(input: {
  projectId: string;
  workItemId: string;
  provider: PostBackProvider;
  commentId: string;
  url: string | null;
  repoRef: string | null;
  sourceKind: PostBackKind;
  repository?: LocalDbWorkItemRepository;
}): LocalDbExternalRefRow {
  const repo = input.repository ?? new LocalDbWorkItemRepository();
  return repo.upsertExternalRef({
    projectId: input.projectId,
    itemId: input.workItemId,
    provider: input.provider,
    kind: 'comment',
    repoRef: input.repoRef ?? null,
    externalId: input.commentId,
    url: input.url ?? null,
    metadata: {
      sourceKind: input.sourceKind,
      lastPostedAt: new Date().toISOString(),
    },
  });
}
