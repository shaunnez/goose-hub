import { eventStore } from '@goose-hub/core/event-stream/store.js';
import type { Result } from '#shared/middleware.js';
import { getSourceForSlug } from '#shared/source.js';
import { getRepoRef } from './internal.js';

const OUTPUT_FIXTURES: Record<string, unknown> = {
  triage: {
    triage: { type: 'feature', priority: 'high' },
    repoMatch: {
      candidates: [
        { repo: 'shaunnez/goose-hub', confidence: 87, evidence: 'keyword match', tier: 1 },
      ],
    },
  },
  investigate: {
    findings: 'Root cause identified',
    confidence: 'high',
    recommendation: 'fix in core',
  },
};

const LOG_LINES = [
  'Fetching issue metadata from GitHub...',
  'Parsing labels and body content...',
  'Scoring priority and work type...',
  'Drafting decision summary...',
  'Finalising structured output...',
];

/**
 * Emit a synthetic agent run for development/UI testing (#203). Disabled in
 * production since the events become part of the durable timeline.
 */
export async function fakeRun(
  slug: string,
  id: string,
  skill: string,
): Promise<Result<{ ok: true; skill: string }>> {
  if (process.env.NODE_ENV === 'production') {
    return { ok: false, error: 'fake-run is disabled in production', status: 404 };
  }

  const safeSkill = skill === 'investigate' ? 'investigate' : 'triage';

  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };

  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;

  (async () => {
    eventStore.appendEvent({
      projectId: slug,
      workItemId,
      kind: 'agent.spawned',
      payload: { skill: safeSkill },
    });
    await new Promise((r) => setTimeout(r, 700));
    for (const line of LOG_LINES) {
      eventStore.appendEvent({ projectId: slug, workItemId, kind: 'agent.log', payload: { line } });
      await new Promise((r) => setTimeout(r, 600));
    }
    eventStore.appendEvent({
      projectId: slug,
      workItemId,
      kind: 'agent.decision-summary',
      payload: { summary: `Running ${safeSkill} skill on issue #${id}` },
    });
    await new Promise((r) => setTimeout(r, 700));
    if (safeSkill === 'triage') {
      const fixture = OUTPUT_FIXTURES.triage as { triage: unknown; repoMatch: unknown };
      eventStore.appendEvent({
        projectId: slug,
        workItemId,
        kind: 'agent.triage-complete',
        payload: fixture,
      });
    }
    eventStore.appendEvent({
      projectId: slug,
      workItemId,
      kind: 'agent.terminated',
      payload: { skill: safeSkill, status: 'completed', output: OUTPUT_FIXTURES[safeSkill] },
    });
  })();

  return { ok: true, data: { ok: true, skill: safeSkill } };
}
