import { describe, expect, it } from 'vitest';
import {
  AtlassianDetailSchema,
  AtlassianEvidenceSchema,
  AtlassianHeadlineSchema,
  BitbucketPullRequestDiffSchema,
} from './dtos.js';

describe('Atlassian DTO schemas', () => {
  it('accepts headline, detail, and evidence tiers with artifact refs for provider bodies', () => {
    expect(
      AtlassianHeadlineSchema.parse({
        provider: 'jira',
        resourceKind: 'issue',
        tier: 'headline',
        id: 'TAS-123',
        key: 'TAS-123',
        title: 'Ship the import boundary',
        status: 'To Do',
        url: 'https://company.atlassian.net/browse/TAS-123',
        totalCount: 1,
        hasMore: false,
      }),
    ).toMatchObject({ tier: 'headline', key: 'TAS-123' });

    expect(
      AtlassianDetailSchema.parse({
        provider: 'jira',
        resourceKind: 'issue',
        tier: 'detail',
        id: 'TAS-123',
        key: 'TAS-123',
        title: 'Ship the import boundary',
        status: 'To Do',
        url: 'https://company.atlassian.net/browse/TAS-123',
        project: 'TAS',
        issueType: 'Story',
        assignee: { displayName: 'Ada Lovelace' },
        priority: 'High',
        created: '2026-05-27T00:00:00Z',
        updated: '2026-05-27T01:00:00Z',
        bodyPreview: 'A capped description preview',
        bodyArtifactRef: {
          stored: true,
          artifactKey: 'atlassian:jira:detail:TAS-123:abc',
          kind: 'atlassian:jira:detail:TAS-123',
          summary: 'Full Jira description',
          bytes: 1024,
        },
        rawArtifactRef: {
          stored: true,
          artifactKey: 'atlassian:jira:evidence:TAS-123:def',
          kind: 'atlassian:jira:evidence:TAS-123',
          summary: 'Raw Jira issue response',
          bytes: 2048,
        },
        labels: ['factory'],
        components: ['hub'],
        linkedKeys: ['TAS-456'],
      }),
    ).toMatchObject({ tier: 'detail', bodyPreview: 'A capped description preview' });

    expect(
      AtlassianEvidenceSchema.parse({
        provider: 'bitbucket',
        resourceKind: 'pull_request',
        tier: 'evidence',
        id: '45',
        url: 'https://bitbucket.org/company/api/pull-requests/45',
        commentsSummary: '3 comments stored as artifact',
        historySummary: '2 state changes stored as artifact',
        attachmentSummaries: ['build-log.txt'],
        artifactRefs: [
          {
            stored: true,
            artifactKey: 'atlassian:bitbucket:evidence:45:def',
            kind: 'atlassian:bitbucket:evidence:45',
            summary: 'Bitbucket comments',
            bytes: 2048,
          },
        ],
      }),
    ).toMatchObject({ provider: 'bitbucket', tier: 'evidence' });

    expect(
      BitbucketPullRequestDiffSchema.parse({
        provider: 'bitbucket',
        resourceKind: 'pull_request',
        repoRef: 'company/api',
        externalId: '45',
        diff: 'diff --git a/a.ts b/a.ts',
        url: 'https://bitbucket.org/company/api/pull-requests/45',
      }),
    ).toMatchObject({ provider: 'bitbucket', resourceKind: 'pull_request' });
  });

  it('rejects inline raw provider payloads at the service boundary', () => {
    const parsed = AtlassianDetailSchema.safeParse({
      provider: 'jira',
      resourceKind: 'issue',
      tier: 'detail',
      id: 'TAS-123',
      key: 'TAS-123',
      title: 'Raw issue',
      status: 'To Do',
      url: 'https://company.atlassian.net/browse/TAS-123',
      raw: { fields: { summary: 'Raw issue' } },
    });

    expect(parsed.success).toBe(false);
  });
});
