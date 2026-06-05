import { registerTestOutcomes } from '@goose-hub/core/agent-runtime/mock-test-registry.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { minePatterns } from '@goose-hub/core/learning/mine.js';
import { logger } from '@goose-hub/core/logger.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import type { SeedIssueOptions } from '@goose-hub/core/state-source/in-memory-labels.js';
import type {
  Priority,
  StateSource,
  WorkItem,
  WorkItemType,
} from '@goose-hub/core/state-source/interface.js';
import { LocalDbWorkItemRepository } from '@goose-hub/core/state-source/local-db-repository.js';
import {
  SkillCoachForbiddenTargetError,
  SkillCoachMissingSourceError,
  runSkillCoachingWorkflow,
} from '@goose-hub/core/workflows/skill-coaching.js';
import { Hono } from 'hono';
import {
  dispatchForIssue,
  dispatchProjectTick,
  dispatchQa,
  dispatchRetro,
  dispatchReview,
} from '#shared/dispatch.js';
import { parseBody } from '#shared/middleware.js';
import { getSourceForSlug } from '#shared/source.js';
import { runQaBatch } from './qa-batch.js';
import { runRetroBatch } from './retro-batch.js';
import { runReviewBatch } from './review-batch.js';
const router = new Hono();

const localDbTestRefs = new LocalDbWorkItemRepository();

function hasSeedIssue(source: StateSource): source is StateSource & {
  seedIssue(opts: SeedIssueOptions): Promise<WorkItem>;
} {
  return typeof (source as { seedIssue?: unknown }).seedIssue === 'function';
}

function withDependsOn(body: string | undefined, dependsOn: string[] | undefined): string {
  const base = body ?? '';
  if (dependsOn == null || dependsOn.length === 0) return base;
  const line = `Depends on: ${dependsOn.join(', ')}`;
  return base.length === 0 ? line : `${base}\n\n${line}`;
}

async function seedFixtureIssue(
  source: StateSource,
  input: {
    title: string;
    body?: string;
    type?: WorkItemType;
    priority?: Priority;
    state?: StateName;
    milestoneTitle?: string;
    dependsOn?: string[];
    prDiff?: string;
  },
): Promise<WorkItem> {
  if (hasSeedIssue(source)) {
    return source.seedIssue(input);
  }

  const item = await source.createIssue({
    title: input.title,
    body: withDependsOn(input.body, input.dependsOn),
    type: input.type,
    priority: input.priority,
    initialState: input.state,
  });
  if (item.id.startsWith(`local:${source.projectId}#`)) {
    if (!source.repoRef.startsWith('local:')) {
      await source.createRepoLink?.({
        itemId: item.id,
        repoRef: source.repoRef,
        role: 'primary',
        confidence: 1,
        source: 'mock-seed',
      });
      localDbTestRefs.upsertExternalRef({
        projectId: source.projectId,
        itemId: item.id,
        provider: 'github',
        kind: 'issue',
        repoRef: source.repoRef,
        externalId: item.externalId,
        url: `https://github.com/${source.repoRef}/issues/${item.externalId}`,
        metadata: { source: 'mock-seed' },
      });
      if (input.prDiff != null) {
        localDbTestRefs.upsertExternalRef({
          projectId: source.projectId,
          itemId: item.id,
          provider: 'github',
          kind: 'pull_request',
          repoRef: source.repoRef,
          externalId: item.externalId,
          url: `https://github.com/${source.repoRef}/pull/${item.externalId}`,
          metadata: { source: 'mock-seed', mockPrDiff: input.prDiff },
        });
      }
    }
  }
  return source.getItem(item.id);
}

router.post('/:slug/tick', async (c) => {
  const slug = c.req.param('slug');
  dispatchProjectTick(slug).catch((err: unknown) => {
    logger.error('project tick failed', { slug, error: String(err) });
  });
  return c.json({ ok: true, slug }, 202);
});

router.post('/:slug/run-qa', async (c) => {
  const slug = c.req.param('slug');
  runQaBatch(slug).catch((err: unknown) => {
    logger.error('qa-batch failed', { slug, error: String(err) });
  });
  return c.json({ ok: true, slug }, 202);
});

router.post('/:slug/run-qa/:n', async (c) => {
  const slug = c.req.param('slug');
  const n = Number(c.req.param('n'));
  if (!Number.isFinite(n)) {
    return c.json({ ok: false, error: 'invalid issue number' }, 400);
  }
  dispatchQa(slug, n).catch((err: unknown) => {
    logger.error('dispatchQa failed', { slug, n, error: String(err) });
  });
  return c.json({ ok: true, slug, issueNumber: n }, 202);
});

router.post('/:slug/run-review', async (c) => {
  const slug = c.req.param('slug');
  runReviewBatch(slug).catch((err: unknown) => {
    logger.error('review-batch failed', { slug, error: String(err) });
  });
  return c.json({ ok: true, slug }, 202);
});

router.post('/:slug/run-review/:n', async (c) => {
  const slug = c.req.param('slug');
  const n = Number(c.req.param('n'));
  if (!Number.isFinite(n)) {
    return c.json({ ok: false, error: 'invalid issue number' }, 400);
  }
  dispatchReview(slug, n).catch((err: unknown) => {
    logger.error('dispatchReview failed', { slug, n, error: String(err) });
  });
  return c.json({ ok: true, slug, issueNumber: n }, 202);
});

router.post('/:slug/run-retro', async (c) => {
  const slug = c.req.param('slug');
  runRetroBatch(slug).catch((err: unknown) => {
    logger.error('retro-batch failed', { slug, error: String(err) });
  });
  return c.json({ ok: true, slug }, 202);
});

router.post('/:slug/run-retro/:n', async (c) => {
  const slug = c.req.param('slug');
  const n = Number(c.req.param('n'));
  if (!Number.isFinite(n)) {
    return c.json({ ok: false, error: 'invalid issue number' }, 400);
  }
  dispatchRetro(slug, n).catch((err: unknown) => {
    logger.error('dispatchRetro failed', { slug, n, error: String(err) });
  });
  return c.json({ ok: true, slug, issueNumber: n }, 202);
});

router.post('/:slug/dispatch/:n', async (c) => {
  const slug = c.req.param('slug');
  const n = Number(c.req.param('n'));
  if (!Number.isFinite(n)) {
    return c.json({ ok: false, error: 'invalid issue number' }, 400);
  }
  dispatchForIssue(slug, n).catch((err: unknown) => {
    logger.error('dispatchForIssue failed', { slug, n, error: String(err) });
  });
  return c.json({ ok: true, slug, issueNumber: n }, 202);
});

router.post('/:slug/learning/mine', (c) => {
  const slug = c.req.param('slug');
  const since = c.req.query('since');
  try {
    minePatterns({ projectId: slug, since });
    return c.json({ ok: true, slug }, 200);
  } catch (err) {
    logger.error('minePatterns failed', { slug, error: String(err) });
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

router.post('/:slug/coach', async (c) => {
  const slug = c.req.param('slug');
  const body = await parseBody<{
    targetSkillName?: string;
    patternIds?: string[];
    lifecycleIds?: number[];
  }>(c);
  if (!body.ok) return body.error;

  const { targetSkillName, patternIds, lifecycleIds } = body.data;
  if (!targetSkillName || typeof targetSkillName !== 'string') {
    return c.json({ error: 'targetSkillName is required' }, 400);
  }
  if (!Array.isArray(patternIds)) {
    return c.json({ error: 'patternIds must be an array' }, 400);
  }

  try {
    const result = await runSkillCoachingWorkflow({
      projectId: slug,
      targetSkillName,
      evidence: { patternIds, lifecycleIds },
    });
    if (!result.ok) {
      return c.json({ error: result.error }, 500);
    }
    return c.json(
      {
        candidateId: result.candidateId,
        skillName: result.skillName,
        confidence: result.confidence,
        hasPatch: result.proposedPatch.length > 0,
      },
      201,
    );
  } catch (err) {
    if (err instanceof SkillCoachForbiddenTargetError) {
      return c.json({ error: err.message }, 400);
    }
    if (err instanceof SkillCoachMissingSourceError) {
      return c.json({ error: err.message }, 400);
    }
    logger.error('coach workflow failed', { slug, error: String(err) });
    return c.json({ error: String(err) }, 500);
  }
});

// Seed endpoint: only active when MOCK_SOURCE=true. Creates fixture issues in
// the configured source for deterministic E2E pipeline specs.
if (process.env.MOCK_SOURCE === 'true') {
  router.post('/test/:slug/seed-issue', async (c) => {
    const slug = c.req.param('slug');
    const body = await parseBody<{
      title?: string;
      body?: string;
      type?: WorkItemType;
      priority?: Priority;
      state?: string;
      milestoneTitle?: string;
      dependsOn?: string[];
      prDiff?: string;
      outcomes?: Partial<Record<string, string | string[]>>;
      throwMergeConflict?: boolean;
    }>(c);
    if (!body.ok) return body.error;

    if (!body.data.title) return c.json({ error: 'title is required' }, 400);

    const source = await getSourceForSlug(slug);
    if (source == null) return c.json({ error: 'project not found' }, 404);
    const item = await seedFixtureIssue(source, {
      title: body.data.title,
      body: body.data.body,
      type: body.data.type,
      priority: body.data.priority,
      state: body.data.state as StateName | undefined,
      milestoneTitle: body.data.milestoneTitle,
      dependsOn: body.data.dependsOn,
      prDiff: body.data.prDiff,
    });

    if (body.data.outcomes != null || body.data.throwMergeConflict != null) {
      registerTestOutcomes(item.id, {
        outcomes: body.data.outcomes,
        throwMergeConflict: body.data.throwMergeConflict,
      });
    }

    return c.json({ issueNumber: Number(item.externalId), workItemId: item.id }, 201);
  });

  router.post('/test/:slug/issues/:id/seed-prd', async (c) => {
    const slug = c.req.param('slug');
    const id = c.req.param('id');
    const body = await parseBody<{
      prd?: unknown;
      advisorConcerns?: string[] | string | null;
      runId?: string;
    }>(c);
    if (!body.ok) return body.error;
    if (body.data.prd == null) return c.json({ error: 'prd is required' }, 400);

    const source = await getSourceForSlug(slug);
    if (source == null) return c.json({ error: 'project not found' }, 404);

    const item = await source.getItem(id);
    const runId = body.data.runId ?? `seed-prd:${id}:${Date.now()}`;
    eventStore.appendEvent({
      projectId: slug,
      workItemId: item.id,
      kind: 'prd.drafted',
      runId,
      payload: {
        displaySkill: 'write-prd',
        workflowRunId: runId,
        prd: body.data.prd,
        advisorConcerns: body.data.advisorConcerns ?? null,
      },
    });

    return c.json({ ok: true, workItemId: item.id, runId }, 201);
  });
}

export { router as workflowsRouter };
