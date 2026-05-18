import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetSearchCache, cachedListClosedByMilestone, cachedListOpenWork } from './cache.js';

afterEach(() => {
  _resetSearchCache();
});

function fakeItem(externalId: string): WorkItem {
  return {
    id: `github:r#${externalId}`,
    externalId,
    repoRef: 'r',
    title: 't',
    body: '',
    type: 'feature',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:triaging',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'parallel',
    dependsOn: [],
    blocks: [],
    createdAt: new Date(),
  };
}

describe('search cache', () => {
  it('memoises listOpenWork per (slug, milestone) within TTL', async () => {
    const loader = vi.fn().mockResolvedValue([fakeItem('1')]);
    await cachedListOpenWork('a', 5, loader, 1_000);
    await cachedListOpenWork('a', 5, loader, 30_000);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('different milestones share the same slug but different cache slots', async () => {
    const loader = vi.fn().mockImplementation(() => Promise.resolve([fakeItem('x')]));
    await cachedListOpenWork('a', 5, loader, 1_000);
    await cachedListOpenWork('a', 6, loader, 1_000);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('different slugs do not share cache slots', async () => {
    const loader = vi.fn().mockResolvedValue([fakeItem('x')]);
    await cachedListOpenWork('a', 5, loader, 1_000);
    await cachedListOpenWork('b', 5, loader, 1_000);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('expires entries after TTL', async () => {
    const loader = vi.fn().mockResolvedValue([fakeItem('1')]);
    await cachedListOpenWork('a', 5, loader, 1_000);
    await cachedListOpenWork('a', 5, loader, 1_000 + 60_001);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('cachedListClosedByMilestone uses a separate key from cachedListOpenWork', async () => {
    const loader = vi.fn().mockResolvedValue([fakeItem('1')]);
    await cachedListOpenWork('a', 5, loader, 1_000);
    await cachedListClosedByMilestone('a', 5, loader, 1_000);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
