import type { Priority, WorkItemType } from '../../state-source/interface.js';
import { LocalDbWorkItemRepository } from '../../state-source/local-db-repository.js';
import type { ProjectConfig } from '../../types.js';
import type { JiraProviderAdapter } from '../atlassian/adapters.js';
import type { JiraIssueDetailDto } from '../atlassian/dtos.js';
import { type ProviderResult, providerFailure } from '../atlassian/errors.js';
import { executeJiraQuery } from '../atlassian/query.js';

export interface ImportJiraIssueToLocalDbInput {
  projectConfig: ProjectConfig;
  input: string;
  adapter: JiraProviderAdapter;
  repository?: LocalDbWorkItemRepository;
  now?: () => Date;
}

export interface ImportJiraIssueToLocalDbResult {
  imported: boolean;
  itemId: string;
  externalId: string;
  jiraKey: string;
  jiraUrl: string;
  title: string;
}

export async function importJiraIssueToLocalDb(
  input: ImportJiraIssueToLocalDbInput,
): Promise<ProviderResult<ImportJiraIssueToLocalDbResult>> {
  const cfg = input.projectConfig;
  const jira = cfg.source.kind === 'local-db' ? cfg.source.integrations?.jira : undefined;
  if (cfg.source.kind !== 'local-db' || jira?.enabled !== true) {
    return providerFailure('validation', 'Jira integration is not enabled for this project');
  }
  if (jira.importMode !== 'manual') {
    return providerFailure('validation', 'Jira manual import is not enabled for this project');
  }

  const detail = await executeJiraQuery<JiraIssueDetailDto>({
    config: {
      baseUrl: jira.baseUrl,
      projectKeys: jira.projectKeys,
    },
    input: {
      kind: 'manual',
      value: input.input,
      tier: 'detail',
    },
    adapter: input.adapter,
  });
  if (!detail.ok) return detail;

  const jiraKey = detail.data.key;
  if (jiraKey == null || jiraKey.trim().length === 0) {
    return providerFailure('validation', 'Jira issue detail is missing a key');
  }

  const repository = input.repository ?? new LocalDbWorkItemRepository();
  const existing = repository.getWorkItemByExternalRef({
    projectId: cfg.id,
    provider: 'jira',
    kind: 'issue',
    repoRef: null,
    externalId: jiraKey,
  });
  const mapped = mapJiraIssueToWorkItem(detail.data);
  const row =
    existing == null
      ? repository.createWorkItem({ projectId: cfg.id, ...mapped })
      : repository.updateWorkItem(cfg.id, existing.id, mapped);

  repository.upsertExternalRef({
    projectId: cfg.id,
    itemId: row.id,
    provider: 'jira',
    kind: 'issue',
    repoRef: null,
    externalId: jiraKey,
    url: detail.data.url,
    metadata: jiraExternalRefMetadata(detail.data, input.now?.() ?? new Date()),
  });

  return {
    ok: true,
    data: {
      imported: existing == null,
      itemId: row.id,
      externalId: row.externalId,
      jiraKey,
      jiraUrl: detail.data.url,
      title: row.title,
    },
  };
}

function mapJiraIssueToWorkItem(issue: JiraIssueDetailDto): {
  title: string;
  body: string;
  type: WorkItemType;
  priority: Priority;
} {
  return {
    title: issue.title,
    body: issue.bodyPreview ?? '',
    type: mapJiraIssueType(issue.issueType),
    priority: mapJiraPriority(issue.priority),
  };
}

function jiraExternalRefMetadata(issue: JiraIssueDetailDto, syncedAt: Date) {
  return {
    status: issue.status,
    assignee: issue.assignee ?? null,
    issueType: issue.issueType ?? null,
    priority: issue.priority ?? null,
    project: issue.project ?? null,
    labels: issue.labels,
    components: issue.components,
    linkedKeys: issue.linkedKeys,
    bodyArtifactRef: issue.bodyArtifactRef ?? null,
    rawArtifactRef: issue.rawArtifactRef ?? null,
    lastSyncedAt: syncedAt.toISOString(),
  };
}

function mapJiraIssueType(issueType: string | undefined): WorkItemType {
  const normalized = issueType?.trim().toLowerCase() ?? '';
  if (normalized.includes('bug') || normalized.includes('defect')) return 'bug';
  if (normalized.includes('spike') || normalized.includes('research')) return 'research';
  if (normalized.includes('task') || normalized.includes('chore')) return 'chore';
  return 'feature';
}

function mapJiraPriority(priority: string | undefined): Priority {
  const normalized = priority?.trim().toLowerCase() ?? '';
  if (normalized.includes('critical') || normalized.includes('highest') || normalized === 'p0') {
    return 'critical';
  }
  if (normalized.includes('high') || normalized === 'p1') return 'high';
  if (normalized.includes('low') || normalized.includes('lowest') || normalized === 'p3') {
    return 'low';
  }
  return 'medium';
}
