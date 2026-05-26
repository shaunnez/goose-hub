import { resolveState } from '../../state-machine/conflict-resolver.js';
import type { GithubIssue } from '../../state-source/github-issue-mapper.js';
import type { WorkItemType } from '../../state-source/interface.js';
import {
  LABEL_GROUPS,
  extractLabelValue,
  parseExec,
  parseMode,
  parsePriority,
  parseSchedule,
  parseWorkItemType,
} from '../../state-source/label-parsers.js';
import { LocalDbWorkItemRepository } from '../../state-source/local-db-repository.js';
import type { ProjectConfig } from '../../types.js';
import { listGithubIssues } from './issues.js';

export interface ImportGithubIssuesResult {
  imported: number;
  updated: number;
  skipped: number;
  repoRefs: string[];
}

export interface ImportGithubIssuesInput {
  projectConfig: ProjectConfig;
  token?: string;
  fetchImpl?: typeof fetch;
  repository?: LocalDbWorkItemRepository;
  issuesByRepo?: Record<string, GithubIssue[]>;
}

export async function importGitHubIssuesToLocalDb(
  input: ImportGithubIssuesInput,
): Promise<ImportGithubIssuesResult> {
  const cfg = input.projectConfig;
  const github = cfg.source.kind === 'local-db' ? cfg.source.integrations?.github : undefined;
  if (cfg.source.kind !== 'local-db' || github?.importIssues !== true) {
    return { imported: 0, updated: 0, skipped: 0, repoRefs: [] };
  }

  const repoRefs = github.repos.length > 0 ? github.repos : cfg.repos;
  const repository = input.repository ?? new LocalDbWorkItemRepository();
  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const repoRef of repoRefs) {
    const issues =
      input.issuesByRepo?.[repoRef] ??
      (input.token != null
        ? await listGithubIssues({ repoRef, token: input.token, fetchImpl: input.fetchImpl })
        : []);
    if (issues.length === 0 && input.issuesByRepo == null && input.token == null) {
      skipped += 1;
      continue;
    }

    for (const issue of issues) {
      const existing = repository.getWorkItemByExternalRef({
        projectId: cfg.id,
        provider: 'github',
        kind: 'issue',
        repoRef,
        externalId: String(issue.number),
      });
      const mapped = mapImportedIssue(issue);
      const row =
        existing == null
          ? repository.createWorkItem({ projectId: cfg.id, ...mapped })
          : repository.updateWorkItem(cfg.id, existing.id, mapped);
      if (existing == null) imported += 1;
      else updated += 1;

      repository.createRepoLink({
        projectId: cfg.id,
        itemId: row.id,
        repoRef,
        role: 'primary',
        source: 'github-import',
      });
      repository.upsertExternalRef({
        projectId: cfg.id,
        itemId: row.id,
        provider: 'github',
        kind: 'issue',
        repoRef,
        externalId: String(issue.number),
        url: `https://github.com/${repoRef}/issues/${issue.number}`,
        metadata: { importedAt: new Date().toISOString() },
      });
    }
  }

  return { imported, updated, skipped, repoRefs };
}

function mapImportedIssue(issue: GithubIssue) {
  const labels = issue.labels.map((label) => label.name);
  const state = issue.labels.length > 0 ? resolveState(labels).state : issueStateFallback(issue);
  return {
    title: issue.title,
    body: issue.body ?? '',
    state,
    type: parseWorkItemType(extractLabelValue(labels, LABEL_GROUPS.TYPE)) as WorkItemType,
    priority: parsePriority(extractLabelValue(labels, LABEL_GROUPS.PRIORITY)),
    mode: parseMode(extractLabelValue(labels, LABEL_GROUPS.MODE)),
    schedule: parseSchedule(extractLabelValue(labels, LABEL_GROUPS.SCHEDULE)),
    exec: parseExec(extractLabelValue(labels, LABEL_GROUPS.EXEC)),
    milestoneId: issue.milestone == null ? null : String(issue.milestone.number),
    milestoneTitle: issue.milestone?.title ?? null,
  };
}

function issueStateFallback(issue: GithubIssue) {
  return (issue as { state?: string }).state === 'closed' ? 'factory:done' : 'factory:triaging';
}
