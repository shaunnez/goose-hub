import type {
  PostBackAvailability,
  PostBackKind,
  PostBackProvider,
} from '@goose-hub/core/integrations/post-back/types.js';
import { getJson, postJson } from './client.js';

export type { PostBackAvailability, PostBackKind, PostBackProvider };

export type PostBackServiceResult =
  | { ok: true; provider: PostBackProvider; commentId: string; url: string | null }
  | {
      ok: false;
      error: 'no-ref' | 'no-credentials' | 'provider-failure' | 'empty-text';
      detail: string;
    };

export interface JiraImportItemDto {
  id: string;
  externalId: string;
  jiraKey: string;
  jiraUrl: string;
  title: string;
  imported: boolean;
}

export interface JiraImportResponseDto {
  item: JiraImportItemDto;
}

export interface JiraAssignedImportCountsDto {
  imported: number;
  updated: number;
  skipped: number;
  stale: number;
  failed: number;
}

export interface JiraAssignedImportFailureDto {
  jiraKey: string;
  error: string;
}

export interface JiraAssignedImportResponseDto {
  counts: JiraAssignedImportCountsDto;
  failures: JiraAssignedImportFailureDto[];
}

export interface JiraImportOptions {
  milestoneNumber?: number | null;
}

export async function importJiraIssue(
  slug: string,
  input: string,
  options: JiraImportOptions = {},
): Promise<JiraImportResponseDto> {
  return postJson<JiraImportResponseDto>(`/projects/${slug}/integrations/jira/import`, {
    input,
    ...(options.milestoneNumber != null ? { milestoneNumber: options.milestoneNumber } : {}),
  });
}

export async function importAssignedJiraIssues(
  slug: string,
  options: JiraImportOptions = {},
): Promise<JiraAssignedImportResponseDto> {
  return postJson<JiraAssignedImportResponseDto>(
    `/projects/${slug}/integrations/jira/import-assigned-to-me`,
    {
      ...(options.milestoneNumber != null ? { milestoneNumber: options.milestoneNumber } : {}),
    },
  );
}

export async function fetchPostBackAvailability(
  slug: string,
  workItemId: string,
): Promise<PostBackAvailability> {
  const { availability } = await getJson<{ availability: PostBackAvailability }>(
    `/projects/${slug}/issues/${workItemId}/integrations/post-back/availability`,
  );
  return availability;
}

export async function postBack(
  slug: string,
  workItemId: string,
  body: { kind: PostBackKind; provider: PostBackProvider; text: string },
): Promise<PostBackServiceResult> {
  return postJson<PostBackServiceResult>(
    `/projects/${slug}/issues/${workItemId}/integrations/post-back`,
    body,
  );
}
