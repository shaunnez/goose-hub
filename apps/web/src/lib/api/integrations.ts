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
