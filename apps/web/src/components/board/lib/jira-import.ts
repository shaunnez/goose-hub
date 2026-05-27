import type { ProjectSummary } from '@/lib/types';

export function canUseManualJiraImport(project: ProjectSummary | undefined): boolean {
  if (project?.source.kind !== 'local-db') return false;
  const integrations = project.source.integrations;
  if (integrations == null || typeof integrations !== 'object') return false;
  const jira = (integrations as { jira?: unknown }).jira;
  if (jira == null || typeof jira !== 'object') return false;
  return (
    (jira as { enabled?: unknown }).enabled === true &&
    (jira as { importMode?: unknown }).importMode === 'manual'
  );
}
