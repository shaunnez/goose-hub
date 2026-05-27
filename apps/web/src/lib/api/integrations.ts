import { postJson } from './client.js';

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
