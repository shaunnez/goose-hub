import { describe, expect, it } from 'vitest';
import { eventStore } from '../event-stream/store.js';
import { parseLegacyPrdComment, resolveLatestPrd } from './read-model.js';

function workItemId(issueNumber: number): string {
  return `github:owner/repo#${issueNumber}`;
}

function projectId(label: string): string {
  return `prd-read-model-${label}-${Math.random().toString(36).slice(2, 10)}`;
}

describe('resolveLatestPrd', () => {
  it('prefers the latest local prd.drafted event over a legacy comment', async () => {
    const project = projectId('event-first');
    const item = workItemId(1);
    eventStore.appendEvent({
      projectId: project,
      workItemId: item,
      kind: 'prd.drafted',
      runId: 'run-old',
      payload: { prd: { title: 'Old local PRD' }, advisorConcerns: ['needs tighter ACs'] },
    });
    eventStore.appendEvent({
      projectId: project,
      workItemId: item,
      kind: 'prd.drafted',
      runId: 'run-new',
      payload: { prd: { title: 'New local PRD' }, advisorConcerns: [] },
    });

    const result = await resolveLatestPrd({
      projectId: project,
      workItemId: item,
      loadLegacyComments: async () => [
        {
          body: '<!-- factory:prd -->\n# PRD\n\n```json\n{"title":"Comment PRD"}\n```',
          createdAt: '2026-05-01T00:00:00.000Z',
        },
      ],
    });

    expect(result).toMatchObject({
      prd: { title: 'New local PRD' },
      advisorConcerns: null,
      source: 'event',
      runId: 'run-new',
    });
  });

  it('falls back to the latest legacy marker comment', async () => {
    const result = await resolveLatestPrd({
      projectId: projectId('comment-fallback'),
      workItemId: workItemId(2),
      loadLegacyComments: async () => [
        {
          body: '<!-- factory:prd -->\n# PRD\n\n```json\n{"title":"Old comment PRD"}\n```',
          createdAt: '2026-05-01T00:00:00.000Z',
        },
        {
          body: '<!-- factory:prd -->\n# PRD\n\n```json\n{"title":"New comment PRD"}\n```\n\n## Advisor concerns\n- quantify success',
          createdAt: '2026-05-02T00:00:00.000Z',
        },
      ],
    });

    expect(result).toMatchObject({
      prd: { title: 'New comment PRD' },
      advisorConcerns: '- quantify success',
      source: 'legacy-comment',
      runId: null,
    });
  });

  it('returns a malformed legacy marker as a parse-error result', async () => {
    const result = await resolveLatestPrd({
      projectId: projectId('malformed-comment'),
      workItemId: workItemId(3),
      loadLegacyComments: async () => [
        {
          body: '<!-- factory:prd -->\n# PRD\n\n```json\nnot-json\n```',
          createdAt: '2026-05-03T00:00:00.000Z',
        },
      ],
    });

    expect(result).toMatchObject({
      prd: null,
      advisorConcerns: null,
      source: 'legacy-comment',
    });
  });
});

describe('parseLegacyPrdComment', () => {
  it('ignores non-marker comments', () => {
    expect(parseLegacyPrdComment('hello')).toEqual({ prd: null, advisorConcerns: null });
  });
});
