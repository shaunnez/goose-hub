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

export async function importJiraIssue(slug: string, input: string): Promise<JiraImportResponseDto> {
  return postJson<JiraImportResponseDto>(`/projects/${slug}/integrations/jira/import`, { input });
}
