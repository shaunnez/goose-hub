import type {
  ProviderError,
  ProviderErrorKind,
} from '@goose-hub/core/integrations/atlassian/errors.js';
import { importAssignedJiraIssuesToLocalDb } from '@goose-hub/core/integrations/jira/import-assigned.js';
import { importJiraIssueToLocalDb } from '@goose-hub/core/integrations/jira/import-issue.js';
import { createJiraRestAdapterFromEnv } from '@goose-hub/core/integrations/jira/rest.js';
import { LocalDbWorkItemRepository } from '@goose-hub/core/state-source/local-db-repository.js';
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
  milestoneNumber?: unknown;
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

export interface JiraAssignedImportRequestDto {
  milestoneNumber?: unknown;
  maxResults?: unknown;
  updatedSince?: unknown;
  updatedUntil?: unknown;
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

  const repository = new LocalDbWorkItemRepository();
  const milestone = resolveMilestone(projectConfig.id, body.milestoneNumber, repository);
  if (!milestone.ok) return milestone;

  const result = await importJiraIssueToLocalDb({
    projectConfig,
    input: rawInput,
    milestone: milestone.data,
    repository,
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

export async function importAssignedJiraIssues(
  slug: string,
  body: JiraAssignedImportRequestDto,
): Promise<Result<JiraAssignedImportResponseDto>> {
  const projectConfig = await getProject(slug);
  if (projectConfig == null) return { ok: false, error: 'project not found', status: 404 };
  const jira =
    projectConfig.source.kind === 'local-db' ? projectConfig.source.integrations?.jira : undefined;
  if (projectConfig.source.kind !== 'local-db' || jira?.enabled !== true) {
    return { ok: false, error: 'Jira integration is not enabled for this project', status: 400 };
  }
  if (jira.importMode !== 'assigned-to-me') {
    return {
      ok: false,
      error: 'Jira assigned-to-me import is not enabled for this project',
      status: 400,
    };
  }

  const repository = new LocalDbWorkItemRepository();
  const milestone = resolveMilestone(projectConfig.id, body.milestoneNumber, repository);
  if (!milestone.ok) return milestone;
  const options = resolveAssignedOptions(body);
  if (!options.ok) return options;

  const result = await importAssignedJiraIssuesToLocalDb({
    projectConfig,
    milestone: milestone.data,
    repository,
    adapter: createJiraRestAdapterFromEnv({
      baseUrl: jira.baseUrl,
      artifactContext: {
        projectId: projectConfig.id,
        runId: `jira-assigned-import:${projectConfig.id}`,
      },
    }),
    ...options.data,
  });

  if (!result.ok) return providerErrorToHttp(result.error);

  return {
    ok: true,
    data: {
      counts: result.data.counts,
      failures: result.data.failures,
    },
  };
}

function resolveMilestone(
  projectId: string,
  rawMilestoneNumber: unknown,
  repository: LocalDbWorkItemRepository,
): Result<{ id: string; title: string } | undefined> {
  if (rawMilestoneNumber == null) return { ok: true, data: undefined };
  if (typeof rawMilestoneNumber !== 'number' || !Number.isInteger(rawMilestoneNumber)) {
    return { ok: false, error: 'milestoneNumber must be an integer', status: 400 };
  }
  const row = repository.getMilestone(projectId, rawMilestoneNumber);
  if (row == null) return { ok: false, error: 'milestone not found', status: 404 };
  return {
    ok: true,
    data: {
      id: String(row.number),
      title: row.title,
    },
  };
}

function resolveAssignedOptions(body: JiraAssignedImportRequestDto): Result<{
  maxResults?: number;
  updatedSince?: string;
  updatedUntil?: string;
}> {
  const maxResults = optionalInteger(body.maxResults, 'maxResults');
  if (!maxResults.ok) return maxResults;
  const updatedSince = optionalString(body.updatedSince, 'updatedSince');
  if (!updatedSince.ok) return updatedSince;
  const updatedUntil = optionalString(body.updatedUntil, 'updatedUntil');
  if (!updatedUntil.ok) return updatedUntil;
  return {
    ok: true,
    data: {
      ...(maxResults.data != null ? { maxResults: maxResults.data } : {}),
      ...(updatedSince.data != null ? { updatedSince: updatedSince.data } : {}),
      ...(updatedUntil.data != null ? { updatedUntil: updatedUntil.data } : {}),
    },
  };
}

function optionalInteger(value: unknown, name: string): Result<number | undefined> {
  if (value == null) return { ok: true, data: undefined };
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return { ok: false, error: `${name} must be an integer`, status: 400 };
  }
  return { ok: true, data: value };
}

function optionalString(value: unknown, name: string): Result<string | undefined> {
  if (value == null) return { ok: true, data: undefined };
  if (typeof value !== 'string') {
    return { ok: false, error: `${name} must be a string`, status: 400 };
  }
  return { ok: true, data: value };
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
