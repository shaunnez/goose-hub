import type {
  ProviderError,
  ProviderErrorKind,
} from '@goose-hub/core/integrations/atlassian/errors.js';
import { importJiraIssueToLocalDb } from '@goose-hub/core/integrations/jira/import-issue.js';
import { createJiraRestAdapterFromEnv } from '@goose-hub/core/integrations/jira/rest.js';
import type { Result } from '#shared/middleware.js';
import { getProject } from '#shared/projects.js';

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

export interface JiraImportRequestDto {
  input?: unknown;
}

export async function importJiraIssue(
  slug: string,
  body: JiraImportRequestDto,
): Promise<Result<JiraImportResponseDto>> {
  const rawInput = typeof body.input === 'string' ? body.input.trim() : '';
  if (rawInput.length === 0) {
    return { ok: false, error: 'input is required', status: 400 };
  }

  const projectConfig = await getProject(slug);
  if (projectConfig == null) return { ok: false, error: 'project not found', status: 404 };
  const jira =
    projectConfig.source.kind === 'local-db' ? projectConfig.source.integrations?.jira : undefined;
  if (projectConfig.source.kind !== 'local-db' || jira?.enabled !== true) {
    return { ok: false, error: 'Jira integration is not enabled for this project', status: 400 };
  }

  const result = await importJiraIssueToLocalDb({
    projectConfig,
    input: rawInput,
    adapter: createJiraRestAdapterFromEnv({
      baseUrl: jira.baseUrl,
      artifactContext: {
        projectId: projectConfig.id,
        runId: `jira-import:${projectConfig.id}`,
      },
    }),
  });

  if (!result.ok) return providerErrorToHttp(result.error);

  return {
    ok: true,
    data: {
      item: {
        id: result.data.itemId,
        externalId: result.data.externalId,
        jiraKey: result.data.jiraKey,
        jiraUrl: result.data.jiraUrl,
        title: result.data.title,
        imported: result.data.imported,
      },
    },
  };
}

function providerErrorToHttp(error: ProviderError): Result<never> {
  return {
    ok: false,
    error: error.message,
    status: httpStatusForProviderError(error.kind),
  };
}

function httpStatusForProviderError(kind: ProviderErrorKind): number {
  switch (kind) {
    case 'validation':
    case 'query':
      return 400;
    case 'auth':
      return 401;
    case 'permission':
      return 403;
    case 'not_found':
      return 404;
    case 'rate_limit':
      return 429;
    case 'connection':
    case 'post_back':
      return 502;
  }
}
