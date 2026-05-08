/**
 * Unit tests for `approvePRD` and `rejectPRD` (M13.08).
 *
 * Mocks the project loader and the source-resolver, but exercises the real
 * `InMemoryLabelsSource` so transitions and comments are validated against
 * the actual state machine.
 */
import { eventStore } from '@goose-hub/core/event-stream/store.js';
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
// approvePRD/rejectPRD don't pull the real grill/decompose workflows into
// these unit tests. We assert call-counts to verify the wiring.
const { dispatchDecomposePrdMock, dispatchGrillAndPrdMock } = vi.hoisted(() => ({
  dispatchDecomposePrdMock: vi.fn().mockResolvedValue(undefined),
  dispatchGrillAndPrdMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../shared/dispatch.js', () => ({
  dispatchDecomposePrd: dispatchDecomposePrdMock,
  dispatchGrillAndPrd: dispatchGrillAndPrdMock,
}));

import { getSourceForSlug } from '#shared/source.js';
import { approvePRD, rejectPRD } from './prd-actions.js';

const REPO_REF = 'test-owner/test-repo';

function uniqueProjectId(label: string): string {
  return `prd-actions-${label}-${Math.random().toString(36).slice(2, 10)}`;
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

    const result = await approvePRD(projectId, item.externalId);
    expect(result.ok).toBe(true);

    const after = await source.getItem(item.externalId);
    expect(after.state).toBe('factory:decomposing');

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

describe('rejectPRD', () => {
  it('returns to grilling, posts the rejection comment without system marker (so griller sees it), and emits prd.rejected', async () => {
    const projectId = uniqueProjectId('reject-happy');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await source.seedIssue({
      title: 'Build Y',
      body: 'desc',
      type: 'feature',
      priority: 'medium',
      state: 'factory:prd-review',
    });
    vi.mocked(getSourceForSlug).mockResolvedValue(source);

    const result = await rejectPRD(projectId, item.externalId);
    expect(result.ok).toBe(true);

    const after = await source.getItem(item.externalId);
    expect(after.state).toBe('factory:grilling');

    const comments = await source.listComments(item.externalId);
    const last = comments[comments.length - 1];
    expect(last.body).toContain('PRD rejected');
    expect(last.body).not.toContain('<!-- factory:system -->');

    const evs = eventStore.replay({ projectId, workItemId: item.id });
    expect(evs.find((e) => e.kind === 'prd.rejected')).toBeDefined();

    await Promise.resolve();
    expect(dispatchGrillAndPrdMock).toHaveBeenCalledWith(projectId, Number(item.externalId));
  });

  it('returns 409 when the issue is not in factory:prd-review', async () => {
    const projectId = uniqueProjectId('reject-wrong-state');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await source.seedIssue({
      title: 'Build Z',
      body: 'desc',
      type: 'feature',
      priority: 'medium',
      state: 'factory:done',
    });
    vi.mocked(getSourceForSlug).mockResolvedValue(source);

    const result = await rejectPRD(projectId, item.externalId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it('returns 404 when the project is not found', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValue(null);
    const result = await rejectPRD('unknown', '1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});
