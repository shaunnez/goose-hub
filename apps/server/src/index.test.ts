import { describe, expect, it, vi } from 'vitest';
import { app } from './index.js';

vi.mock('./source.js', () => ({
  getSourceForSlug: vi.fn().mockResolvedValue({
    repoRef: 'owner/repo',
    listClosedWork: vi.fn().mockResolvedValue([
      {
        id: 'github:owner/repo#5',
        externalId: '5',
        repoRef: 'owner/repo',
        title: 'Done item',
        body: '',
        type: 'feature',
        priority: 'medium',
        mode: 'supervised',
        state: 'factory:done',
        authorIsOwner: true,
        milestoneId: '3',
        schedule: 'current',
        exec: 'parallel',
        dependsOn: [],
        blocks: [],
        createdAt: new Date('2024-01-01'),
      },
    ]),
  }),
}));

describe('GET /projects/:slug/milestones/:milestone/closed-issues', () => {
  it('returns closed work items for the milestone', async () => {
    const res = await app.request('/projects/goose-hub-self/milestones/3/closed-issues');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(1);
  });

  it('returns 400 for a non-numeric milestone', async () => {
    const res = await app.request('/projects/goose-hub-self/milestones/abc/closed-issues');
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown project', async () => {
    const { getSourceForSlug } = await import('./source.js');
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const res = await app.request('/projects/unknown/milestones/3/closed-issues');
    expect(res.status).toBe(404);
  });
});
