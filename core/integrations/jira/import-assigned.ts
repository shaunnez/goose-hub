import {
  type LocalDbExternalRefRow,
  LocalDbWorkItemRepository,
  parseExternalRefMetadata,
} from '../../state-source/local-db-repository.js';
import type { ProjectConfig } from '../../types.js';
import type { AtlassianSearchPage, JiraProviderAdapter } from '../atlassian/adapters.js';
import type { JiraIssueCardDto } from '../atlassian/dtos.js';
import { type ProviderResult, providerFailure } from '../atlassian/errors.js';
import { executeJiraQuery } from '../atlassian/query.js';
import { importJiraIssueDetailToLocalDb } from './import-issue.js';

export interface ImportAssignedJiraIssuesToLocalDbInput {
  projectConfig: ProjectConfig;
  adapter: JiraProviderAdapter;
  milestone?: {
    id: string;
    title?: string | null;
  };
  repository?: LocalDbWorkItemRepository;
  maxResults?: number;
  updatedSince?: string;
  updatedUntil?: string;
  now?: () => Date;
}

export interface AssignedJiraImportCounts {
  imported: number;
  updated: number;
  skipped: number;
  stale: number;
  failed: number;
}

export interface AssignedJiraImportFailure {
  jiraKey: string;
  error: string;
}

export interface ImportAssignedJiraIssuesToLocalDbResult {
  counts: AssignedJiraImportCounts;
  failures: AssignedJiraImportFailure[];
  user: {
    accountId: string;
    displayName?: string;
  };
}

export async function importAssignedJiraIssuesToLocalDb(
  input: ImportAssignedJiraIssuesToLocalDbInput,
): Promise<ProviderResult<ImportAssignedJiraIssuesToLocalDbResult>> {
  const cfg = input.projectConfig;
  const jira = cfg.source.kind === 'local-db' ? cfg.source.integrations?.jira : undefined;
  if (cfg.source.kind !== 'local-db' || jira?.enabled !== true) {
    return providerFailure('validation', 'Jira integration is not enabled for this project');
  }
  if (jira.importMode !== 'assigned-to-me') {
    return providerFailure(
      'validation',
      'Jira assigned-to-me import is not enabled for this project',
    );
  }

  const user = await input.adapter.getCurrentUser();
  if (!user.ok) return user;

  const page = await executeJiraQuery<AtlassianSearchPage<JiraIssueCardDto>>({
    config: {
      baseUrl: jira.baseUrl,
      projectKeys: jira.projectKeys,
    },
    input: {
      kind: 'assigned-to-me',
      accountId: user.data.accountId,
      maxResults: input.maxResults,
      updatedSince: input.updatedSince,
      updatedUntil: input.updatedUntil,
    },
    caps: { maxResults: 50, maxLookbackDays: 90 },
    now: input.now?.() ?? new Date(),
    adapter: input.adapter,
  });
  if (!page.ok) return page;

  const repository = input.repository ?? new LocalDbWorkItemRepository();
  const counts: AssignedJiraImportCounts = {
    imported: 0,
    updated: 0,
    skipped: 0,
    stale: 0,
    failed: 0,
  };
  const failures: AssignedJiraImportFailure[] = [];
  const returnedKeys = new Set<string>();
  const syncNow = (input.now?.() ?? new Date()).toISOString();

  for (const issue of page.data.issues ?? []) {
    const key = issue.key?.trim();
    if (key == null || key.length === 0 || returnedKeys.has(key)) {
      counts.skipped += 1;
      continue;
    }
    returnedKeys.add(key);

    const detail = await input.adapter.getIssue({ key, tier: 'detail' });
    if (!detail.ok) {
      counts.failed += 1;
      failures.push({ jiraKey: key, error: detail.error.message });
      continue;
    }

    const imported = await importJiraIssueDetailToLocalDb({
      projectConfig: cfg,
      detail: detail.data,
      milestone: input.milestone,
      repository,
      now: () => new Date(syncNow),
      metadataPatch: {
        assignedToMe: {
          accountId: user.data.accountId,
          displayName: user.data.displayName,
        },
        stale: false,
        hidden: false,
        staleReason: null,
        lastAssignedSyncAt: syncNow,
      },
    });
    if (!imported.ok) {
      counts.failed += 1;
      failures.push({ jiraKey: key, error: imported.error.message });
      continue;
    }
    if (imported.data.imported) counts.imported += 1;
    else counts.updated += 1;
  }

  counts.stale = markStaleAssignedRefs({
    cfg,
    repository,
    currentAccountId: user.data.accountId,
    returnedKeys,
    syncNow,
  });

  return {
    ok: true,
    data: {
      counts,
      failures,
      user: user.data,
    },
  };
}

function markStaleAssignedRefs(input: {
  cfg: ProjectConfig;
  repository: LocalDbWorkItemRepository;
  currentAccountId: string;
  returnedKeys: Set<string>;
  syncNow: string;
}): number {
  let stale = 0;
  const refs = input.repository.listExternalRefsByKind({
    projectId: input.cfg.id,
    provider: 'jira',
    kind: 'issue',
  });
  for (const ref of refs) {
    if (input.returnedKeys.has(ref.externalId)) continue;
    const metadata = metadataRecord(ref);
    const assigned = metadataRecordValue(metadata.assignedToMe);
    if (assigned.accountId !== input.currentAccountId) continue;

    input.repository.upsertExternalRef({
      projectId: input.cfg.id,
      itemId: ref.workItemId,
      provider: ref.provider,
      kind: ref.kind,
      repoRef: ref.repoRef,
      externalId: ref.externalId,
      url: ref.url,
      metadata: {
        ...metadata,
        stale: true,
        hidden: true,
        staleReason: 'not_assigned_to_current_user',
        lastAssignedSyncAt: input.syncNow,
      },
    });
    stale += 1;
  }
  return stale;
}

function metadataRecord(ref: LocalDbExternalRefRow): Record<string, unknown> {
  return metadataRecordValue(parseExternalRefMetadata(ref));
}

function metadataRecordValue(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
