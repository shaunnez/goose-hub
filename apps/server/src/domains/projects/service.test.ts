import { describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/projects.js', () => ({
  listProjects: vi.fn(),
}));

import { listProjects } from '#shared/projects.js';
import { listProjectsService } from './service.js';

describe('listProjectsService (#208)', () => {
  it('returns { projects } shape from the underlying loader', async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([{ slug: 'a' }, { slug: 'b' }] as never);
    const result = await listProjectsService();
    expect(result).toEqual({ projects: [{ slug: 'a' }, { slug: 'b' }] });
  });

  it('returns empty list when no projects are registered', async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([] as never);
    const result = await listProjectsService();
    expect(result).toEqual({ projects: [] });
  });
});
