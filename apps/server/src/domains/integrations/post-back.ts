import { postBitbucketComment } from '@goose-hub/core/integrations/bitbucket/comment.js';
import { postJiraComment } from '@goose-hub/core/integrations/jira/comment.js';
import { storeCommentRef } from '@goose-hub/core/integrations/post-back/store.js';
import type {
  PostBackAvailability,
  PostBackKind,
  PostBackProvider,
} from '@goose-hub/core/integrations/post-back/types.js';
import { LocalDbWorkItemRepository } from '@goose-hub/core/state-source/local-db-repository.js';
import { getProject } from '#shared/projects.js';

const POST_BACK_TEXT_MAX = 5000;

export function sanitizePostBackText(text: string): string {
  return text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, POST_BACK_TEXT_MAX);
}

export function checkPostBackAvailability(
  projectId: string,
  workItemId: string,
  repository?: LocalDbWorkItemRepository,
): PostBackAvailability {
  const repo = repository ?? new LocalDbWorkItemRepository();
  const refs = repo.listExternalRefs(projectId, workItemId);
  return {
    jira: refs.some((r) => r.provider === 'jira' && r.kind === 'issue'),
    bitbucket: refs.some((r) => r.provider === 'bitbucket' && r.kind === 'pull_request'),
  };
}

export type PostBackServiceResult =
  | { ok: true; provider: PostBackProvider; commentId: string; url: string | null }
  | {
      ok: false;
      error: 'no-ref' | 'no-credentials' | 'provider-failure' | 'empty-text';
      detail: string;
    };

export async function executePostBack(input: {
  projectSlug: string;
  workItemId: string;
  provider: PostBackProvider;
  kind: PostBackKind;
  text: string;
  repository?: LocalDbWorkItemRepository;
}): Promise<PostBackServiceResult> {
  const sanitized = sanitizePostBackText(input.text);
  if (sanitized.length === 0) {
    return { ok: false, error: 'empty-text', detail: 'text is empty after sanitization' };
  }

  const project = await getProject(input.projectSlug);
  const projectId = project?.id ?? input.projectSlug;
  const repo = input.repository ?? new LocalDbWorkItemRepository();
  const refs = repo.listExternalRefs(projectId, input.workItemId);

  if (input.provider === 'jira') {
    const ref = refs.find((r) => r.provider === 'jira' && r.kind === 'issue') ?? null;
    if (ref == null) {
      return {
        ok: false,
        error: 'no-ref',
        detail: 'no linked Jira issue found for this work item',
      };
    }

    const jiraConfig =
      project?.source.kind === 'local-db' ? project.source.integrations?.jira : undefined;
    const email = process.env.JIRA_EMAIL ?? process.env.ATLASSIAN_EMAIL ?? '';
    const token =
      process.env.JIRA_API_TOKEN ?? process.env.ATLASSIAN_API_TOKEN ?? process.env.JIRA_TOKEN ?? '';

    if (jiraConfig == null || email.length === 0 || token.length === 0) {
      return {
        ok: false,
        error: 'no-credentials',
        detail: 'Jira credentials not configured (check JIRA_EMAIL and JIRA_API_TOKEN env vars)',
      };
    }

    const adapterResult = await postJiraComment({
      externalId: ref.externalId,
      repoRef: ref.repoRef,
      text: sanitized,
      baseUrl: jiraConfig.baseUrl,
      email,
      token,
    });

    if (!adapterResult.ok) {
      return { ok: false, error: 'provider-failure', detail: adapterResult.detail };
    }

    storeCommentRef({
      projectId,
      workItemId: input.workItemId,
      provider: 'jira',
      commentId: adapterResult.commentId,
      url: adapterResult.url,
      repoRef: ref.repoRef,
      sourceKind: input.kind,
      repository: repo,
    });

    return {
      ok: true,
      provider: 'jira',
      commentId: adapterResult.commentId,
      url: adapterResult.url,
    };
  }

  // bitbucket
  const ref = refs.find((r) => r.provider === 'bitbucket' && r.kind === 'pull_request') ?? null;
  if (ref == null) {
    return {
      ok: false,
      error: 'no-ref',
      detail: 'no linked Bitbucket PR found for this work item',
    };
  }

  const bbConfig =
    project?.source.kind === 'local-db' ? project.source.integrations?.bitbucket : undefined;
  const username = process.env.BITBUCKET_USERNAME ?? '';
  const token = process.env.BITBUCKET_TOKEN ?? process.env.BITBUCKET_APP_PASSWORD ?? '';

  if (bbConfig == null || username.length === 0 || token.length === 0) {
    return {
      ok: false,
      error: 'no-credentials',
      detail:
        'Bitbucket credentials not configured (check BITBUCKET_USERNAME and BITBUCKET_TOKEN env vars)',
    };
  }

  const adapterResult = await postBitbucketComment({
    externalId: ref.externalId,
    repoRef: ref.repoRef,
    text: sanitized,
    username,
    token,
  });

  if (!adapterResult.ok) {
    return { ok: false, error: 'provider-failure', detail: adapterResult.detail };
  }

  storeCommentRef({
    projectId,
    workItemId: input.workItemId,
    provider: 'bitbucket',
    commentId: adapterResult.commentId,
    url: adapterResult.url,
    repoRef: ref.repoRef,
    sourceKind: input.kind,
    repository: repo,
  });

  return {
    ok: true,
    provider: 'bitbucket',
    commentId: adapterResult.commentId,
    url: adapterResult.url,
  };
}
