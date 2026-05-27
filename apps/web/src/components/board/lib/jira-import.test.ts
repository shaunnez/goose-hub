import type { ProjectSummary } from '@/lib/types';
import { describe, expect, it } from 'vitest';
import { canUseAssignedToMeJiraImport, canUseManualJiraImport } from './jira-import';

function project(source: ProjectSummary['source']): ProjectSummary {
  return {
    id: 'proj',
    name: 'Project',
    slug: 'proj',
    color: '#fff',
    source,
  };
}

describe('canUseManualJiraImport', () => {
  it('allows only local-db projects with enabled manual Jira import', () => {
    expect(
      canUseManualJiraImport(
        project({
          kind: 'local-db',
          integrations: {
            jira: {
              enabled: true,
              importMode: 'manual',
            },
          },
        }),
      ),
    ).toBe(true);
    expect(canUseManualJiraImport(project({ kind: 'github', repo: 'owner/repo' }))).toBe(false);
    expect(
      canUseManualJiraImport(
        project({
          kind: 'local-db',
          integrations: {
            jira: {
              enabled: true,
              importMode: 'assigned-to-me',
            },
          },
        }),
      ),
    ).toBe(false);
    expect(canUseManualJiraImport(project({ kind: 'local-db' }))).toBe(false);
  });
});

describe('canUseAssignedToMeJiraImport', () => {
  it('allows only local-db projects with enabled assigned-to-me Jira import', () => {
    expect(
      canUseAssignedToMeJiraImport(
        project({
          kind: 'local-db',
          integrations: {
            jira: {
              enabled: true,
              importMode: 'assigned-to-me',
            },
          },
        }),
      ),
    ).toBe(true);
    expect(canUseAssignedToMeJiraImport(project({ kind: 'github', repo: 'owner/repo' }))).toBe(
      false,
    );
    expect(
      canUseAssignedToMeJiraImport(
        project({
          kind: 'local-db',
          integrations: {
            jira: {
              enabled: true,
              importMode: 'manual',
            },
          },
        }),
      ),
    ).toBe(false);
  });
});
