# Server API Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `apps/server/src/` from a 540-line monolithic `index.ts` into a domain-module architecture with clear layer separation, a shared middleware utility, and a `STANDARDS.md` guide file.

**Architecture:** Domain folders (`issues/`, `milestones/`, `inbox/`, `events/`, `projects/`, `webhooks/`, `workflows/`) each own their router, service, and optional repository. A `shared/` directory holds cross-cutting utilities. Dependency direction is always router → service → repository.

**Tech Stack:** Node + TypeScript + Hono + Drizzle ORM + Vitest. All TypeScript imports use `.js` extension (ESM).

---

## File Map

**New files:**
- `apps/server/src/server.ts` — Hono app factory, registers all domain routers, exported for tests
- `apps/server/src/shared/middleware.ts` — `parseBody<T>()`, `Result<T>` type
- `apps/server/src/domains/milestones/repository.ts` — absorbs `active-milestone.ts`
- `apps/server/src/domains/milestones/repository.test.ts` — absorbs `active-milestone.test.ts`
- `apps/server/src/domains/milestones/service.ts` — milestone business logic
- `apps/server/src/domains/milestones/service.test.ts`
- `apps/server/src/domains/milestones/router.ts`
- `apps/server/src/domains/inbox/repository.ts` — absorbs inline DB code from index.ts
- `apps/server/src/domains/inbox/repository.test.ts`
- `apps/server/src/domains/inbox/service.ts`
- `apps/server/src/domains/inbox/service.test.ts`
- `apps/server/src/domains/inbox/router.ts`
- `apps/server/src/domains/issues/service.ts`
- `apps/server/src/domains/issues/service.test.ts`
- `apps/server/src/domains/issues/router.ts`
- `apps/server/src/domains/events/router.ts`
- `apps/server/src/domains/projects/router.ts`
- `apps/server/src/domains/webhooks/handler.ts` — absorbs `webhooks/github.ts`
- `apps/server/src/domains/webhooks/handler.test.ts` — absorbs `webhooks/github.test.ts`
- `apps/server/src/domains/webhooks/router.ts`
- `apps/server/src/domains/workflows/triage-batch.ts` — absorbs `workflows/triage-batch.ts`
- `apps/server/src/domains/workflows/triage-batch.test.ts` — absorbs `workflows/triage-batch.test.ts`
- `apps/server/src/domains/workflows/router.ts`
- `apps/server/STANDARDS.md`

**Modified files:**
- `apps/server/src/shared/cache.ts` — add `CACHE_KEY` (moved from `index.ts`)
- `apps/server/src/shared/source.ts` — copy of `source.ts` with updated `projects.js` import path
- `apps/server/src/shared/projects.ts` — copy of `projects.ts` with updated `PROJECTS_DIR` path
- `apps/server/src/index.ts` — reduced to dotenv + serve() entry point only
- `apps/server/src/index.test.ts` — update import from `./index.js` → `./server.js`

**Deleted files (after migration):**
- `apps/server/src/active-milestone.ts`
- `apps/server/src/active-milestone.test.ts`
- `apps/server/src/source.ts`
- `apps/server/src/projects.ts`
- `apps/server/src/cache.ts`
- `apps/server/src/cache.test.ts`
- `apps/server/src/webhooks/github.ts`
- `apps/server/src/webhooks/github.test.ts`
- `apps/server/src/workflows/triage-batch.ts`
- `apps/server/src/workflows/triage-batch.test.ts`

---

### Task 1: Create directory structure + shared/middleware.ts

**Files:**
- Create: `apps/server/src/shared/` (directory)
- Create: `apps/server/src/domains/milestones/` (directory)
- Create: `apps/server/src/domains/inbox/` (directory)
- Create: `apps/server/src/domains/issues/` (directory)
- Create: `apps/server/src/domains/events/` (directory)
- Create: `apps/server/src/domains/projects/` (directory)
- Create: `apps/server/src/domains/webhooks/` (directory)
- Create: `apps/server/src/domains/workflows/` (directory)
- Create: `apps/server/src/shared/middleware.ts`

- [ ] **Step 1: Create directories**

```bash
cd apps/server/src
mkdir -p shared domains/milestones domains/inbox domains/issues domains/events domains/projects domains/webhooks domains/workflows
```

- [ ] **Step 2: Write `apps/server/src/shared/middleware.ts`**

```ts
import { logger } from '@goose-hub/core/logger.js';
import type { Context } from 'hono';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

export type ParsedBody<T> =
  | { ok: true; data: T }
  | { ok: false; error: Response };

export async function parseBody<T>(c: Context): Promise<ParsedBody<T>> {
  try {
    const data = (await c.req.json()) as T;
    return { ok: true, data };
  } catch (err) {
    logger.warn('request body parse failed', { err: String(err) });
    return { ok: false, error: c.json({ error: 'invalid request body' }, 400) };
  }
}
```

- [ ] **Step 3: Write `apps/server/src/shared/middleware.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { parseBody } from './middleware.js';

describe('parseBody', () => {
  it('returns ok:true with parsed data for valid JSON', async () => {
    const app = new Hono();
    let result: unknown;
    app.post('/test', async (c) => {
      result = await parseBody<{ name: string }>(c);
      return c.json({});
    });
    await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'hello' }),
    });
    expect(result).toEqual({ ok: true, data: { name: 'hello' } });
  });

  it('returns ok:false with 400 response for invalid JSON', async () => {
    const app = new Hono();
    let result: unknown;
    app.post('/test', async (c) => {
      result = await parseBody<{ name: string }>(c);
      return c.json({});
    });
    await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(result).toMatchObject({ ok: false });
  });
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm test -- --reporter=verbose 2>&1 | grep -E "(PASS|FAIL|✓|×|middleware)"
```

Expected: middleware tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/shared/
git commit -m "feat(server): add shared/middleware.ts with parseBody utility"
```

---

### Task 2: Move shared utilities (cache, source, projects) into shared/

**Files:**
- Create: `apps/server/src/shared/cache.ts` (copy of `cache.ts` + `CACHE_KEY`)
- Create: `apps/server/src/shared/projects.ts` (copy of `projects.ts`, updated path)
- Create: `apps/server/src/shared/source.ts` (copy of `source.ts`, updated import)
- Create: `apps/server/src/shared/cache.test.ts` (copy of `cache.test.ts`)

- [ ] **Step 1: Create `apps/server/src/shared/cache.ts`**

Copy the full content of `cache.ts` and add `CACHE_KEY` at the bottom:

```ts
const MAX_ENTRIES = 500;
const store = new Map<string, { data: unknown; expiresAt: number }>();

export async function getCached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const entry = store.get(key);
  if (entry != null && Date.now() < entry.expiresAt) {
    return entry.data as T;
  }
  const data = await fetcher();

  if (store.size >= MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of store) {
      if (now >= v.expiresAt) {
        store.delete(k);
      }
    }
    if (store.size >= MAX_ENTRIES) {
      const firstKey = store.keys().next().value;
      if (firstKey !== undefined) {
        store.delete(firstKey);
      }
    }
  }

  store.set(key, { data, expiresAt: Date.now() + ttlMs });
  return data;
}

export function bustCache(key: string): void {
  store.delete(key);
}

export function getCacheSize(): number {
  return store.size;
}

export const CACHE_KEY = {
  issues: (slug: string) => `issues:${slug}`,
  milestones: (slug: string) => `milestones:${slug}`,
  closedIssues: (slug: string, ms: number) => `closed-issues:${slug}:${ms}`,
  milestoneIssues: (slug: string, ms: number) => `milestone-issues:${slug}:${ms}`,
} as const;
```

- [ ] **Step 2: Create `apps/server/src/shared/cache.test.ts`**

Copy the full content of `apps/server/src/cache.test.ts` and update the import path:

```ts
// Change: import { ... } from '../cache.js';
// To:     import { ... } from './cache.js';
```

Check the existing `cache.test.ts` for the exact imports and update them.

- [ ] **Step 3: Create `apps/server/src/shared/projects.ts`**

Copy the full content of `projects.ts`. The only change is `PROJECTS_DIR` — the file moves one level deeper so the relative path gains one `..`:

```ts
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { logger } from '@goose-hub/core/logger.js';
import type { ProjectConfig } from '@goose-hub/core/types.js';

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  color: string;
  source: ProjectConfig['source'];
}

// File moves from src/ to src/shared/, so add one extra .. to reach the monorepo root.
const PROJECTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../target-projects',
);

const cache = new Map<string, ProjectConfig>();

async function loadProject(slug: string): Promise<ProjectConfig | null> {
  const cached = cache.get(slug);
  if (cached != null) return cached;

  const file = path.join(PROJECTS_DIR, slug, 'project.config.ts');
  try {
    statSync(file);
  } catch {
    return null;
  }

  const mod = (await import(pathToFileURL(file).href)) as { default: ProjectConfig };
  if (mod.default == null) {
    logger.warn('project config has no default export', { slug, file });
    return null;
  }
  cache.set(slug, mod.default);
  return mod.default;
}

const COLOR_BY_SLUG: Record<string, string> = {
  'goose-hub-self': '#7c3aed',
};

export async function listProjects(): Promise<ProjectSummary[]> {
  let entries: string[];
  try {
    entries = readdirSync(PROJECTS_DIR);
  } catch {
    return [];
  }

  const projects: ProjectSummary[] = [];
  for (const entry of entries) {
    const dir = path.join(PROJECTS_DIR, entry);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const cfg = await loadProject(entry);
    if (cfg == null) continue;
    projects.push({
      id: cfg.id,
      name: cfg.name,
      slug: cfg.slug,
      color: COLOR_BY_SLUG[cfg.slug] ?? '#888888',
      source: cfg.source,
    });
  }
  return projects;
}

export async function getProject(slug: string): Promise<ProjectConfig | null> {
  return loadProject(slug);
}
```

- [ ] **Step 4: Create `apps/server/src/shared/source.ts`**

Copy `source.ts`, update import to reference `./projects.js` (stays the same since both are in `shared/`):

```ts
import { GitHubLabelsSource } from '@goose-hub/core/state-source/github-labels.js';
import type { StateSource } from '@goose-hub/core/state-source/interface.js';
import { getProject } from './projects.js';

const sourceCache = new Map<string, StateSource>();

export async function getSourceForSlug(slug: string): Promise<StateSource | null> {
  const cached = sourceCache.get(slug);
  if (cached != null) return cached;

  const cfg = await getProject(slug);
  if (cfg == null) return null;
  if (cfg.source.kind !== 'github') {
    throw new Error(`Unsupported source kind for ${slug}: ${cfg.source.kind}`);
  }

  const token = process.env.GITHUB_TOKEN;
  if (token == null || token.length === 0) {
    throw new Error('GITHUB_TOKEN env var is required to talk to GitHub.');
  }

  const ownerLogin = cfg.source.repo.split('/')[0];
  const source = new GitHubLabelsSource(cfg.id, cfg.source.repo, token, ownerLogin);
  sourceCache.set(slug, source);
  return source;
}
```

- [ ] **Step 5: Run tests to confirm no regressions**

```bash
pnpm test 2>&1 | tail -20
```

Expected: all existing tests still pass (no tests import from shared/ yet — old files still exist).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/shared/
git commit -m "feat(server): add shared/ layer with cache (+ CACHE_KEY), projects, source"
```

---

### Task 3: milestones domain

**Files:**
- Create: `apps/server/src/domains/milestones/repository.ts`
- Create: `apps/server/src/domains/milestones/repository.test.ts`
- Create: `apps/server/src/domains/milestones/service.ts`
- Create: `apps/server/src/domains/milestones/service.test.ts`
- Create: `apps/server/src/domains/milestones/router.ts`

- [ ] **Step 1: Create `apps/server/src/domains/milestones/repository.ts`**

This is a direct move of `active-milestone.ts` — identical logic, new location:

```ts
import { db } from '@goose-hub/core/db/db.js';
import { projectState } from '@goose-hub/core/db/schema.js';
import { eq } from 'drizzle-orm';

export async function readActiveMilestone(projectId: string): Promise<number | null> {
  const rows = db.select().from(projectState).where(eq(projectState.projectId, projectId)).all();
  if (rows.length === 0) return null;
  return rows[0].activeMilestoneNumber;
}

export async function writeActiveMilestone(
  projectId: string,
  milestoneNumber: number | null,
  by: string,
): Promise<void> {
  const existing = db
    .select()
    .from(projectState)
    .where(eq(projectState.projectId, projectId))
    .all();
  const now = new Date().toISOString();
  if (existing.length === 0) {
    db.insert(projectState)
      .values({
        projectId,
        activeMilestoneNumber: milestoneNumber,
        activeMilestoneSetAt: now,
        activeMilestoneSetBy: by,
      })
      .run();
  } else {
    db.update(projectState)
      .set({
        activeMilestoneNumber: milestoneNumber,
        activeMilestoneSetAt: now,
        activeMilestoneSetBy: by,
      })
      .where(eq(projectState.projectId, projectId))
      .run();
  }
}
```

- [ ] **Step 2: Create `apps/server/src/domains/milestones/repository.test.ts`**

Copy the full content of `active-milestone.test.ts`, updating the import on the last line:

```ts
// Change:
const { readActiveMilestone, writeActiveMilestone } = await import('./active-milestone.js');
// To:
const { readActiveMilestone, writeActiveMilestone } = await import('./repository.js');
```

The mock setup and all test bodies remain identical.

- [ ] **Step 3: Run repository tests**

```bash
pnpm test -- domains/milestones/repository --reporter=verbose 2>&1
```

Expected: 4 tests pass (readActiveMilestone ×2, writeActiveMilestone ×2).

- [ ] **Step 4: Create `apps/server/src/domains/milestones/service.ts`**

```ts
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import type { Result } from '../../shared/middleware.js';
import { bustCache, getCached, CACHE_KEY } from '../../shared/cache.js';
import { getSourceForSlug } from '../../shared/source.js';
import { readActiveMilestone, writeActiveMilestone } from './repository.js';

export async function getActiveMilestone(
  slug: string,
): Promise<Result<{ milestoneNumber: number | null; source: string }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const persisted = await readActiveMilestone(slug);
  if (persisted != null) {
    return { ok: true, data: { milestoneNumber: persisted, source: 'project_state' } };
  }
  const fallback = await source.getActiveMilestone();
  return {
    ok: true,
    data: { milestoneNumber: fallback?.number ?? null, source: 'github-default' },
  };
}

export async function setActiveMilestone(
  slug: string,
  milestoneNumber: number | null,
): Promise<Result<{ ok: true; milestoneNumber: number | null }>> {
  await writeActiveMilestone(slug, milestoneNumber, 'ui');
  bustCache(CACHE_KEY.milestones(slug));
  eventStore.appendEvent({
    projectId: slug,
    kind: 'milestone.activated',
    payload: { milestoneNumber },
  });
  return { ok: true, data: { ok: true, milestoneNumber } };
}

export async function listMilestones(
  slug: string,
): Promise<Result<{ milestones: unknown[] }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const milestones = await getCached(CACHE_KEY.milestones(slug), 60_000, () =>
    source.listMilestones(),
  );
  return { ok: true, data: { milestones } };
}

export async function listMilestoneIssues(
  slug: string,
  milestone: number,
): Promise<Result<{ items: unknown[] }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const items = await getCached(CACHE_KEY.milestoneIssues(slug, milestone), 60_000, () =>
    source.listWorkByMilestone(milestone),
  );
  return { ok: true, data: { items } };
}

export async function listClosedMilestoneIssues(
  slug: string,
  milestone: number,
): Promise<Result<{ items: unknown[] }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const items = await getCached(CACHE_KEY.closedIssues(slug, milestone), 60_000, () =>
    source.listClosedWorkByMilestone(milestone),
  );
  return { ok: true, data: { items } };
}
```

- [ ] **Step 5: Create `apps/server/src/domains/milestones/service.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: { appendEvent: vi.fn() },
}));

vi.mock('../../shared/source.js', () => ({
  getSourceForSlug: vi.fn(),
}));

vi.mock('../../shared/cache.js', () => ({
  getCached: vi.fn().mockImplementation((_key, _ttl, fetcher) => fetcher()),
  bustCache: vi.fn(),
  CACHE_KEY: {
    issues: (s: string) => `issues:${s}`,
    milestones: (s: string) => `milestones:${s}`,
    closedIssues: (s: string, m: number) => `closed-issues:${s}:${m}`,
    milestoneIssues: (s: string, m: number) => `milestone-issues:${s}:${m}`,
  },
}));

vi.mock('./repository.js', () => ({
  readActiveMilestone: vi.fn().mockResolvedValue(null),
  writeActiveMilestone: vi.fn().mockResolvedValue(undefined),
}));

import { getSourceForSlug } from '../../shared/source.js';
import { readActiveMilestone, writeActiveMilestone } from './repository.js';
import { bustCache } from '../../shared/cache.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import {
  getActiveMilestone,
  setActiveMilestone,
  listMilestones,
  listMilestoneIssues,
  listClosedMilestoneIssues,
} from './service.js';

const mockSource = {
  getActiveMilestone: vi.fn(),
  listMilestones: vi.fn().mockResolvedValue([]),
  listWorkByMilestone: vi.fn().mockResolvedValue([]),
  listClosedWorkByMilestone: vi.fn().mockResolvedValue([]),
};

beforeEach(() => {
  vi.mocked(getSourceForSlug).mockResolvedValue(mockSource as never);
  vi.mocked(readActiveMilestone).mockResolvedValue(null);
  vi.clearAllMocks();
  vi.mocked(getSourceForSlug).mockResolvedValue(mockSource as never);
});

describe('getActiveMilestone', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await getActiveMilestone('unknown');
    expect(result).toEqual({ ok: false, error: 'project not found', status: 404 });
  });

  it('returns persisted milestone when one exists', async () => {
    vi.mocked(readActiveMilestone).mockResolvedValueOnce(5);
    const result = await getActiveMilestone('my-proj');
    expect(result).toEqual({ ok: true, data: { milestoneNumber: 5, source: 'project_state' } });
  });

  it('falls back to github-default when no persisted milestone', async () => {
    vi.mocked(readActiveMilestone).mockResolvedValueOnce(null);
    mockSource.getActiveMilestone.mockResolvedValueOnce({ number: 3 });
    const result = await getActiveMilestone('my-proj');
    expect(result).toEqual({
      ok: true,
      data: { milestoneNumber: 3, source: 'github-default' },
    });
  });

  it('returns null milestoneNumber when github has no active milestone', async () => {
    vi.mocked(readActiveMilestone).mockResolvedValueOnce(null);
    mockSource.getActiveMilestone.mockResolvedValueOnce(null);
    const result = await getActiveMilestone('my-proj');
    expect(result).toEqual({
      ok: true,
      data: { milestoneNumber: null, source: 'github-default' },
    });
  });
});

describe('setActiveMilestone', () => {
  it('writes milestone, busts cache, and emits event', async () => {
    const result = await setActiveMilestone('my-proj', 7);
    expect(result).toEqual({ ok: true, data: { ok: true, milestoneNumber: 7 } });
    expect(writeActiveMilestone).toHaveBeenCalledWith('my-proj', 7, 'ui');
    expect(bustCache).toHaveBeenCalled();
    expect(eventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'milestone.activated', payload: { milestoneNumber: 7 } }),
    );
  });
});

describe('listMilestones', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await listMilestones('unknown');
    expect(result).toEqual({ ok: false, error: 'project not found', status: 404 });
  });

  it('returns milestones list', async () => {
    mockSource.listMilestones.mockResolvedValueOnce([{ number: 1 }, { number: 2 }]);
    const result = await listMilestones('my-proj');
    expect(result).toEqual({ ok: true, data: { milestones: [{ number: 1 }, { number: 2 }] } });
  });
});

describe('listMilestoneIssues', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await listMilestoneIssues('unknown', 3);
    expect(result.ok).toBe(false);
  });

  it('returns items for known project and milestone', async () => {
    mockSource.listWorkByMilestone.mockResolvedValueOnce([{ id: 'github:owner/repo#1' }]);
    const result = await listMilestoneIssues('my-proj', 3);
    expect(result).toMatchObject({ ok: true, data: { items: [{ id: 'github:owner/repo#1' }] } });
  });
});

describe('listClosedMilestoneIssues', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await listClosedMilestoneIssues('unknown', 3);
    expect(result.ok).toBe(false);
  });

  it('returns closed items', async () => {
    mockSource.listClosedWorkByMilestone.mockResolvedValueOnce([{ id: 'github:owner/repo#5' }]);
    const result = await listClosedMilestoneIssues('my-proj', 3);
    expect(result).toMatchObject({
      ok: true,
      data: { items: [{ id: 'github:owner/repo#5' }] },
    });
  });
});
```

- [ ] **Step 6: Run service tests**

```bash
pnpm test -- domains/milestones/service --reporter=verbose 2>&1
```

Expected: all service tests pass.

- [ ] **Step 7: Create `apps/server/src/domains/milestones/router.ts`**

```ts
import { Hono } from 'hono';
import { parseBody } from '../../shared/middleware.js';
import {
  getActiveMilestone,
  setActiveMilestone,
  listMilestones,
  listMilestoneIssues,
  listClosedMilestoneIssues,
} from './service.js';

const router = new Hono();

router.get('/:slug/milestones', async (c) => {
  const result = await listMilestones(c.req.param('slug'));
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.get('/:slug/milestones/:milestone/issues', async (c) => {
  const milestone = Number(c.req.param('milestone'));
  if (Number.isNaN(milestone)) return c.json({ error: 'invalid milestone number' }, 400);
  const result = await listMilestoneIssues(c.req.param('slug'), milestone);
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.get('/:slug/milestones/:milestone/closed-issues', async (c) => {
  const milestone = Number(c.req.param('milestone'));
  if (Number.isNaN(milestone)) return c.json({ error: 'invalid milestone number' }, 400);
  const result = await listClosedMilestoneIssues(c.req.param('slug'), milestone);
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.get('/:slug/active-milestone', async (c) => {
  const result = await getActiveMilestone(c.req.param('slug'));
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.post('/:slug/active-milestone', async (c) => {
  const body = await parseBody<{ milestoneNumber?: number | null }>(c);
  if (!body.ok) return body.error;
  const result = await setActiveMilestone(c.req.param('slug'), body.data.milestoneNumber ?? null);
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

export { router as milestonesRouter };
```

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/domains/milestones/
git commit -m "feat(server): milestones domain — repository, service, router"
```

---

### Task 4: inbox domain

**Files:**
- Create: `apps/server/src/domains/inbox/repository.ts`
- Create: `apps/server/src/domains/inbox/repository.test.ts`
- Create: `apps/server/src/domains/inbox/service.ts`
- Create: `apps/server/src/domains/inbox/service.test.ts`
- Create: `apps/server/src/domains/inbox/router.ts`

- [ ] **Step 1: Create `apps/server/src/domains/inbox/repository.ts`**

```ts
import { db } from '@goose-hub/core/db/db.js';
import { inboxItems } from '@goose-hub/core/db/schema.js';
import { desc, eq } from 'drizzle-orm';

export interface InboxItem {
  id: number;
  title: string;
  body: string | null;
  type: string;
  createdAt: string;
}

export interface NewInboxItem {
  title: string;
  body: string;
  type: string;
}

export async function listInboxItems(): Promise<InboxItem[]> {
  return db.select().from(inboxItems).orderBy(desc(inboxItems.createdAt));
}

export async function insertInboxItem(item: NewInboxItem): Promise<InboxItem> {
  const [row] = await db.insert(inboxItems).values(item).returning();
  return row;
}

export async function getInboxItem(id: number): Promise<InboxItem | null> {
  const [row] = await db.select().from(inboxItems).where(eq(inboxItems.id, id));
  return row ?? null;
}

export async function deleteInboxItem(id: number): Promise<void> {
  await db.delete(inboxItems).where(eq(inboxItems.id, id));
}
```

- [ ] **Step 2: Create `apps/server/src/domains/inbox/repository.test.ts`**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockInboxRow = {
  id: 1,
  title: 'Test idea',
  body: '',
  type: 'feature',
  createdAt: '2026-05-01 00:00:00',
};

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockDelete = vi.fn();

vi.mock('@goose-hub/core/db/db.js', () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    delete: mockDelete,
  },
}));

vi.mock('@goose-hub/core/db/schema.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@goose-hub/core/db/schema.js')>();
  return { ...actual };
});

import { listInboxItems, insertInboxItem, getInboxItem, deleteInboxItem } from './repository.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listInboxItems', () => {
  it('returns rows ordered by createdAt desc', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([mockInboxRow]),
      }),
    });
    const items = await listInboxItems();
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Test idea');
  });
});

describe('insertInboxItem', () => {
  it('inserts and returns the new row', async () => {
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockInboxRow]),
      }),
    });
    const item = await insertInboxItem({ title: 'Test idea', body: '', type: 'feature' });
    expect(item.id).toBe(1);
    expect(item.title).toBe('Test idea');
  });
});

describe('getInboxItem', () => {
  it('returns the item when found', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockInboxRow]),
      }),
    });
    const item = await getInboxItem(1);
    expect(item).not.toBeNull();
    expect(item?.id).toBe(1);
  });

  it('returns null when not found', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });
    const item = await getInboxItem(999);
    expect(item).toBeNull();
  });
});

describe('deleteInboxItem', () => {
  it('calls delete without throwing', async () => {
    mockDelete.mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    await expect(deleteInboxItem(1)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run repository tests**

```bash
pnpm test -- domains/inbox/repository --reporter=verbose 2>&1
```

Expected: 5 tests pass.

- [ ] **Step 4: Create `apps/server/src/domains/inbox/service.ts`**

```ts
import { logger } from '@goose-hub/core/logger.js';
import type { Result } from '../../shared/middleware.js';
import { getSourceForSlug } from '../../shared/source.js';
import {
  deleteInboxItem,
  getInboxItem,
  insertInboxItem,
  listInboxItems,
  type InboxItem,
} from './repository.js';

const VALID_TYPES = ['feature', 'bug', 'chore', 'research'] as const;

export async function createInboxItem(
  title: string | undefined,
  body: string | undefined,
  type: string | undefined,
): Promise<Result<{ item: InboxItem }>> {
  if (!title?.trim()) return { ok: false, error: 'title is required', status: 400 };
  const safeType = VALID_TYPES.includes(type as never) ? (type as string) : 'feature';
  const item = await insertInboxItem({ title: title.trim(), body: body ?? '', type: safeType });
  return { ok: true, data: { item } };
}

export async function getInboxItems(): Promise<Result<{ items: InboxItem[] }>> {
  const items = await listInboxItems();
  return { ok: true, data: { items } };
}

export async function promoteInboxItem(
  id: number,
  projectSlug: string,
): Promise<Result<{ ok: true }>> {
  if (Number.isNaN(id)) return { ok: false, error: 'invalid id', status: 400 };

  const item = await getInboxItem(id);
  if (item == null) return { ok: false, error: 'not found', status: 404 };

  const source = await getSourceForSlug(projectSlug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };

  await source.createIssue({
    title: item.title,
    body: item.body ?? '',
    type: item.type as 'feature' | 'bug' | 'chore' | 'research',
  });

  try {
    await deleteInboxItem(id);
  } catch (err) {
    logger.error('inbox promotion: GitHub issue created but inbox delete failed', {
      id,
      err: String(err),
    });
  }

  return { ok: true, data: { ok: true } };
}
```

- [ ] **Step 5: Create `apps/server/src/domains/inbox/service.test.ts`**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../shared/source.js', () => ({
  getSourceForSlug: vi.fn(),
}));

vi.mock('./repository.js', () => ({
  insertInboxItem: vi.fn(),
  listInboxItems: vi.fn().mockResolvedValue([]),
  getInboxItem: vi.fn(),
  deleteInboxItem: vi.fn().mockResolvedValue(undefined),
}));

import { getSourceForSlug } from '../../shared/source.js';
import { insertInboxItem, listInboxItems, getInboxItem, deleteInboxItem } from './repository.js';
import { createInboxItem, getInboxItems, promoteInboxItem } from './service.js';

const mockItem = { id: 1, title: 'Fix bug', body: '', type: 'bug', createdAt: '2026-05-01' };
const mockSource = { createIssue: vi.fn().mockResolvedValue(undefined) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSourceForSlug).mockResolvedValue(mockSource as never);
});

describe('createInboxItem', () => {
  it('returns 400 when title is missing', async () => {
    const result = await createInboxItem(undefined, undefined, undefined);
    expect(result).toEqual({ ok: false, error: 'title is required', status: 400 });
  });

  it('returns 400 when title is whitespace-only', async () => {
    const result = await createInboxItem('   ', undefined, undefined);
    expect(result).toEqual({ ok: false, error: 'title is required', status: 400 });
  });

  it('defaults type to feature for unknown type', async () => {
    vi.mocked(insertInboxItem).mockResolvedValueOnce(mockItem);
    await createInboxItem('Some title', '', 'invalid-type');
    expect(insertInboxItem).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'feature' }),
    );
  });

  it('uses provided valid type', async () => {
    vi.mocked(insertInboxItem).mockResolvedValueOnce(mockItem);
    await createInboxItem('Fix this', '', 'bug');
    expect(insertInboxItem).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bug' }),
    );
  });

  it('trims title before insert', async () => {
    vi.mocked(insertInboxItem).mockResolvedValueOnce(mockItem);
    await createInboxItem('  My Title  ', '', 'feature');
    expect(insertInboxItem).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'My Title' }),
    );
  });
});

describe('getInboxItems', () => {
  it('returns all items', async () => {
    vi.mocked(listInboxItems).mockResolvedValueOnce([mockItem]);
    const result = await getInboxItems();
    expect(result).toEqual({ ok: true, data: { items: [mockItem] } });
  });
});

describe('promoteInboxItem', () => {
  it('returns 404 when item not found', async () => {
    vi.mocked(getInboxItem).mockResolvedValueOnce(null);
    const result = await promoteInboxItem(999, 'my-proj');
    expect(result).toEqual({ ok: false, error: 'not found', status: 404 });
  });

  it('returns 404 when project not found', async () => {
    vi.mocked(getInboxItem).mockResolvedValueOnce(mockItem);
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await promoteInboxItem(1, 'unknown');
    expect(result).toEqual({ ok: false, error: 'project not found', status: 404 });
  });

  it('creates github issue and deletes inbox item on success', async () => {
    vi.mocked(getInboxItem).mockResolvedValueOnce(mockItem);
    const result = await promoteInboxItem(1, 'my-proj');
    expect(result).toEqual({ ok: true, data: { ok: true } });
    expect(mockSource.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Fix bug' }),
    );
    expect(deleteInboxItem).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 6: Run service tests**

```bash
pnpm test -- domains/inbox/service --reporter=verbose 2>&1
```

Expected: all service tests pass.

- [ ] **Step 7: Create `apps/server/src/domains/inbox/router.ts`**

```ts
import { Hono } from 'hono';
import { parseBody } from '../../shared/middleware.js';
import { createInboxItem, getInboxItems, promoteInboxItem } from './service.js';

const router = new Hono();

router.post('/', async (c) => {
  const body = await parseBody<{ title?: string; body?: string; type?: string }>(c);
  if (!body.ok) return body.error;
  const result = await createInboxItem(body.data.title, body.data.body, body.data.type);
  return result.ok
    ? c.json(result.data, 201)
    : c.json({ error: result.error }, result.status as 400);
});

router.get('/', async (c) => {
  const result = await getInboxItems();
  return c.json(result.data);
});

router.post('/:id/promote', async (c) => {
  const id = Number(c.req.param('id'));
  if (Number.isNaN(id)) return c.json({ error: 'invalid id' }, 400);
  const body = await parseBody<{ projectSlug?: string }>(c);
  if (!body.ok) return body.error;
  const slug = body.data.projectSlug ?? 'goose-hub-self';
  const result = await promoteInboxItem(id, slug);
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 404);
});

export { router as inboxRouter };
```

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/domains/inbox/
git commit -m "feat(server): inbox domain — repository, service, router"
```

---

### Task 5: issues domain

**Files:**
- Create: `apps/server/src/domains/issues/service.ts`
- Create: `apps/server/src/domains/issues/service.test.ts`
- Create: `apps/server/src/domains/issues/router.ts`

- [ ] **Step 1: Create `apps/server/src/domains/issues/service.ts`**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { STATES } from '@goose-hub/core/state-machine/states.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import { isLegalTransition, legalTargets } from '@goose-hub/core/state-machine/transitions.js';
import type { Result } from '../../shared/middleware.js';
import { bustCache, getCached, CACHE_KEY } from '../../shared/cache.js';
import { getProject, type ProjectSummary } from '../../shared/projects.js';
import { getSourceForSlug } from '../../shared/source.js';

// Two levels up from domains/issues/ to apps/server/, then six levels to repo root from there.
const REPO_ROOT = join(fileURLToPath(import.meta.url), '../../../../../..');

const OUTPUT_FIXTURES: Record<string, unknown> = {
  triage: { priority: 'high', type: 'feature', decision: 'accept' },
  investigate: {
    findings: 'Root cause identified',
    confidence: 'high',
    recommendation: 'fix in core',
  },
};

async function getRepoRef(slug: string): Promise<string> {
  const cfg = await getProject(slug);
  return cfg?.source.kind === 'github' ? cfg.source.repo : slug;
}

export async function listIssues(slug: string): Promise<Result<{ items: unknown[] }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const items = await getCached(CACHE_KEY.issues(slug), 60_000, () => source.listOpenWork());
  return { ok: true, data: { items } };
}

export async function getIssue(slug: string, id: string): Promise<Result<{ item: unknown }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const item = await source.getItem(id);
  return { ok: true, data: { item } };
}

export async function getIssueEvents(
  slug: string,
  id: string,
): Promise<Result<{ events: unknown[] }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;
  const ascending = eventStore.replay({ projectId: slug, workItemId });
  const events = [...ascending].reverse();
  return { ok: true, data: { events } };
}

export async function getIssueComments(
  slug: string,
  id: string,
): Promise<Result<{ comments: unknown[] }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;
  const comments = await source.listComments(workItemId);
  return { ok: true, data: { comments } };
}

export async function getIssueTriage(
  slug: string,
  id: string,
): Promise<Result<{ triage: unknown }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const workItemId = `github:${source.repoRef}#${id}`;
  const projectId = source.projectId;

  const allEvents = eventStore.replay({ projectId, workItemId });
  const triageEvent = allEvents.filter((e) => e.kind === 'agent.triage-complete').at(-1);
  if (triageEvent == null) return { ok: true, data: { triage: null } };

  const payload = triageEvent.payload as {
    triage: { type: string; priority: string };
    repoMatch: { candidates: Array<{ repo: string; confidence: number; evidence: string; tier: number }> };
  };

  const overrideEvent = allEvents.filter((e) => e.kind === 'agent.repo-override').at(-1);
  const overridePayload = overrideEvent?.payload as { repo?: string } | undefined;

  return {
    ok: true,
    data: {
      triage: {
        type: payload.triage.type,
        priority: payload.triage.priority,
        candidates: payload.repoMatch.candidates ?? [],
        overrideRepo: overridePayload?.repo ?? null,
      },
    },
  };
}

export async function transitionIssue(
  slug: string,
  id: string,
  from: unknown,
  to: unknown,
): Promise<
  Result<{ ok: true; from: StateName; to: StateName }> & {
    legalTargets?: StateName[];
  }
> {
  if (from == null || to == null) {
    return { ok: false, error: "missing 'from' or 'to'", status: 400 };
  }
  if (!(STATES as readonly string[]).includes(from as string)) {
    return { ok: false, error: `invalid state name for 'from': ${from}`, status: 400 };
  }
  if (!(STATES as readonly string[]).includes(to as string)) {
    return { ok: false, error: `invalid state name for 'to': ${to}`, status: 400 };
  }

  const fromState = from as StateName;
  const toState = to as StateName;

  if (!isLegalTransition(fromState, toState)) {
    return {
      ok: false,
      error: 'illegal transition',
      status: 422,
      legalTargets: legalTargets(fromState),
    };
  }

  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };

  const workItemId = `github:${source.repoRef}#${id}`;
  await source.transitionState(workItemId, fromState, toState);

  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'state.transitioned',
    payload: { from: fromState, to: toState, by: 'ui' },
  });

  bustCache(CACHE_KEY.issues(slug));
  return { ok: true, data: { ok: true, from: fromState, to: toState } };
}

export async function commentOnIssue(
  slug: string,
  id: string,
  body: string | undefined,
): Promise<Result<{ ok: true }>> {
  if (!body?.trim()) return { ok: false, error: 'body is required', status: 400 };
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;
  await source.comment(workItemId, body.trim());
  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'manual.action',
    payload: { action: 'comment', preview: body.trim().slice(0, 80) },
  });
  return { ok: true, data: { ok: true } };
}

export async function setIssueMilestone(
  slug: string,
  id: string,
  milestoneNumber: number | null,
): Promise<Result<{ ok: true }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;
  await source.setMilestone(workItemId, milestoneNumber);
  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'manual.action',
    payload: { action: 'set-milestone', milestoneNumber },
  });
  bustCache(CACHE_KEY.issues(slug));
  return { ok: true, data: { ok: true } };
}

const VALID_PRIORITY = ['low', 'medium', 'high', 'critical'] as const;
const VALID_SCHEDULE = ['current', 'backlog', 'icebox'] as const;

export async function setIssueLabel(
  slug: string,
  id: string,
  group: unknown,
  value: unknown,
): Promise<Result<{ ok: true }>> {
  if (group !== 'priority' && group !== 'schedule') {
    return { ok: false, error: 'group must be priority or schedule', status: 400 };
  }
  if (group === 'priority' && !VALID_PRIORITY.includes(value as never)) {
    return { ok: false, error: 'invalid priority', status: 400 };
  }
  if (group === 'schedule' && !VALID_SCHEDULE.includes(value as never)) {
    return { ok: false, error: 'invalid schedule', status: 400 };
  }
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;
  await source.setLabelInGroup(workItemId, group as string, value as string);
  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'manual.action',
    payload: { action: `set-${group}`, value },
  });
  bustCache(CACHE_KEY.issues(slug));
  return { ok: true, data: { ok: true } };
}

export async function overrideIssueRepo(
  slug: string,
  id: string,
  repo: unknown,
): Promise<Result<{ triage: unknown }>> {
  if (typeof repo !== 'string') return { ok: false, error: 'repo is required', status: 400 };

  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };

  const reposMdPath = join(REPO_ROOT, 'target-projects', slug, 'repos.md');
  const reposMd = readFileSync(reposMdPath, 'utf8');
  const allowedRepos =
    reposMd
      .match(/^###\s+\[([^\]]+)\]/gm)
      ?.map((m) => m.replace(/^###\s+\[/, '').replace(/\]$/, '')) ?? [];

  if (!allowedRepos.includes(repo)) {
    return { ok: false, error: `repo '${repo}' not in allowlist`, status: 400 };
  }

  const workItemId = `github:${source.repoRef}#${id}`;
  const projectId = source.projectId;

  eventStore.appendEvent({ projectId, workItemId, kind: 'agent.repo-override', payload: { repo } });

  const allEvents = eventStore.replay({ projectId, workItemId });
  const triageEvent = allEvents.filter((e) => e.kind === 'agent.triage-complete').at(-1);
  if (triageEvent == null) return { ok: true, data: { triage: null } };

  const payload = triageEvent.payload as {
    triage: { type: string; priority: string };
    repoMatch: { candidates: Array<{ repo: string; confidence: number; evidence: string; tier: number }> };
  };

  return {
    ok: true,
    data: {
      triage: {
        type: payload.triage.type,
        priority: payload.triage.priority,
        candidates: payload.repoMatch.candidates ?? [],
        overrideRepo: repo,
      },
    },
  };
}

export function fakeRun(slug: string, id: string, skill: string): { ok: true; skill: string } {
  const safeSkill = skill === 'investigate' ? 'investigate' : 'triage';

  const LOG_LINES = [
    'Fetching issue metadata from GitHub...',
    'Parsing labels and body content...',
    'Scoring priority and work type...',
    'Drafting decision summary...',
    'Finalising structured output...',
  ];

  (async () => {
    const workItemId = `github:unknown#${id}`;
    eventStore.appendEvent({ projectId: slug, workItemId, kind: 'agent.spawned', payload: { skill: safeSkill } });
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
    eventStore.appendEvent({
      projectId: slug,
      workItemId,
      kind: 'agent.terminated',
      payload: { skill: safeSkill, status: 'completed', output: OUTPUT_FIXTURES[safeSkill] },
    });
  })();

  return { ok: true, skill: safeSkill };
}
```

**Important note on `fakeRun`:** The current `index.ts` uses `getProject` to get `repoRef` for `workItemId` in the fake-run async IIFE, but the existing tests mock `getSourceForSlug` to return `{ repoRef: 'owner/repo' }` and check event kinds (not exact workItemId). The simplification here (using `github:unknown#${id}` for the fire-and-forget) is safe — the existing tests don't assert on `workItemId`. But to be safe, let's preserve the original logic: read source to get repoRef.

Replace the `fakeRun` implementation with the version that reads source (keeping it async to match original):

```ts
export async function fakeRun(
  slug: string,
  id: string,
  skill: string,
): Promise<Result<{ ok: true; skill: string }>> {
  const safeSkill = skill === 'investigate' ? 'investigate' : 'triage';

  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };

  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;

  const LOG_LINES = [
    'Fetching issue metadata from GitHub...',
    'Parsing labels and body content...',
    'Scoring priority and work type...',
    'Drafting decision summary...',
    'Finalising structured output...',
  ];

  (async () => {
    eventStore.appendEvent({ projectId: slug, workItemId, kind: 'agent.spawned', payload: { skill: safeSkill } });
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
    eventStore.appendEvent({
      projectId: slug,
      workItemId,
      kind: 'agent.terminated',
      payload: { skill: safeSkill, status: 'completed', output: OUTPUT_FIXTURES[safeSkill] },
    });
  })();

  return { ok: true, data: { ok: true, skill: safeSkill } };
}
```

Use the async `fakeRun` version (second one) in both `service.ts` and `router.ts`.

- [ ] **Step 2: Create `apps/server/src/domains/issues/service.test.ts`**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: { appendEvent: vi.fn(), replay: vi.fn().mockReturnValue([]) },
}));
vi.mock('@goose-hub/core/state-machine/states.js', () => ({
  STATES: ['factory:triaging', 'factory:accepted', 'factory:in-progress', 'factory:done'],
}));
vi.mock('@goose-hub/core/state-machine/transitions.js', () => ({
  isLegalTransition: vi.fn().mockReturnValue(true),
  legalTargets: vi.fn().mockReturnValue([]),
}));
vi.mock('../../shared/source.js', () => ({
  getSourceForSlug: vi.fn(),
}));
vi.mock('../../shared/projects.js', () => ({
  getProject: vi.fn().mockResolvedValue({ source: { kind: 'github', repo: 'owner/repo' } }),
}));
vi.mock('../../shared/cache.js', () => ({
  getCached: vi.fn().mockImplementation((_k, _t, f) => f()),
  bustCache: vi.fn(),
  CACHE_KEY: {
    issues: (s: string) => `issues:${s}`,
    milestones: (s: string) => `milestones:${s}`,
    closedIssues: (s: string, m: number) => `closed-issues:${s}:${m}`,
    milestoneIssues: (s: string, m: number) => `milestone-issues:${s}:${m}`,
  },
}));

import { getSourceForSlug } from '../../shared/source.js';
import { isLegalTransition } from '@goose-hub/core/state-machine/transitions.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import {
  transitionIssue,
  commentOnIssue,
  setIssueLabel,
  listIssues,
  getIssue,
} from './service.js';

const mockSource = {
  repoRef: 'owner/repo',
  projectId: 'test-proj',
  transitionState: vi.fn().mockResolvedValue(undefined),
  comment: vi.fn().mockResolvedValue(undefined),
  setMilestone: vi.fn().mockResolvedValue(undefined),
  setLabelInGroup: vi.fn().mockResolvedValue(undefined),
  listOpenWork: vi.fn().mockResolvedValue([]),
  getItem: vi.fn().mockResolvedValue({ id: 'github:owner/repo#1' }),
  listComments: vi.fn().mockResolvedValue([]),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSourceForSlug).mockResolvedValue(mockSource as never);
});

describe('transitionIssue — validation', () => {
  it('returns 400 when from is missing', async () => {
    const result = await transitionIssue('proj', '1', null, 'factory:triaging');
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('returns 400 when from is not a valid state', async () => {
    const result = await transitionIssue('proj', '1', 'not-a-state', 'factory:triaging');
    expect(result).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/invalid.*from/i) });
  });

  it('returns 400 when to is not a valid state', async () => {
    const result = await transitionIssue('proj', '1', 'factory:triaging', 'not-a-state');
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('returns 422 when transition is illegal', async () => {
    vi.mocked(isLegalTransition).mockReturnValueOnce(false);
    const result = await transitionIssue('proj', '1', 'factory:triaging', 'factory:done');
    expect(result).toMatchObject({ ok: false, status: 422 });
  });

  it('returns 404 when project not found', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await transitionIssue('unknown', '1', 'factory:triaging', 'factory:accepted');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('emits state.transitioned event on success', async () => {
    const result = await transitionIssue('proj', '1', 'factory:triaging', 'factory:accepted');
    expect(result.ok).toBe(true);
    expect(eventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'state.transitioned' }),
    );
  });
});

describe('commentOnIssue — validation', () => {
  it('returns 400 when body is empty', async () => {
    const result = await commentOnIssue('proj', '1', '');
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('returns 400 when body is whitespace-only', async () => {
    const result = await commentOnIssue('proj', '1', '   ');
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('returns 404 when project not found', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await commentOnIssue('unknown', '1', 'hello');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('posts comment and emits event on success', async () => {
    const result = await commentOnIssue('proj', '1', 'Great idea');
    expect(result.ok).toBe(true);
    expect(mockSource.comment).toHaveBeenCalledWith('github:owner/repo#1', 'Great idea');
    expect(eventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'manual.action' }),
    );
  });
});

describe('setIssueLabel — validation', () => {
  it('returns 400 for unknown group', async () => {
    const result = await setIssueLabel('proj', '1', 'type', 'bug');
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('returns 400 for invalid priority value', async () => {
    const result = await setIssueLabel('proj', '1', 'priority', 'urgent');
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('returns 400 for invalid schedule value', async () => {
    const result = await setIssueLabel('proj', '1', 'schedule', 'next');
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('returns 404 when project not found', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await setIssueLabel('unknown', '1', 'priority', 'high');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('returns ok for valid priority:high', async () => {
    const result = await setIssueLabel('proj', '1', 'priority', 'high');
    expect(result.ok).toBe(true);
  });

  it('returns ok for valid schedule:current', async () => {
    const result = await setIssueLabel('proj', '1', 'schedule', 'current');
    expect(result.ok).toBe(true);
  });
});

describe('listIssues', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await listIssues('unknown');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('returns items from source', async () => {
    mockSource.listOpenWork.mockResolvedValueOnce([{ id: 'github:owner/repo#1' }]);
    const result = await listIssues('proj');
    expect(result).toMatchObject({ ok: true, data: { items: [{ id: 'github:owner/repo#1' }] } });
  });
});

describe('getIssue', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await getIssue('unknown', '1');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });
});
```

- [ ] **Step 3: Run service tests**

```bash
pnpm test -- domains/issues/service --reporter=verbose 2>&1
```

Expected: all service tests pass.

- [ ] **Step 4: Create `apps/server/src/domains/issues/router.ts`**

```ts
import { Hono } from 'hono';
import { parseBody } from '../../shared/middleware.js';
import {
  listIssues,
  getIssue,
  getIssueEvents,
  getIssueComments,
  getIssueTriage,
  transitionIssue,
  commentOnIssue,
  setIssueMilestone,
  setIssueLabel,
  overrideIssueRepo,
  fakeRun,
} from './service.js';

const router = new Hono();

router.get('/:slug/issues', async (c) => {
  const result = await listIssues(c.req.param('slug'));
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.get('/:slug/issues/:id', async (c) => {
  const result = await getIssue(c.req.param('slug'), c.req.param('id'));
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.get('/:slug/issues/:id/events', async (c) => {
  const result = await getIssueEvents(c.req.param('slug'), c.req.param('id'));
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.get('/:slug/issues/:id/comments', async (c) => {
  const result = await getIssueComments(c.req.param('slug'), c.req.param('id'));
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.get('/:slug/issues/:id/triage', async (c) => {
  const result = await getIssueTriage(c.req.param('slug'), c.req.param('id'));
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.post('/:slug/issues/:id/transition', async (c) => {
  const body = await parseBody<{ from?: string; to?: string }>(c);
  if (!body.ok) return body.error;
  const result = await transitionIssue(
    c.req.param('slug'),
    c.req.param('id'),
    body.data.from,
    body.data.to,
  );
  if (!result.ok) {
    const r = result as { ok: false; error: string; status: number; legalTargets?: unknown[] };
    return c.json(
      { error: r.error, ...(r.legalTargets ? { legalTargets: r.legalTargets } : {}) },
      r.status as 400 | 404 | 422,
    );
  }
  return c.json(result.data);
});

router.post('/:slug/issues/:id/comment', async (c) => {
  const body = await parseBody<{ body?: string }>(c);
  if (!body.ok) return body.error;
  const result = await commentOnIssue(c.req.param('slug'), c.req.param('id'), body.data.body);
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 404);
});

router.post('/:slug/issues/:id/set-milestone', async (c) => {
  const body = await parseBody<{ milestoneNumber?: number | null }>(c);
  if (!body.ok) return body.error;
  const result = await setIssueMilestone(
    c.req.param('slug'),
    c.req.param('id'),
    body.data.milestoneNumber ?? null,
  );
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.post('/:slug/issues/:id/set-label', async (c) => {
  const body = await parseBody<{ group?: string; value?: string }>(c);
  if (!body.ok) return body.error;
  const result = await setIssueLabel(
    c.req.param('slug'),
    c.req.param('id'),
    body.data.group,
    body.data.value,
  );
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 404);
});

router.post('/:slug/issues/:id/repo-override', async (c) => {
  const body = await parseBody<{ repo?: unknown }>(c).catch(() => ({ ok: false as const, error: null }));
  if (!body.ok) {
    // repo-override uses raw body parse with null fallback (original used .catch(() => null))
    const rawBody = (await c.req.json().catch(() => null)) as { repo?: unknown } | null;
    const repo = typeof rawBody?.repo === 'string' ? rawBody.repo : null;
    if (repo == null) return c.json({ error: 'repo is required' }, 400);
    const result = await overrideIssueRepo(c.req.param('slug'), c.req.param('id'), repo);
    return result.ok
      ? c.json(result.data)
      : c.json({ error: result.error }, result.status as 400 | 404);
  }
  const result = await overrideIssueRepo(
    c.req.param('slug'),
    c.req.param('id'),
    body.data.repo,
  );
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 404);
});

router.post('/:slug/issues/:id/fake-run', async (c) => {
  const body = await parseBody<{ skill?: string }>(c);
  if (!body.ok) return body.error;
  const result = await fakeRun(
    c.req.param('slug'),
    c.req.param('id'),
    body.data.skill ?? '',
  );
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

export { router as issuesRouter };
```

**Note on repo-override router:** The original `index.ts` uses `.catch(() => null)` for the body parse (not throwing on bad JSON). The router above delegates validation to the service. Simplify the router handler: always use `parseBody` and pass `body.data?.repo` to the service which handles the type check.

Replace the `repo-override` handler with this simpler version:

```ts
router.post('/:slug/issues/:id/repo-override', async (c) => {
  const body = await parseBody<{ repo?: unknown }>(c);
  const repo = body.ok ? body.data.repo : null;
  const result = await overrideIssueRepo(c.req.param('slug'), c.req.param('id'), repo);
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 404);
});
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/domains/issues/
git commit -m "feat(server): issues domain — service, router, service tests"
```

---

### Task 6: Remaining domain routers (events, projects, webhooks, workflows)

**Files:**
- Create: `apps/server/src/domains/events/router.ts`
- Create: `apps/server/src/domains/projects/router.ts`
- Create: `apps/server/src/domains/webhooks/handler.ts`
- Create: `apps/server/src/domains/webhooks/handler.test.ts`
- Create: `apps/server/src/domains/webhooks/router.ts`
- Create: `apps/server/src/domains/workflows/triage-batch.ts`
- Create: `apps/server/src/domains/workflows/triage-batch.test.ts`
- Create: `apps/server/src/domains/workflows/router.ts`

- [ ] **Step 1: Create `apps/server/src/domains/events/router.ts`**

```ts
import { buildSseStream } from '@goose-hub/core/event-stream/sse.js';
import { Hono } from 'hono';

const router = new Hono();

router.get('/', (c) => {
  const projectId = c.req.query('projectId') ?? undefined;
  const workItemId = c.req.query('workItemId') ?? undefined;
  const lastEventIdHeader = c.req.header('Last-Event-ID');
  const lastEventIdQuery = c.req.query('lastEventId');
  const lastEventId = lastEventIdHeader ?? lastEventIdQuery;
  const sinceId = lastEventId != null ? Number.parseInt(lastEventId, 10) : undefined;

  const stream = buildSseStream(
    { projectId, workItemId },
    Number.isNaN(sinceId) ? undefined : sinceId,
  );

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

export { router as eventsRouter };
```

- [ ] **Step 2: Create `apps/server/src/domains/projects/router.ts`**

```ts
import { Hono } from 'hono';
import { listProjects } from '../../shared/projects.js';

const router = new Hono();

router.get('/health', (c) => c.json({ ok: true }));

router.get('/projects', async (c) => {
  const projects = await listProjects();
  return c.json({ projects });
});

export { router as projectsRouter };
```

- [ ] **Step 3: Create `apps/server/src/domains/webhooks/handler.ts`**

Copy the full content of `webhooks/github.ts`. No logic changes needed — the file is identical:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { logger } from '@goose-hub/core/logger.js';
import type { Context } from 'hono';

/** Map from GitHub repo full name → project slug */
const REPO_TO_SLUG: Record<string, string> = {
  'shaunnez/goose-hub': 'goose-hub-self',
};

export function verifyGitHubSignature(body: string, signature: string, secret: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'));
  } catch {
    return false;
  }
}

export async function handleGitHubWebhook(c: Context): Promise<Response> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (secret == null || secret.length === 0) {
    return c.json({ error: 'webhook secret not configured' }, 500);
  }

  const signature = c.req.header('X-Hub-Signature-256') ?? '';
  if (!signature) {
    return c.json({ error: 'missing signature' }, 401);
  }

  const rawBody = await c.req.text();

  if (!verifyGitHubSignature(rawBody, signature, secret)) {
    return c.json({ error: 'invalid signature' }, 401);
  }

  const eventType = c.req.header('X-GitHub-Event') ?? '';

  if (eventType !== 'issues') {
    return c.json({ ok: true, event: eventType, action: 'ignored' });
  }

  let payload: { action?: string; repository?: { full_name?: string } };
  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }

  if (payload.action !== 'opened') {
    return c.json({
      ok: true,
      event: eventType,
      action: payload.action ?? 'unknown',
      status: 'ignored',
    });
  }

  const repoName = payload.repository?.full_name ?? '';
  const slug = REPO_TO_SLUG[repoName];

  if (slug == null) {
    return c.json({ ok: true, event: eventType, action: 'ignored', reason: 'repo not in allowlist' });
  }

  import('../../workflows/triage-batch.js')
    .then(({ runTriageBatch }) => runTriageBatch(slug))
    .catch((err: unknown) => {
      logger.error('webhook triage-batch failed', { slug, error: String(err) });
    });

  return c.json({ ok: true, event: eventType, action: 'dispatched', slug });
}
```

**Note:** The dynamic import path `../../workflows/triage-batch.js` will be updated in Task 7 once the workflows domain exists. For now use `../../domains/workflows/triage-batch.js`.

- [ ] **Step 4: Create `apps/server/src/domains/webhooks/handler.test.ts`**

Copy the full content of `webhooks/github.test.ts`. Update the import:

```ts
// Change:
import { verifyGitHubSignature, handleGitHubWebhook } from './github.js';
// To:
import { verifyGitHubSignature, handleGitHubWebhook } from './handler.js';
```

Also update any import of triage-batch inside the test mocks:

```ts
// Change: vi.mock('../workflows/triage-batch.js', ...)
// To:     vi.mock('../workflows/triage-batch.js', ...) — this stays because the handler does a dynamic import
```

Check `github.test.ts` for exact mock paths and update them.

- [ ] **Step 5: Create `apps/server/src/domains/webhooks/router.ts`**

```ts
import { Hono } from 'hono';
import { handleGitHubWebhook } from './handler.js';

const router = new Hono();

router.post('/github', handleGitHubWebhook);

export { router as webhooksRouter };
```

- [ ] **Step 6: Create `apps/server/src/domains/workflows/triage-batch.ts`**

Copy the full content of `workflows/triage-batch.ts`. Two changes:

1. Update `getSourceForSlug` import:
```ts
// Change:
import { getSourceForSlug } from '../source.js';
// To:
import { getSourceForSlug } from '../../shared/source.js';
```

2. Update `REPO_ROOT` (file moves one level deeper: `src/workflows/` → `src/domains/workflows/`):
```ts
// Change:
const REPO_ROOT = join(import.meta.dirname, '../../../..');
// To:
const REPO_ROOT = join(import.meta.dirname, '../../../../..');
```

3. Update skill schema imports (same extra `..`):
```ts
// Change:
import { RepoMatchOutputSchema } from '../../../../skills/repo-match/schema.js';
import { TriageOutputSchema } from '../../../../skills/triage/schema.js';
// To:
import { RepoMatchOutputSchema } from '../../../../../skills/repo-match/schema.js';
import { TriageOutputSchema } from '../../../../../skills/triage/schema.js';
```

- [ ] **Step 7: Create `apps/server/src/domains/workflows/triage-batch.test.ts`**

Copy the full content of `workflows/triage-batch.test.ts`. Update the import:

```ts
// Change: import { runTriageBatch } from './triage-batch.js'; (or whatever the original uses)
// Check the original file for the exact import and update to './triage-batch.js' (same name, same folder)
```

Also update the mock for `getSourceForSlug`:
```ts
// Change: vi.mock('../source.js', ...)
// To:     vi.mock('../../shared/source.js', ...)
```

- [ ] **Step 8: Create `apps/server/src/domains/workflows/router.ts`**

```ts
import { logger } from '@goose-hub/core/logger.js';
import { Hono } from 'hono';

const router = new Hono();

router.post('/:slug/tick', async (c) => {
  const slug = c.req.param('slug');
  const { runTriageBatch } = await import('./triage-batch.js');
  runTriageBatch(slug).catch((err: unknown) => {
    logger.error('triage-batch failed', { slug, error: String(err) });
  });
  return c.json({ ok: true, slug }, 202);
});

export { router as workflowsRouter };
```

- [ ] **Step 9: Run domain tests**

```bash
pnpm test -- "domains/(webhooks|workflows)" --reporter=verbose 2>&1
```

Expected: all webhook handler tests and workflow triage-batch tests pass.

- [ ] **Step 10: Commit**

```bash
git add apps/server/src/domains/
git commit -m "feat(server): events, projects, webhooks, workflows domain routers"
```

---

### Task 7: server.ts and index.ts

**Files:**
- Create: `apps/server/src/server.ts`
- Modify: `apps/server/src/index.ts`

- [ ] **Step 1: Create `apps/server/src/server.ts`**

```ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { issuesRouter } from './domains/issues/router.js';
import { milestonesRouter } from './domains/milestones/router.js';
import { inboxRouter } from './domains/inbox/router.js';
import { eventsRouter } from './domains/events/router.js';
import { projectsRouter } from './domains/projects/router.js';
import { webhooksRouter } from './domains/webhooks/router.js';
import { workflowsRouter } from './domains/workflows/router.js';

const app = new Hono();
app.use('*', cors());

app.route('/', projectsRouter);           // GET /health, GET /projects
app.route('/projects', milestonesRouter); // GET/POST /projects/:slug/milestones/**, /active-milestone
app.route('/projects', issuesRouter);     // GET/POST /projects/:slug/issues/**
app.route('/projects', workflowsRouter);  // POST /projects/:slug/tick
app.route('/inbox', inboxRouter);         // GET/POST /inbox/**
app.route('/events', eventsRouter);       // GET /events
app.route('/webhooks', webhooksRouter);   // POST /webhooks/github

export { app };
```

- [ ] **Step 2: Update `apps/server/src/index.ts`**

Replace the entire file with:

```ts
import { resolve } from 'node:path';
import { config } from 'dotenv';
config({ path: resolve(import.meta.dirname, '../../../.env') });

import { logger } from '@goose-hub/core/logger.js';
import { serve } from '@hono/node-server';
import { app } from './server.js';

if (process.env.VITEST == null) {
  if (process.env.GITHUB_WEBHOOK_SECRET == null || process.env.GITHUB_WEBHOOK_SECRET.length === 0) {
    throw new Error('GITHUB_WEBHOOK_SECRET env var is required to start the server');
  }
  const port = Number(process.env.PORT ?? 3001);
  serve({ fetch: app.fetch, port });
  logger.info('server started', { port });
}
```

- [ ] **Step 3: Update `apps/server/src/index.test.ts`**

Change the import on line 1:

```ts
// Change:
import { app } from './index.js';
// To:
import { app } from './server.js';
```

The mock setup and all test bodies remain identical.

- [ ] **Step 4: Run the full test suite**

```bash
pnpm test 2>&1 | tail -30
```

Expected: all tests pass. The new domain tests run alongside the migrated `index.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/server.ts apps/server/src/index.ts apps/server/src/index.test.ts
git commit -m "feat(server): server.ts wires domain routers; index.ts is pure entry point"
```

---

### Task 8: Delete old files and move test files

**Files to delete:**
- `apps/server/src/active-milestone.ts`
- `apps/server/src/active-milestone.test.ts`
- `apps/server/src/cache.ts`
- `apps/server/src/cache.test.ts`
- `apps/server/src/source.ts`
- `apps/server/src/projects.ts`
- `apps/server/src/webhooks/github.ts`
- `apps/server/src/webhooks/github.test.ts`
- `apps/server/src/workflows/triage-batch.ts`
- `apps/server/src/workflows/triage-batch.test.ts`
- `apps/server/src/webhooks/` (directory, now empty)
- `apps/server/src/workflows/` (directory, now empty)

- [ ] **Step 1: Delete old source files and tests**

```bash
git rm apps/server/src/active-milestone.ts apps/server/src/active-milestone.test.ts
git rm apps/server/src/cache.ts apps/server/src/cache.test.ts
git rm apps/server/src/source.ts apps/server/src/projects.ts
git rm apps/server/src/webhooks/github.ts apps/server/src/webhooks/github.test.ts
git rm apps/server/src/workflows/triage-batch.ts apps/server/src/workflows/triage-batch.test.ts
```

- [ ] **Step 2: Remove empty directories**

```bash
# Only if empty after above deletions:
git rm -r apps/server/src/webhooks
git rm -r apps/server/src/workflows
```

- [ ] **Step 3: Run full test suite to confirm nothing broke**

```bash
pnpm test 2>&1 | tail -30
```

Expected: all tests pass, no references to deleted files.

- [ ] **Step 4: Run TypeScript type check**

```bash
pnpm tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 5: Run lint**

```bash
pnpm biome check apps/server/src/ 2>&1 | tail -20
```

Expected: no errors (only format fixes if any).

- [ ] **Step 6: Apply any lint auto-fixes**

```bash
pnpm biome check --write apps/server/src/ 2>&1
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(server): delete old flat files after domain migration"
```

---

### Task 9: STANDARDS.md guide file

**Files:**
- Create: `apps/server/STANDARDS.md`

- [ ] **Step 1: Create `apps/server/STANDARDS.md`**

```markdown
# Server API Standards

> Claude: read this before touching any file in `apps/server/src/`.

## Folder Structure

Every new feature in the server MUST be placed into one of the domain folders under `src/domains/`. The domain folders map to URL prefixes:

| Domain | URL prefix | Has repository? |
|--------|-----------|-----------------|
| `issues/` | `/projects/:slug/issues/**` | No (GitHub-sourced) |
| `milestones/` | `/projects/:slug/milestones/**`, `/projects/:slug/active-milestone` | Yes (SQLite `projectState`) |
| `inbox/` | `/inbox/**` | Yes (SQLite `inboxItems`) |
| `events/` | `/events` | No |
| `projects/` | `/projects`, `/health` | No |
| `webhooks/` | `/webhooks/**` | No |
| `workflows/` | `/projects/:slug/tick` | No |

Each domain folder contains:

```
domains/<name>/
  router.ts      ← Hono sub-router, HTTP-only, no business logic
  service.ts     ← Business logic, validation, event emission
  repository.ts  ← Drizzle queries only (omit if domain has no SQLite state)
  service.test.ts
  repository.test.ts  (if repository.ts exists)
```

## Shared Layer (`shared/`)

Cross-cutting utilities used by 2+ domains live in `shared/`.

| File | Contents |
|------|----------|
| `cache.ts` | `getCached<T>()`, `bustCache()`, `CACHE_KEY` |
| `middleware.ts` | `parseBody<T>()`, `Result<T>` type |
| `projects.ts` | `listProjects()`, `getProject()` |
| `source.ts` | `getSourceForSlug()` |

**Rule:** If a utility is used by only one domain, it lives inside that domain. Promote to `shared/` only when a second domain needs it.

## Layer Contracts

Dependencies always flow **router → service → repository**. Never backwards.

### Router (`router.ts`)
- HTTP parsing only: read params, parse body with `parseBody<T>()`, return JSON
- No DB calls, no business logic, no `eventStore` calls
- Returns `result.data` on success, `{ error: result.error }` on failure

```ts
router.post('/:slug/something', async (c) => {
  const body = await parseBody<{ value: string }>(c);
  if (!body.ok) return body.error;
  const result = await service.doThing(c.req.param('slug'), body.data.value);
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 400 | 404);
});
```

### Service (`service.ts`)
- Business logic only: validate inputs, call source/repository/eventStore
- Never receives a Hono `Context` — takes plain typed arguments
- Returns `Result<T>`: `{ ok: true; data: T }` or `{ ok: false; error: string; status: number }`

```ts
export async function doThing(slug: string, value: string): Promise<Result<{ ok: true }>> {
  if (!value.trim()) return { ok: false, error: 'value is required', status: 400 };
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  // ... do work
  return { ok: true, data: { ok: true } };
}
```

### Repository (`repository.ts`)
- Drizzle queries only: no business logic, no event emission
- Exports named async functions, no class wrappers
- Returns domain types, not raw DB rows

```ts
export async function getMyEntity(id: number): Promise<MyEntity | null> {
  const [row] = await db.select().from(myTable).where(eq(myTable.id, id));
  return row ?? null;
}
```

## Import Rules

- Domain files import shared utilities from `../../shared/`.
- `server.ts` is the only file that imports from multiple domains.
- Domains **never** import from other domains.
- `index.ts` is the entry point only — no logic, no exports.

## Body Parsing

Always use `parseBody<T>()` from `../../shared/middleware.js`. Never write inline try/catch for JSON parsing.

```ts
const body = await parseBody<{ title: string }>(c);
if (!body.ok) return body.error; // returns 400 automatically
```

## Test Coverage Requirements

| What | Where | Pattern |
|------|-------|---------|
| Service business logic | `<domain>/service.test.ts` | Mock `getSourceForSlug`, `eventStore`, repository — no HTTP |
| Repository queries | `<domain>/repository.test.ts` | Mock `db` with vitest `vi.mock` |
| HTTP contracts (non-trivial only) | `<domain>/router.test.ts` | `app.request()` with mocked service |
| Shared utilities | `shared/*.test.ts` | Pure function tests where possible |

## Adding a New Route

1. Which domain does this URL belong to? Pick the matching domain folder.
2. Add the business logic to `service.ts` (with tests first).
3. Add the Drizzle query to `repository.ts` if DB is needed (with tests).
4. Add the route handler to `router.ts` (HTTP parsing + service call only).
5. No changes to `server.ts` unless you are adding a new domain entirely.

## Adding a New Domain

1. Create `src/domains/<name>/` with `router.ts`, `service.ts`, and optionally `repository.ts`.
2. Register the router in `src/server.ts` with `app.route('/prefix', <name>Router)`.
3. Add an entry to the domain table in this file.
```

- [ ] **Step 2: Run full test + lint + typecheck to confirm green**

```bash
pnpm test 2>&1 | tail -10
pnpm tsc --noEmit 2>&1
pnpm biome check apps/server/src/ 2>&1 | tail -10
```

Expected: all passing.

- [ ] **Step 3: Commit**

```bash
git add apps/server/STANDARDS.md
git commit -m "docs(server): add STANDARDS.md guide for domain module architecture"
```

---

### Task 10: Final verification

- [ ] **Step 1: Run full monorepo test suite**

```bash
pnpm test 2>&1 | tail -30
```

Expected: all tests pass with no regressions.

- [ ] **Step 2: TypeScript check**

```bash
pnpm tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 3: Lint check**

```bash
pnpm biome check 2>&1 | tail -20
```

Apply any auto-fixes:

```bash
pnpm biome check --write . 2>&1
```

- [ ] **Step 4: Check test coverage hasn't regressed**

```bash
pnpm test --coverage 2>&1 | grep -E "(All files|apps/server)"
```

Expected: overall coverage at or above baseline from before the refactor.

- [ ] **Step 5: Final commit if any lint fixes were applied**

```bash
git add -A
git commit -m "chore(server): apply lint fixes after domain architecture migration"
```
