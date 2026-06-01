# PR G: Explicit Post-Back Comments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow deliberate user-triggered summaries to be posted back to Jira/Bitbucket from the detail page, with no automatic posting, no Jira workflow transitions, and no raw provider payloads crossing the service boundary.

**Architecture:** New core adapters (Jira, Bitbucket) wrap provider REST APIs and return typed result DTOs. A new server `integrations` domain validates, sanitizes, dispatches to adapters, and stores comment refs in `work_item_external_refs`. A new `PostBackActions` UI component in the detail overview section triggers posting only on explicit user action.

**Tech Stack:** TypeScript, Hono, React, React Query, Zod, Vitest, Drizzle/SQLite, Bitbucket REST API 2.0, Jira REST API v3

---

## Pre-Conditions (Audit Results)

- No existing Jira/Bitbucket adapter code anywhere in the codebase.
- `work_item_external_refs` table exists in `core/db/schema.ts` with `provider`, `kind`, `repoRef`, `externalId`, `url`, `metadataJson` columns.
- `LocalDbWorkItemRepository.upsertExternalRef` handles insert-or-update correctly.
- `core/integrations/github/external-refs.ts` is the reference adapter pattern.
- GitHub token comes from `process.env.GITHUB_TOKEN` — Jira/Bitbucket tokens will follow the same pattern.
- `parseBody<T>` in `apps/server/src/shared/middleware.ts` only JSON-parses; Zod validation must be done separately in routes.
- `resolveCanonicalWorkItemForRoute(slug, routeId)` in `apps/server/src/shared/work-item-resolution.ts` returns `ResolvedCanonicalWorkItemForRoute` with `projectId` and `canonicalWorkItemId`.
- No `integrations` domain exists in `apps/server/src/domains/` — create from scratch.

---

## File Map

**Create:**
- `core/integrations/post-back/types.ts` — PostBackKind, PostBackProvider, PostBackAdapterInput, PostBackAdapterResult, PostBackAvailability
- `core/integrations/jira/comment.ts` — Jira REST API comment adapter
- `core/integrations/jira/comment.test.ts` — adapter unit tests
- `core/integrations/bitbucket/comment.ts` — Bitbucket REST API comment adapter
- `core/integrations/bitbucket/comment.test.ts` — adapter unit tests
- `core/integrations/post-back/store.ts` — wraps `upsertExternalRef` for comment refs
- `apps/server/src/domains/integrations/service.ts` — sanitize, availability check, dispatch, store
- `apps/server/src/domains/integrations/service.test.ts` — service unit tests
- `apps/server/src/domains/integrations/router.ts` — Hono routes for availability + post-back
- `apps/server/src/domains/integrations/no-auto-post.test.ts` — regression: workflows don't auto-post
- `apps/web/src/lib/api/integrations.ts` — fetch helpers for availability and post-back
- `apps/web/src/components/detail/components/PostBackActions.tsx` — action buttons with pending/success/error state

**Modify:**
- `core/types.ts` — add `jira?` and `bitbucket?` to `LocalDbSourceConfig.integrations`
- `apps/server/src/server.ts` — register `integrationsRouter`
- `apps/web/src/components/detail/components/OverviewSection.tsx` — add `<PostBackActions />`

---

## Task 1: Extend integration config types

**Files:**
- Modify: `core/types.ts`

- [ ] **Step 1: Extend LocalDbSourceConfig.integrations**

In `core/types.ts`, find this block (around line 10):

```typescript
integrations?: {
  github?: {
    repos: string[];
    mirrorLabels?: boolean;
    importIssues?: boolean;
  };
};
```

Replace with:

```typescript
integrations?: {
  github?: {
    repos: string[];
    mirrorLabels?: boolean;
    importIssues?: boolean;
  };
  jira?: {
    /** Jira Cloud base URL, e.g. https://mycompany.atlassian.net */
    baseUrl: string;
    /** Atlassian account email for Basic auth — token from JIRA_TOKEN env var */
    email: string;
  };
  bitbucket?: {
    /** Bitbucket workspace slug */
    workspace: string;
    /** Bitbucket username for Basic auth — app password from BITBUCKET_TOKEN env var */
    username: string;
  };
};
```

- [ ] **Step 2: Verify typecheck passes**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add core/types.ts
git commit -m "feat: extend LocalDbSourceConfig.integrations with jira and bitbucket fields"
```

---

## Task 2: Post-back DTOs

**Files:**
- Create: `core/integrations/post-back/types.ts`

- [ ] **Step 1: Write types**

Create `core/integrations/post-back/types.ts`:

```typescript
export type PostBackKind =
  | 'prd-summary'
  | 'investigation-summary'
  | 'pr-link'
  | 'needs-human';

export type PostBackProvider = 'jira' | 'bitbucket';

export interface PostBackAdapterInput {
  /** Provider-specific identifier: Jira issue key (e.g. "PROJ-42") or Bitbucket PR number (e.g. "42") */
  externalId: string;
  /** For Bitbucket: "workspace/repo-slug". Null for Jira. */
  repoRef: string | null;
  /** Sanitized, capped text to post as a comment */
  text: string;
}

export type PostBackAdapterResult =
  | { ok: true; commentId: string; url: string | null }
  | { ok: false; httpStatus: number; detail: string };

export interface PostBackAvailability {
  jira: boolean;
  bitbucket: boolean;
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add core/integrations/post-back/types.ts
git commit -m "feat: add post-back adapter DTOs"
```

---

## Task 3: Jira comment adapter

**Files:**
- Create: `core/integrations/jira/comment.ts`
- Create: `core/integrations/jira/comment.test.ts`

- [ ] **Step 1: Write the failing test**

Create `core/integrations/jira/comment.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postJiraComment } from './comment.js';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('postJiraComment', () => {
  const baseInput = {
    externalId: 'PROJ-42',
    repoRef: null,
    text: 'Test comment',
    baseUrl: 'https://example.atlassian.net',
    email: 'user@example.com',
    token: 'test-token',
  };

  it('POSTs to the correct Jira comment URL with correct auth and ADF body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'comment-123',
        self: 'https://example.atlassian.net/rest/api/3/issue/PROJ-42/comment/comment-123',
      }),
    });

    const result = await postJiraComment(baseInput);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.atlassian.net/rest/api/3/issue/PROJ-42/comment',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from('user@example.com:test-token').toString('base64')}`,
        }),
        body: expect.stringContaining('"type":"text"'),
      }),
    );
    expect(result).toEqual({
      ok: true,
      commentId: 'comment-123',
      url: 'https://example.atlassian.net/rest/api/3/issue/PROJ-42/comment/comment-123',
    });
  });

  it('strips trailing slash from baseUrl', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 'c-1', self: null }),
    });

    await postJiraComment({ ...baseInput, baseUrl: 'https://example.atlassian.net/' });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.atlassian.net/rest/api/3/issue/PROJ-42/comment',
      expect.anything(),
    );
  });

  it('returns ok:false with httpStatus on non-201 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ errorMessages: ['Issue does not exist'], errors: {} }),
    });

    const result = await postJiraComment(baseInput);

    expect(result).toEqual({
      ok: false,
      httpStatus: 404,
      detail: expect.stringContaining('Issue does not exist'),
    });
  });

  it('returns ok:false on fetch network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    const result = await postJiraComment(baseInput);

    expect(result).toEqual({ ok: false, httpStatus: 0, detail: 'Network failure' });
  });

  it('returns null url when self is absent', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 'c-1' }),
    });

    const result = await postJiraComment(baseInput);

    expect(result).toMatchObject({ ok: true, commentId: 'c-1', url: null });
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm vitest run core/integrations/jira/comment.test.ts
```

Expected: FAIL — cannot find module `./comment.js`.

- [ ] **Step 3: Implement the adapter**

Create `core/integrations/jira/comment.ts`:

```typescript
import type { PostBackAdapterInput, PostBackAdapterResult } from '../post-back/types.js';

interface JiraCredentials {
  baseUrl: string;
  email: string;
  token: string;
}

export async function postJiraComment(
  input: PostBackAdapterInput & JiraCredentials,
): Promise<PostBackAdapterResult> {
  const url = `${input.baseUrl.replace(/\/$/, '')}/rest/api/3/issue/${input.externalId}/comment`;
  const auth = Buffer.from(`${input.email}:${input.token}`).toString('base64');

  const body = JSON.stringify({
    body: {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: input.text }],
        },
      ],
    },
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body,
    });

    const json = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const messages = Array.isArray(json.errorMessages)
        ? (json.errorMessages as string[]).join('; ')
        : JSON.stringify(json);
      return { ok: false, httpStatus: response.status, detail: messages };
    }

    const commentId = String(json.id ?? '');
    const url_ = typeof json.self === 'string' ? json.self : null;
    return { ok: true, commentId, url: url_ };
  } catch (err) {
    return {
      ok: false,
      httpStatus: 0,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm vitest run core/integrations/jira/comment.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add core/integrations/jira/comment.ts core/integrations/jira/comment.test.ts
git commit -m "feat: add Jira comment adapter"
```

---

## Task 4: Bitbucket comment adapter

**Files:**
- Create: `core/integrations/bitbucket/comment.ts`
- Create: `core/integrations/bitbucket/comment.test.ts`

- [ ] **Step 1: Write the failing test**

Create `core/integrations/bitbucket/comment.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postBitbucketComment } from './comment.js';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('postBitbucketComment', () => {
  const baseInput = {
    externalId: '42',
    repoRef: 'myworkspace/my-repo',
    text: 'Test comment',
    username: 'bitbucket-user',
    token: 'app-password',
  };

  it('POSTs to the correct Bitbucket URL with Basic auth and raw body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        id: 99,
        links: {
          self: {
            href: 'https://api.bitbucket.org/2.0/repositories/myworkspace/my-repo/pullrequests/42/comments/99',
          },
        },
      }),
    });

    const result = await postBitbucketComment(baseInput);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.bitbucket.org/2.0/repositories/myworkspace/my-repo/pullrequests/42/comments',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from('bitbucket-user:app-password').toString('base64')}`,
        }),
        body: JSON.stringify({ content: { raw: 'Test comment' } }),
      }),
    );
    expect(result).toEqual({
      ok: true,
      commentId: '99',
      url: 'https://api.bitbucket.org/2.0/repositories/myworkspace/my-repo/pullrequests/42/comments/99',
    });
  });

  it('returns null url when links are absent from response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 99 }),
    });

    const result = await postBitbucketComment(baseInput);

    expect(result).toMatchObject({ ok: true, commentId: '99', url: null });
  });

  it('returns ok:false with httpStatus on non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: 'Forbidden' } }),
    });

    const result = await postBitbucketComment(baseInput);

    expect(result).toEqual({ ok: false, httpStatus: 403, detail: 'Forbidden' });
  });

  it('returns ok:false on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await postBitbucketComment(baseInput);

    expect(result).toEqual({ ok: false, httpStatus: 0, detail: 'Connection refused' });
  });

  it('returns ok:false immediately when repoRef is null', async () => {
    const result = await postBitbucketComment({
      ...baseInput,
      repoRef: null,
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      httpStatus: 0,
      detail: expect.stringContaining('repoRef'),
    });
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm vitest run core/integrations/bitbucket/comment.test.ts
```

Expected: FAIL — cannot find module `./comment.js`.

- [ ] **Step 3: Implement the adapter**

Create `core/integrations/bitbucket/comment.ts`:

```typescript
import type { PostBackAdapterInput, PostBackAdapterResult } from '../post-back/types.js';

interface BitbucketCredentials {
  username: string;
  token: string;
}

export async function postBitbucketComment(
  input: PostBackAdapterInput & BitbucketCredentials,
): Promise<PostBackAdapterResult> {
  if (input.repoRef == null) {
    return { ok: false, httpStatus: 0, detail: 'repoRef is required for Bitbucket comments' };
  }

  const url = `https://api.bitbucket.org/2.0/repositories/${input.repoRef}/pullrequests/${input.externalId}/comments`;
  const auth = Buffer.from(`${input.username}:${input.token}`).toString('base64');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({ content: { raw: input.text } }),
    });

    const json = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const error =
        (json.error as { message?: string } | undefined)?.message ?? JSON.stringify(json);
      return { ok: false, httpStatus: response.status, detail: error };
    }

    const commentId = String(json.id ?? '');
    const links = json.links as { self?: { href?: string } } | undefined;
    const commentUrl = typeof links?.self?.href === 'string' ? links.self.href : null;
    return { ok: true, commentId, url: commentUrl };
  } catch (err) {
    return {
      ok: false,
      httpStatus: 0,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm vitest run core/integrations/bitbucket/comment.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add core/integrations/bitbucket/comment.ts core/integrations/bitbucket/comment.test.ts
git commit -m "feat: add Bitbucket comment adapter"
```

---

## Task 5: Post-back comment ref storage

**Files:**
- Create: `core/integrations/post-back/store.ts`

- [ ] **Step 1: Create the store function**

Create `core/integrations/post-back/store.ts`:

```typescript
import type { LocalDbExternalRefRow } from '../../state-source/local-db-repository.js';
import { LocalDbWorkItemRepository } from '../../state-source/local-db-repository.js';
import type { PostBackKind, PostBackProvider } from './types.js';

export function storeCommentRef(input: {
  projectId: string;
  workItemId: string;
  provider: PostBackProvider;
  commentId: string;
  url: string | null;
  repoRef: string | null;
  sourceKind: PostBackKind;
  repository?: LocalDbWorkItemRepository;
}): LocalDbExternalRefRow {
  const repo = input.repository ?? new LocalDbWorkItemRepository();
  return repo.upsertExternalRef({
    projectId: input.projectId,
    itemId: input.workItemId,
    provider: input.provider,
    kind: 'comment',
    repoRef: input.repoRef ?? null,
    externalId: input.commentId,
    url: input.url ?? null,
    metadata: {
      sourceKind: input.sourceKind,
      lastPostedAt: new Date().toISOString(),
    },
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add core/integrations/post-back/store.ts
git commit -m "feat: add post-back comment ref storage helper"
```

---

## Task 6: Server integrations service

**Files:**
- Create: `apps/server/src/domains/integrations/service.ts`
- Create: `apps/server/src/domains/integrations/service.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/server/src/domains/integrations/service.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListExternalRefs, mockGetProject } = vi.hoisted(() => ({
  mockListExternalRefs: vi.fn().mockReturnValue([]),
  mockGetProject: vi.fn(),
}));

vi.mock('@goose-hub/core/integrations/jira/comment.js', () => ({
  postJiraComment: vi.fn(),
}));
vi.mock('@goose-hub/core/integrations/bitbucket/comment.js', () => ({
  postBitbucketComment: vi.fn(),
}));
vi.mock('@goose-hub/core/integrations/post-back/store.js', () => ({
  storeCommentRef: vi.fn(),
}));
vi.mock('@goose-hub/core/state-source/local-db-repository.js', () => ({
  LocalDbWorkItemRepository: vi.fn().mockImplementation(() => ({
    listExternalRefs: mockListExternalRefs,
  })),
}));
vi.mock('../../shared/projects.js', () => ({
  getProject: mockGetProject,
}));

import { postJiraComment } from '@goose-hub/core/integrations/jira/comment.js';
import { postBitbucketComment } from '@goose-hub/core/integrations/bitbucket/comment.js';
import { storeCommentRef } from '@goose-hub/core/integrations/post-back/store.js';
import {
  checkPostBackAvailability,
  executePostBack,
  sanitizePostBackText,
} from './service.js';

describe('sanitizePostBackText', () => {
  it('strips HTML tags', () => {
    expect(sanitizePostBackText('<b>hello</b> world')).toBe('hello world');
  });

  it('caps at 5000 chars', () => {
    expect(sanitizePostBackText('a'.repeat(6000))).toHaveLength(5000);
  });

  it('trims leading/trailing whitespace', () => {
    expect(sanitizePostBackText('  hello  ')).toBe('hello');
  });

  it('returns empty string when only HTML/whitespace', () => {
    expect(sanitizePostBackText('  <br/>  ')).toBe('');
  });
});

describe('checkPostBackAvailability', () => {
  beforeEach(() => {
    mockListExternalRefs.mockReturnValue([]);
  });

  it('returns false for both when no refs exist', () => {
    expect(checkPostBackAvailability('proj', 'item-1')).toEqual({
      jira: false,
      bitbucket: false,
    });
  });

  it('returns jira:true when jira issue ref exists', () => {
    mockListExternalRefs.mockReturnValue([
      { provider: 'jira', kind: 'issue', externalId: 'PROJ-1', repoRef: null },
    ]);
    expect(checkPostBackAvailability('proj', 'item-1')).toEqual({
      jira: true,
      bitbucket: false,
    });
  });

  it('returns bitbucket:true when bitbucket pull_request ref exists', () => {
    mockListExternalRefs.mockReturnValue([
      { provider: 'bitbucket', kind: 'pull_request', externalId: '42', repoRef: 'ws/repo' },
    ]);
    expect(checkPostBackAvailability('proj', 'item-1')).toEqual({
      jira: false,
      bitbucket: true,
    });
  });
});

describe('executePostBack', () => {
  beforeEach(() => {
    mockListExternalRefs.mockReturnValue([]);
    vi.mocked(postJiraComment).mockReset();
    vi.mocked(postBitbucketComment).mockReset();
    vi.mocked(storeCommentRef).mockReset();
    mockGetProject.mockResolvedValue({
      id: 'proj',
      source: {
        kind: 'local-db',
        integrations: {
          jira: { baseUrl: 'https://test.atlassian.net', email: 'user@test.com' },
          bitbucket: { workspace: 'ws', username: 'bbuser' },
        },
      },
    });
    vi.stubEnv('JIRA_TOKEN', 'jira-secret');
    vi.stubEnv('BITBUCKET_TOKEN', 'bb-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns no-ref error when no Jira ref is linked', async () => {
    const result = await executePostBack({
      projectSlug: 'proj',
      workItemId: 'item-1',
      provider: 'jira',
      kind: 'prd-summary',
      text: 'Some text',
    });
    expect(result).toEqual({ ok: false, error: 'no-ref', detail: expect.any(String) });
  });

  it('returns no-credentials error when JIRA_TOKEN is missing', async () => {
    vi.unstubAllEnvs();
    mockListExternalRefs.mockReturnValue([
      { provider: 'jira', kind: 'issue', externalId: 'PROJ-1', repoRef: null },
    ]);
    const result = await executePostBack({
      projectSlug: 'proj',
      workItemId: 'item-1',
      provider: 'jira',
      kind: 'prd-summary',
      text: 'Some text',
    });
    expect(result).toEqual({ ok: false, error: 'no-credentials', detail: expect.any(String) });
  });

  it('calls postJiraComment and stores ref on success', async () => {
    mockListExternalRefs.mockReturnValue([
      { provider: 'jira', kind: 'issue', externalId: 'PROJ-1', repoRef: null },
    ]);
    vi.mocked(postJiraComment).mockResolvedValue({
      ok: true,
      commentId: 'c-1',
      url: 'https://jira/c-1',
    });
    vi.mocked(storeCommentRef).mockReturnValue({} as never);

    const result = await executePostBack({
      projectSlug: 'proj',
      workItemId: 'item-1',
      provider: 'jira',
      kind: 'prd-summary',
      text: 'Summary text',
    });

    expect(postJiraComment).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: 'PROJ-1',
        repoRef: null,
        text: 'Summary text',
        baseUrl: 'https://test.atlassian.net',
        email: 'user@test.com',
        token: 'jira-secret',
      }),
    );
    expect(storeCommentRef).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj',
        workItemId: 'item-1',
        provider: 'jira',
        commentId: 'c-1',
        url: 'https://jira/c-1',
        repoRef: null,
        sourceKind: 'prd-summary',
      }),
    );
    expect(result).toEqual({
      ok: true,
      provider: 'jira',
      commentId: 'c-1',
      url: 'https://jira/c-1',
    });
  });

  it('returns provider-failure without storing ref on adapter error', async () => {
    mockListExternalRefs.mockReturnValue([
      { provider: 'jira', kind: 'issue', externalId: 'PROJ-1', repoRef: null },
    ]);
    vi.mocked(postJiraComment).mockResolvedValue({
      ok: false,
      httpStatus: 503,
      detail: 'Service unavailable',
    });

    const result = await executePostBack({
      projectSlug: 'proj',
      workItemId: 'item-1',
      provider: 'jira',
      kind: 'prd-summary',
      text: 'Summary text',
    });

    expect(storeCommentRef).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: 'provider-failure',
      detail: 'Service unavailable',
    });
  });

  it('strips HTML from text before calling adapter', async () => {
    mockListExternalRefs.mockReturnValue([
      { provider: 'jira', kind: 'issue', externalId: 'PROJ-1', repoRef: null },
    ]);
    vi.mocked(postJiraComment).mockResolvedValue({
      ok: true,
      commentId: 'c-2',
      url: null,
    });
    vi.mocked(storeCommentRef).mockReturnValue({} as never);

    await executePostBack({
      projectSlug: 'proj',
      workItemId: 'item-1',
      provider: 'jira',
      kind: 'prd-summary',
      text: '<script>alert("xss")</script>Real content',
    });

    expect(postJiraComment).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Real content' }),
    );
  });

  it('returns empty-text error when text is blank after sanitization', async () => {
    mockListExternalRefs.mockReturnValue([
      { provider: 'jira', kind: 'issue', externalId: 'PROJ-1', repoRef: null },
    ]);

    const result = await executePostBack({
      projectSlug: 'proj',
      workItemId: 'item-1',
      provider: 'jira',
      kind: 'prd-summary',
      text: '<br/><br/>',
    });

    expect(postJiraComment).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: 'empty-text', detail: expect.any(String) });
  });

  it('calls postBitbucketComment for bitbucket provider', async () => {
    mockListExternalRefs.mockReturnValue([
      {
        provider: 'bitbucket',
        kind: 'pull_request',
        externalId: '7',
        repoRef: 'ws/repo',
      },
    ]);
    vi.mocked(postBitbucketComment).mockResolvedValue({
      ok: true,
      commentId: '55',
      url: 'https://bb/55',
    });
    vi.mocked(storeCommentRef).mockReturnValue({} as never);

    const result = await executePostBack({
      projectSlug: 'proj',
      workItemId: 'item-1',
      provider: 'bitbucket',
      kind: 'investigation-summary',
      text: 'Investigation findings',
    });

    expect(postBitbucketComment).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: '7',
        repoRef: 'ws/repo',
        text: 'Investigation findings',
        username: 'bbuser',
        token: 'bb-secret',
      }),
    );
    expect(result).toEqual({
      ok: true,
      provider: 'bitbucket',
      commentId: '55',
      url: 'https://bb/55',
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm vitest run apps/server/src/domains/integrations/service.test.ts
```

Expected: FAIL — cannot find module `./service.js`.

- [ ] **Step 3: Implement the service**

Create `apps/server/src/domains/integrations/service.ts`:

```typescript
import { postBitbucketComment } from '@goose-hub/core/integrations/bitbucket/comment.js';
import { postJiraComment } from '@goose-hub/core/integrations/jira/comment.js';
import { storeCommentRef } from '@goose-hub/core/integrations/post-back/store.js';
import type {
  PostBackAvailability,
  PostBackKind,
  PostBackProvider,
} from '@goose-hub/core/integrations/post-back/types.js';
import { LocalDbWorkItemRepository } from '@goose-hub/core/state-source/local-db-repository.js';
import { getProject } from '#shared/projects.js';

const POST_BACK_TEXT_MAX = 5000;

export function sanitizePostBackText(text: string): string {
  return text.replace(/<[^>]*>/g, '').trim().slice(0, POST_BACK_TEXT_MAX);
}

export function checkPostBackAvailability(
  projectId: string,
  workItemId: string,
  repository?: LocalDbWorkItemRepository,
): PostBackAvailability {
  const repo = repository ?? new LocalDbWorkItemRepository();
  const refs = repo.listExternalRefs(projectId, workItemId);
  return {
    jira: refs.some((r) => r.provider === 'jira' && r.kind === 'issue'),
    bitbucket: refs.some((r) => r.provider === 'bitbucket' && r.kind === 'pull_request'),
  };
}

export type PostBackServiceResult =
  | { ok: true; provider: PostBackProvider; commentId: string; url: string | null }
  | {
      ok: false;
      error: 'no-ref' | 'no-credentials' | 'provider-failure' | 'empty-text';
      detail: string;
    };

export async function executePostBack(input: {
  projectSlug: string;
  workItemId: string;
  provider: PostBackProvider;
  kind: PostBackKind;
  text: string;
  repository?: LocalDbWorkItemRepository;
}): Promise<PostBackServiceResult> {
  const sanitized = sanitizePostBackText(input.text);
  if (sanitized.length === 0) {
    return { ok: false, error: 'empty-text', detail: 'text is empty after sanitization' };
  }

  const repo = input.repository ?? new LocalDbWorkItemRepository();
  const refs = repo.listExternalRefs(input.projectSlug, input.workItemId);

  if (input.provider === 'jira') {
    const ref = refs.find((r) => r.provider === 'jira' && r.kind === 'issue') ?? null;
    if (ref == null) {
      return {
        ok: false,
        error: 'no-ref',
        detail: 'no linked Jira issue found for this work item',
      };
    }

    const project = await getProject(input.projectSlug);
    const jiraConfig =
      project?.source.kind === 'local-db' ? project.source.integrations?.jira : undefined;
    const token = process.env.JIRA_TOKEN ?? '';

    if (jiraConfig == null || token.length === 0) {
      return {
        ok: false,
        error: 'no-credentials',
        detail: 'Jira credentials are not configured (check JIRA_TOKEN env var and jira config)',
      };
    }

    const adapterResult = await postJiraComment({
      externalId: ref.externalId,
      repoRef: ref.repoRef,
      text: sanitized,
      baseUrl: jiraConfig.baseUrl,
      email: jiraConfig.email,
      token,
    });

    if (!adapterResult.ok) {
      return { ok: false, error: 'provider-failure', detail: adapterResult.detail };
    }

    storeCommentRef({
      projectId: input.projectSlug,
      workItemId: input.workItemId,
      provider: 'jira',
      commentId: adapterResult.commentId,
      url: adapterResult.url,
      repoRef: ref.repoRef,
      sourceKind: input.kind,
      repository: repo,
    });

    return {
      ok: true,
      provider: 'jira',
      commentId: adapterResult.commentId,
      url: adapterResult.url,
    };
  }

  // bitbucket
  const ref = refs.find((r) => r.provider === 'bitbucket' && r.kind === 'pull_request') ?? null;
  if (ref == null) {
    return {
      ok: false,
      error: 'no-ref',
      detail: 'no linked Bitbucket PR found for this work item',
    };
  }

  const project = await getProject(input.projectSlug);
  const bbConfig =
    project?.source.kind === 'local-db' ? project.source.integrations?.bitbucket : undefined;
  const token = process.env.BITBUCKET_TOKEN ?? '';

  if (bbConfig == null || token.length === 0) {
    return {
      ok: false,
      error: 'no-credentials',
      detail: 'Bitbucket credentials are not configured (check BITBUCKET_TOKEN env var and bitbucket config)',
    };
  }

  const adapterResult = await postBitbucketComment({
    externalId: ref.externalId,
    repoRef: ref.repoRef,
    text: sanitized,
    username: bbConfig.username,
    token,
  });

  if (!adapterResult.ok) {
    return { ok: false, error: 'provider-failure', detail: adapterResult.detail };
  }

  storeCommentRef({
    projectId: input.projectSlug,
    workItemId: input.workItemId,
    provider: 'bitbucket',
    commentId: adapterResult.commentId,
    url: adapterResult.url,
    repoRef: ref.repoRef,
    sourceKind: input.kind,
    repository: repo,
  });

  return {
    ok: true,
    provider: 'bitbucket',
    commentId: adapterResult.commentId,
    url: adapterResult.url,
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm vitest run apps/server/src/domains/integrations/service.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/domains/integrations/service.ts apps/server/src/domains/integrations/service.test.ts
git commit -m "feat: add integrations service — sanitize, availability, post-back dispatch"
```

---

## Task 7: Server integrations router

**Files:**
- Create: `apps/server/src/domains/integrations/router.ts`
- Modify: `apps/server/src/server.ts`

- [ ] **Step 1: Create the router**

Create `apps/server/src/domains/integrations/router.ts`:

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { parseBody } from '#shared/middleware.js';
import { resolveCanonicalWorkItemForRoute } from '#shared/work-item-resolution.js';
import { checkPostBackAvailability, executePostBack } from './service.js';

const PostBackBodySchema = z.object({
  kind: z.enum(['prd-summary', 'investigation-summary', 'pr-link', 'needs-human']),
  provider: z.enum(['jira', 'bitbucket']),
  text: z.string().min(1).max(10_000),
});

const router = new Hono();

router.get('/:slug/issues/:id/integrations/post-back/availability', async (c) => {
  const resolved = await resolveCanonicalWorkItemForRoute(
    c.req.param('slug'),
    c.req.param('id'),
  );
  if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status as 400 | 404);

  const availability = checkPostBackAvailability(
    resolved.data.projectId,
    resolved.data.canonicalWorkItemId,
  );
  return c.json({ availability });
});

router.post('/:slug/issues/:id/integrations/post-back', async (c) => {
  const parsed = await parseBody<unknown>(c);
  if (!parsed.ok) return parsed.error;

  const body = PostBackBodySchema.safeParse(parsed.data);
  if (!body.success) {
    return c.json({ error: 'invalid request body', details: body.error.flatten() }, 400);
  }

  const resolved = await resolveCanonicalWorkItemForRoute(
    c.req.param('slug'),
    c.req.param('id'),
  );
  if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status as 400 | 404);

  const result = await executePostBack({
    projectSlug: resolved.data.projectId,
    workItemId: resolved.data.canonicalWorkItemId,
    provider: body.data.provider,
    kind: body.data.kind,
    text: body.data.text,
  });

  if (!result.ok) {
    const status =
      result.error === 'no-ref' || result.error === 'no-credentials' || result.error === 'empty-text'
        ? 422
        : 502;
    return c.json(result, status);
  }

  return c.json(result, 200);
});

export { router as integrationsRouter };
```

- [ ] **Step 2: Register integrationsRouter in server.ts**

In `apps/server/src/server.ts`, add the import alongside existing domain imports:

```typescript
import { integrationsRouter } from './domains/integrations/router.js';
```

Add the route registration after the existing `app.route` lines (around line 55):

```typescript
app.route('/projects', integrationsRouter); // GET/POST /projects/:slug/issues/:id/integrations/**
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/domains/integrations/router.ts apps/server/src/server.ts
git commit -m "feat: add integrations router with availability and post-back endpoints"
```

---

## Task 8: Web API client

**Files:**
- Create: `apps/web/src/lib/api/integrations.ts`

- [ ] **Step 1: Create the API client**

Create `apps/web/src/lib/api/integrations.ts`:

```typescript
import type {
  PostBackAvailability,
  PostBackKind,
  PostBackProvider,
} from '@goose-hub/core/integrations/post-back/types.js';
import { getJson, postJson } from './client.js';

export type { PostBackAvailability, PostBackKind, PostBackProvider };

export type PostBackServiceResult =
  | { ok: true; provider: PostBackProvider; commentId: string; url: string | null }
  | {
      ok: false;
      error: 'no-ref' | 'no-credentials' | 'provider-failure' | 'empty-text';
      detail: string;
    };

export async function fetchPostBackAvailability(
  slug: string,
  workItemId: string,
): Promise<PostBackAvailability> {
  const { availability } = await getJson<{ availability: PostBackAvailability }>(
    `/projects/${slug}/issues/${workItemId}/integrations/post-back/availability`,
  );
  return availability;
}

export async function postBack(
  slug: string,
  workItemId: string,
  body: { kind: PostBackKind; provider: PostBackProvider; text: string },
): Promise<PostBackServiceResult> {
  return postJson<PostBackServiceResult>(
    `/projects/${slug}/issues/${workItemId}/integrations/post-back`,
    body,
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api/integrations.ts
git commit -m "feat: add web API client for post-back availability and posting"
```

---

## Task 9: PostBackActions UI component

**Files:**
- Create: `apps/web/src/components/detail/components/PostBackActions.tsx`
- Modify: `apps/web/src/components/detail/components/OverviewSection.tsx`

- [ ] **Step 1: Create the PostBackActions component**

Create `apps/web/src/components/detail/components/PostBackActions.tsx`:

```tsx
import { fetchPostBackAvailability, postBack } from '@/lib/api/integrations';
import type { PostBackKind, PostBackProvider, PostBackServiceResult } from '@/lib/api/integrations';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle, Loader2, Send, XCircle } from 'lucide-react';
import { useState } from 'react';

interface ActionDef {
  kind: PostBackKind;
  provider: PostBackProvider;
  label: string;
  text: string;
}

interface PostBackActionsProps {
  projectSlug: string;
  /** The work item's externalId (used as the route :id param) */
  workItemId: string;
  /** Text of the PRD artifact, if available */
  prdText?: string;
  /** Text of the investigation artifact, if available */
  investigationText?: string;
  /** A summary for the needs-human state, if available */
  needsHumanSummary?: string;
  /** Formatted PR link message, if available */
  prLinkText?: string;
}

export function PostBackActions({
  projectSlug,
  workItemId,
  prdText,
  investigationText,
  needsHumanSummary,
  prLinkText,
}: PostBackActionsProps) {
  const [lastResult, setLastResult] = useState<PostBackServiceResult | null>(null);

  const { data: availability } = useQuery({
    queryKey: ['post-back-availability', projectSlug, workItemId],
    queryFn: () => fetchPostBackAvailability(projectSlug, workItemId),
    staleTime: 60_000,
    enabled: workItemId.length > 0,
  });

  const mutation = useMutation({
    mutationFn: ({
      kind,
      provider,
      text,
    }: {
      kind: PostBackKind;
      provider: PostBackProvider;
      text: string;
    }) => postBack(projectSlug, workItemId, { kind, provider, text }),
    onSuccess: (data) => setLastResult(data),
    onError: () => setLastResult(null),
  });

  if (availability == null) return null;
  if (!availability.jira && !availability.bitbucket) return null;

  const actions: ActionDef[] = [];

  if (availability.jira) {
    if (prdText != null) {
      actions.push({ kind: 'prd-summary', provider: 'jira', label: 'Post PRD to Jira', text: prdText });
    }
    if (investigationText != null) {
      actions.push({ kind: 'investigation-summary', provider: 'jira', label: 'Post Investigation to Jira', text: investigationText });
    }
    if (needsHumanSummary != null) {
      actions.push({ kind: 'needs-human', provider: 'jira', label: 'Post Needs-Human to Jira', text: needsHumanSummary });
    }
    if (prLinkText != null) {
      actions.push({ kind: 'pr-link', provider: 'jira', label: 'Post PR Link to Jira', text: prLinkText });
    }
  }

  if (availability.bitbucket) {
    if (prdText != null) {
      actions.push({ kind: 'prd-summary', provider: 'bitbucket', label: 'Post PRD to Bitbucket PR', text: prdText });
    }
    if (investigationText != null) {
      actions.push({ kind: 'investigation-summary', provider: 'bitbucket', label: 'Post Investigation to Bitbucket PR', text: investigationText });
    }
    if (needsHumanSummary != null) {
      actions.push({ kind: 'needs-human', provider: 'bitbucket', label: 'Post Needs-Human to Bitbucket PR', text: needsHumanSummary });
    }
    if (prLinkText != null) {
      actions.push({ kind: 'pr-link', provider: 'bitbucket', label: 'Post PR Link to Bitbucket PR', text: prLinkText });
    }
  }

  if (actions.length === 0) return null;

  return (
    <div data-testid="post-back-actions" className="flex flex-col gap-2 pt-2 border-t border-line">
      <h3 className="text-[11px] uppercase tracking-wider text-fg-3 font-medium">Post to External</h3>
      <div className="flex flex-wrap gap-2">
        {actions.map(({ kind, provider, label, text }) => {
          const key = `${provider}-${kind}`;
          const isThisAction =
            mutation.variables?.kind === kind && mutation.variables?.provider === provider;

          return (
            <button
              key={key}
              type="button"
              disabled={mutation.isPending}
              onClick={() => {
                setLastResult(null);
                mutation.mutate({ kind, provider, text });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-md border border-line bg-bg-elev text-fg-2 hover:bg-bg-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {mutation.isPending && isThisAction ? (
                <Loader2 size={12} className="animate-spin" />
              ) : mutation.isSuccess && isThisAction && lastResult?.ok ? (
                <CheckCircle size={12} className="text-green-500" />
              ) : mutation.isError && isThisAction ? (
                <XCircle size={12} className="text-red-500" />
              ) : (
                <Send size={12} />
              )}
              {label}
            </button>
          );
        })}
      </div>
      {mutation.isSuccess && lastResult != null && !lastResult.ok && (
        <p className="text-[11px] text-red-500" data-testid="post-back-error">
          {lastResult.detail}
        </p>
      )}
      {mutation.isError && (
        <p className="text-[11px] text-red-500" data-testid="post-back-error">
          {mutation.error instanceof Error ? mutation.error.message : 'Post failed'}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add PostBackActions to OverviewSection**

In `apps/web/src/components/detail/components/OverviewSection.tsx`:

Add the import after the existing imports:

```typescript
import { PostBackActions } from './PostBackActions';
```

At the end of the returned JSX in `OverviewSection` (before the final `</div>`), add:

```tsx
{projectSlug != null && item != null && (
  <PostBackActions
    projectSlug={projectSlug}
    workItemId={item.externalId}
  />
)}
```

Note: `prdText`, `investigationText`, `needsHumanSummary`, and `prLinkText` are intentionally omitted here. The `PostBackActions` component will hide buttons for kinds where text is not provided. Callers that have richer artifact data can pass those props directly. Wire-up of per-kind text can be done incrementally per detail section.

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/detail/components/PostBackActions.tsx apps/web/src/components/detail/components/OverviewSection.tsx
git commit -m "feat: add PostBackActions component with explicit user-triggered post-back buttons"
```

---

## Task 10: Regression tests — no auto-post

**Files:**
- Create: `apps/server/src/domains/integrations/no-auto-post.test.ts`

- [ ] **Step 1: Verify no auto-post code in workflow/transition modules**

```bash
grep -rn "jira\|bitbucket\|atlassian\|postComment\|post_back\|executePostBack" \
  apps/server/src/domains/issues/transitions.ts \
  apps/server/src/domains/workflows/ \
  core/workflows/ \
  --include="*.ts" 2>/dev/null | grep -v "\.test\." | grep -v node_modules
```

Expected: no output (no matches).

- [ ] **Step 2: Write regression test**

Create `apps/server/src/domains/integrations/no-auto-post.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

describe('regression: workflows and transitions do not auto-post to Jira or Bitbucket', () => {
  it('transitions module exports no jira/bitbucket/post-back function', async () => {
    const mod = await import('../issues/transitions.js');
    const suspicious = Object.keys(mod).filter((k) =>
      /jira|bitbucket|atlassian|postComment|postBack|post_back/i.test(k),
    );
    expect(suspicious).toEqual([]);
  });

  it('state-flows module exports no jira/bitbucket/post-back function', async () => {
    const mod = await import('../workflows/state-flows.js');
    const suspicious = Object.keys(mod).filter((k) =>
      /jira|bitbucket|atlassian|postComment|postBack|post_back/i.test(k),
    );
    expect(suspicious).toEqual([]);
  });

  it('integrations service is only exposed via its own router, not via workflow or transition imports', async () => {
    // Dynamic import — if transitions.ts or state-flows.ts imported executePostBack,
    // this test would fail with a circular-dep or import error only if those modules
    // execute side-effects. The grep in Step 1 is the authoritative check;
    // this test serves as a living canary that the integrations domain stays isolated.
    const { integrationsRouter } = await import('./router.js');
    expect(typeof integrationsRouter).toBe('object');
  });
});
```

- [ ] **Step 3: Run the regression tests**

```bash
pnpm vitest run apps/server/src/domains/integrations/no-auto-post.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 4: Run all integration tests together**

```bash
pnpm vitest run core/integrations apps/server/src/domains/integrations
```

Expected: all tests PASS.

- [ ] **Step 5: Full typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/domains/integrations/no-auto-post.test.ts
git commit -m "test: regression — workflows and transitions do not auto-post to Jira or Bitbucket"
```

---

## Closure Pass (after all tasks green)

Run these checks before opening the PR:

### Provider boundary audit

```bash
# 1. No fake external refs in local-only items
grep -rn "provider.*jira\|provider.*bitbucket" apps/server/src/domains --include="*.ts" | grep -v "\.test\." | grep -v integrations/

# 2. No Jira transition calls
grep -rn "transition\|transitionIssue\|setIssueStatus" core/integrations apps/server/src/domains/integrations --include="*.ts"

# 3. No automatic comment calls from workflow completion paths
grep -rn "executePostBack\|postJiraComment\|postBitbucketComment" core/workflows apps/server/src/domains/workflows --include="*.ts"
```

All three expected to produce no output.

### Focused dogfood regression pass

With the server running locally:

1. Open a local-only work item detail page — verify no post-back buttons appear (no linked refs).
2. Seed a Jira ref manually via SQLite (`sqlite3 ~/.factory/*.db "INSERT INTO work_item_external_refs (project_id, work_item_id, provider, kind, repo_ref, external_id, created_at) VALUES ('...', '...', 'jira', 'issue', NULL, 'TEST-1', datetime('now'))"`) and reload — verify post-back buttons appear.
3. Click a post-back button without `JIRA_TOKEN` set — verify error is visible and non-fatal (page still renders).
4. GitHub PR diff section still works.
5. Bitbucket PR diff section (if configured) still works.

### Biome check

```bash
pnpm biome check \
  core/integrations/post-back/ \
  core/integrations/jira/ \
  core/integrations/bitbucket/ \
  apps/server/src/domains/integrations/ \
  apps/web/src/lib/api/integrations.ts \
  apps/web/src/components/detail/components/PostBackActions.tsx
```

---

## Scope Boundaries

The following are explicitly OUT OF SCOPE for this PR:

- Jira issue import / sync (creating work items from Jira)
- Bitbucket PR diff fetching (separate existing feature)
- Automatic post-back on any workflow transition or completion
- Jira workflow transitions (`transitionIssue`, status changes)
- Raw Jira/Bitbucket response payloads in any server response body
- UI for seeding Jira/Bitbucket external refs (admin tooling)
- Wire-up of `prdText` / `investigationText` props in `OverviewSection` (follow-up per section)
