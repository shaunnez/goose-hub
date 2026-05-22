/**
 * Unit tests for `approvePRD` and `rejectPRD` (M13.08).
 *
 * Mocks the project loader and the source-resolver, but exercises the real
 * `InMemoryLabelsSource` so transitions and comments are validated against
 * the actual state machine.
 */
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { open } from '@goose-hub/core/interventions/reducer.js';
import { getIntervention } from '@goose-hub/core/interventions/repository.js';
import { InMemoryLabelsSource } from '@goose-hub/core/state-source/in-memory-labels.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/source.js', () => ({
  getSourceForSlug: vi.fn(),
  isValidSlug: (slug: string) => /^[a-z0-9-]+$/.test(slug),
}));
vi.mock('../../shared/projects.js', () => ({
  getProject: vi
    .fn()
    .mockResolvedValue({ source: { kind: 'github', repo: 'test-owner/test-repo' } }),
}));
// Stub the discover-lane dispatchers so the fire-and-forget calls in
// prd-actions don't pull the real workflows into these unit tests.
const { dispatchDecomposePrdMock, dispatchRetryWritePrdMock, dispatchRevisePrdMock } = vi.hoisted(
  () => ({
    dispatchDecomposePrdMock: vi.fn().mockResolvedValue(undefined),
    dispatchRetryWritePrdMock: vi.fn().mockResolvedValue(undefined),
    dispatchRevisePrdMock: vi.fn().mockResolvedValue(undefined),
  }),
);
vi.mock('../../shared/dispatch.js', () => ({
  dispatchDecomposePrd: dispatchDecomposePrdMock,
  dispatchRetryWritePrd: dispatchRetryWritePrdMock,
  dispatchRevisePrd: dispatchRevisePrdMock,
}));

import { getSourceForSlug } from '#shared/source.js';
import { approvePRD, declinePRD, proceedToPrd, rejectPRD, revisePRD } from './prd-actions.js';

const REPO_REF = 'test-owner/test-repo';

function uniqueProjectId(label: string): string {
  return `prd-actions-${label}-${Math.random().toString(36).slice(2, 10)}`;
}

function openPrdReviewIntervention(projectId: string, workItemId: string) {
  const result = open({
    projectId,
    workItemId,
    interventionType: 'prd_review',
    title: 'PRD review required',
    reason: 'Approve, request changes, or decline the PRD to continue.',
    rootCauseSignature: `state.transitioned|factory:prd-drafting|factory:prd-review|${workItemId}`,
    actor: 'test',
  });
  if (!result.ok) throw new Error(result.error);
  return result.intervention;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('approvePRD', () => {
  it('transitions prd-review → decomposing and emits prd.approved + state.transitioned', async () => {
    const projectId = uniqueProjectId('approve-happy');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await source.seedIssue({
      title: 'Build feature X',
      body: 'desc',
      type: 'feature',
      priority: 'medium',
      state: 'factory:prd-review',
    });
    vi.mocked(getSourceForSlug).mockResolvedValue(source);
    const intervention = openPrdReviewIntervention(projectId, item.id);

    const result = await approvePRD(projectId, item.externalId);
    expect(result.ok).toBe(true);

    const after = await source.getItem(item.externalId);
    expect(after.state).toBe('factory:decomposing');
    expect(getIntervention(intervention.id)?.status).toBe('RESOLVED');

    const evs = eventStore.replay({ projectId, workItemId: item.id });
    expect(evs.find((e) => e.kind === 'prd.approved')).toBeDefined();
    const transitioned = evs.find(
      (e) =>
        e.kind === 'state.transitioned' &&
        (e.payload as { to: string }).to === 'factory:decomposing',
    );
    expect(transitioned).toBeDefined();

    // Wait a microtask cycle for the fire-and-forget dispatcher promise
    // chain to resolve before asserting on the mock.
    await Promise.resolve();
    expect(dispatchDecomposePrdMock).toHaveBeenCalledWith(projectId, Number(item.externalId));
  });

  it('returns 409 when the issue is not in factory:prd-review', async () => {
    const projectId = uniqueProjectId('approve-wrong-state');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await source.seedIssue({
      title: 'Build X',
      body: 'desc',
      type: 'feature',
      priority: 'medium',
      state: 'factory:dev-ready',
    });
    vi.mocked(getSourceForSlug).mockResolvedValue(source);

    const result = await approvePRD(projectId, item.externalId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain('expected state factory:prd-review');
    }
  });

  it('returns 404 when the project is not found', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValue(null);
    const result = await approvePRD('unknown', '1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});

describe('declinePRD', () => {
  it('transitions prd-review → done and emits prd.declined + state.transitioned', async () => {
    const projectId = uniqueProjectId('decline-happy');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await source.seedIssue({
      title: 'Build Y',
      body: 'desc',
      type: 'feature',
      priority: 'medium',
      state: 'factory:prd-review',
    });
    vi.mocked(getSourceForSlug).mockResolvedValue(source);
    const intervention = openPrdReviewIntervention(projectId, item.id);

    const result = await declinePRD(projectId, item.externalId);
    expect(result.ok).toBe(true);

    const after = await source.getItem(item.externalId);
    expect(after.state).toBe('factory:done');
    expect(getIntervention(intervention.id)?.status).toBe('RESOLVED');

    const evs = eventStore.replay({ projectId, workItemId: item.id });
    expect(evs.find((e) => e.kind === 'prd.declined')).toBeDefined();
    const transitioned = evs.find(
      (e) => e.kind === 'state.transitioned' && (e.payload as { to: string }).to === 'factory:done',
    );
    expect(transitioned).toBeDefined();
  });

  it('returns 409 when the issue is not in factory:prd-review', async () => {
    const projectId = uniqueProjectId('decline-wrong-state');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await source.seedIssue({
      title: 'Build Z',
      body: 'desc',
      type: 'feature',
      priority: 'medium',
      state: 'factory:done',
    });
    vi.mocked(getSourceForSlug).mockResolvedValue(source);

    const result = await declinePRD(projectId, item.externalId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it('returns 404 when the project is not found', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValue(null);
    const result = await declinePRD('unknown', '1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});

describe('rejectPRD', () => {
  it('delegates to declinePRD: transitions prd-review → done', async () => {
    const projectId = uniqueProjectId('rejectPRD-delegates');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await source.seedIssue({
      title: 'Legacy reject',
      body: 'desc',
      type: 'feature',
      priority: 'medium',
      state: 'factory:prd-review',
    });
    vi.mocked(getSourceForSlug).mockResolvedValue(source);

    const result = await rejectPRD(projectId, item.externalId);
    expect(result.ok).toBe(true);

    const after = await source.getItem(item.externalId);
    expect(after.state).toBe('factory:done');

    const evs = eventStore.replay({ projectId, workItemId: item.id });
    expect(evs.find((e) => e.kind === 'prd.declined')).toBeDefined();
  });
});

describe('revisePRD', () => {
  it('emits prd.revised and fires dispatchRevisePrd; state stays prd-review', async () => {
    const projectId = uniqueProjectId('revise-happy');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await source.seedIssue({
      title: 'Build feature W',
      body: 'desc',
      type: 'feature',
      priority: 'medium',
      state: 'factory:prd-review',
    });
    vi.mocked(getSourceForSlug).mockResolvedValue(source);
    const priorPrd = { title: 'Stored PRD' };
    const intervention = openPrdReviewIntervention(projectId, item.id);
    eventStore.appendEvent({
      projectId,
      workItemId: item.id,
      kind: 'prd.drafted',
      payload: { prd: priorPrd, advisorConcerns: null },
    });

    const concerns = ['Journey J-1 step 2 is unclear', 'Missing error state for network timeout'];
    const result = await revisePRD(projectId, item.externalId, concerns);
    expect(result.ok).toBe(true);

    // State must remain prd-review
    const after = await source.getItem(item.externalId);
    expect(after.state).toBe('factory:prd-review');
    expect(getIntervention(intervention.id)?.status).toBe('RESOLVED');

    const evs = eventStore.replay({ projectId, workItemId: item.id });
    const revised = evs.find((e) => e.kind === 'prd.revised');
    expect(revised).toBeDefined();
    expect((revised?.payload as { concerns: string[] }).concerns).toEqual(concerns);

    await Promise.resolve();
    expect(dispatchRevisePrdMock).toHaveBeenCalledWith(
      projectId,
      Number(item.externalId),
      priorPrd,
      concerns,
    );
  });

  it('returns 409 and moves to needs-human when no PRD draft can be resolved', async () => {
    const projectId = uniqueProjectId('revise-no-prd');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await source.seedIssue({
      title: 'Build feature with missing PRD',
      body: 'desc',
      type: 'feature',
      priority: 'medium',
      state: 'factory:prd-review',
    });
    vi.mocked(getSourceForSlug).mockResolvedValue(source);

    const result = await revisePRD(projectId, item.externalId, ['Missing detail']);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain('no PRD draft found');
    }
    await expect(source.getItem(item.externalId)).resolves.toMatchObject({
      state: 'factory:needs-human',
    });
    const comments = await source.listComments(item.externalId);
    expect(comments.at(-1)?.body).toContain('revise-prd: no PRD draft found');
    expect(dispatchRevisePrdMock).not.toHaveBeenCalled();
  });

  it('returns 409 when the issue is not in factory:prd-review', async () => {
    const projectId = uniqueProjectId('revise-wrong-state');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await source.seedIssue({
      title: 'Build V',
      body: 'desc',
      type: 'feature',
      priority: 'medium',
      state: 'factory:grilling',
    });
    vi.mocked(getSourceForSlug).mockResolvedValue(source);

    const result = await revisePRD(projectId, item.externalId, ['some concern']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain('expected state factory:prd-review');
    }
  });

  it('returns 404 when the project is not found', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValue(null);
    const result = await revisePRD('unknown', '1', []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});

describe('proceedToPrd', () => {
  it('transitions gate-pending → prd-drafting and fires dispatchRetryWritePrd', async () => {
    const projectId = uniqueProjectId('proceed-happy');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await source.seedIssue({
      title: 'Feature to proceed',
      body: 'desc',
      type: 'feature',
      priority: 'medium',
      state: 'factory:gate-pending',
    });
    vi.mocked(getSourceForSlug).mockResolvedValue(source);
    eventStore.appendEvent({
      projectId,
      workItemId: item.id,
      kind: 'grill.question-posted',
      runId: 'workflow-1',
      payload: { discoverSessionId: 'discover-session-proceed' },
    });

    const result = await proceedToPrd(projectId, item.externalId);
    expect(result.ok).toBe(true);

    const after = await source.getItem(item.externalId);
    expect(after.state).toBe('factory:prd-drafting');

    const evs = eventStore.replay({ projectId, workItemId: item.id });
    const transitioned = evs.find(
      (e) =>
        e.kind === 'state.transitioned' &&
        (e.payload as { to: string }).to === 'factory:prd-drafting',
    );
    expect(transitioned).toBeDefined();
    expect((transitioned?.payload as { discoverSessionId?: string }).discoverSessionId).toBe(
      'discover-session-proceed',
    );

    await Promise.resolve();
    expect(dispatchRetryWritePrdMock).toHaveBeenCalledWith(projectId, Number(item.externalId));
  });

  it('returns 409 when the issue is not in factory:gate-pending', async () => {
    const projectId = uniqueProjectId('proceed-wrong-state');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await source.seedIssue({
      title: 'Feature not pending',
      body: 'desc',
      type: 'feature',
      priority: 'medium',
      state: 'factory:grilling',
    });
    vi.mocked(getSourceForSlug).mockResolvedValue(source);

    const result = await proceedToPrd(projectId, item.externalId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain('expected state factory:gate-pending');
    }
  });

  it('returns 404 when the project is not found', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValue(null);
    const result = await proceedToPrd('unknown', '1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});
