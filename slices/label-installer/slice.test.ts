import { installLabels } from '@goose-hub/core/bootstrap/label-installer.js';
import type { InstallResult } from '@goose-hub/core/bootstrap/label-installer.js';
import { FACTORY_LABELS } from '@goose-hub/core/bootstrap/labels.js';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal GitHub label shape returned by GET /repos/{owner}/{repo}/labels */
interface GHLabel {
  name: string;
  color: string;
  description: string;
}

function makeGHLabel(name: string, color: string, description: string): GHLabel {
  return { name, color, description };
}

/**
 * Build a mock `fetch` that handles:
 *   GET  /repos/…/labels?…   → returns `existing` (paginated: one page)
 *   POST /repos/…/labels     → 201 Created
 *   PATCH /repos/…/labels/{name} → 200 OK
 */
function makeMockFetch(existing: GHLabel[], opts?: { failCreate?: string; failPatch?: string }) {
  return vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = String(url);
    const method = (init?.method ?? 'GET').toUpperCase();

    if (method === 'GET' && urlStr.includes('/labels')) {
      return new Response(JSON.stringify(existing), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (method === 'POST' && urlStr.endsWith('/labels')) {
      const body = JSON.parse(init?.body as string) as GHLabel;
      if (opts?.failCreate === body.name) {
        return new Response(JSON.stringify({ message: 'Validation failed' }), { status: 422 });
      }
      return new Response(JSON.stringify({ ...body, id: 1 }), { status: 201 });
    }

    if (method === 'PATCH' && urlStr.includes('/labels/')) {
      const body = JSON.parse(init?.body as string) as { new_name?: string };
      const name = body.new_name ?? '';
      if (opts?.failPatch === name) {
        return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      }
      return new Response(JSON.stringify({ name, id: 2 }), { status: 200 });
    }

    return new Response('Not Found', { status: 404 });
  });
}

// ---------------------------------------------------------------------------
// label-installer slice — end-to-end
// ---------------------------------------------------------------------------

describe('label-installer slice — end-to-end', () => {
  const repoRef = 'owner/repo';
  const token = 'ghp_test';

  it('empty repo: all labels created, none skipped', async () => {
    const mockFetch = makeMockFetch([]);
    const result: InstallResult = await installLabels(repoRef, token, mockFetch as typeof fetch);

    expect(result.created).toBe(FACTORY_LABELS.length);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('partially labeled repo: some created, matching ones skipped', async () => {
    // Pre-install 3 labels with correct color/description → should be skipped
    const preInstalled: GHLabel[] = [
      makeGHLabel(FACTORY_LABELS[0].name, FACTORY_LABELS[0].color, FACTORY_LABELS[0].description),
      makeGHLabel(FACTORY_LABELS[1].name, FACTORY_LABELS[1].color, FACTORY_LABELS[1].description),
      makeGHLabel(FACTORY_LABELS[2].name, FACTORY_LABELS[2].color, FACTORY_LABELS[2].description),
    ];

    const mockFetch = makeMockFetch(preInstalled);
    const result: InstallResult = await installLabels(repoRef, token, mockFetch as typeof fetch);

    expect(result.skipped).toBe(3);
    expect(result.created).toBe(FACTORY_LABELS.length - 3);
    expect(result.updated).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('fully labeled repo: all skipped, none created or updated', async () => {
    const allPresent: GHLabel[] = FACTORY_LABELS.map((l) =>
      makeGHLabel(l.name, l.color, l.description),
    );

    const mockFetch = makeMockFetch(allPresent);
    const result: InstallResult = await installLabels(repoRef, token, mockFetch as typeof fetch);

    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(FACTORY_LABELS.length);
    expect(result.errors).toHaveLength(0);
  });

  it('label present with wrong color → updated, not created', async () => {
    const existing: GHLabel[] = [
      makeGHLabel(FACTORY_LABELS[0].name, 'ffffff', FACTORY_LABELS[0].description),
    ];

    const mockFetch = makeMockFetch(existing);
    const result: InstallResult = await installLabels(repoRef, token, mockFetch as typeof fetch);

    expect(result.updated).toBe(1);
    expect(result.created).toBe(FACTORY_LABELS.length - 1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('label present with wrong description → updated', async () => {
    const existing: GHLabel[] = [
      makeGHLabel(FACTORY_LABELS[0].name, FACTORY_LABELS[0].color, 'old description'),
    ];

    const mockFetch = makeMockFetch(existing);
    const result: InstallResult = await installLabels(repoRef, token, mockFetch as typeof fetch);

    expect(result.updated).toBe(1);
    expect(result.created).toBe(FACTORY_LABELS.length - 1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('create failure → recorded in errors, counts not incremented', async () => {
    const failName = FACTORY_LABELS[0].name;
    const mockFetch = makeMockFetch([], { failCreate: failName });
    const result: InstallResult = await installLabels(repoRef, token, mockFetch as typeof fetch);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].name).toBe(failName);
    expect(result.created).toBe(FACTORY_LABELS.length - 1);
  });

  it('patch failure → recorded in errors, counts not incremented', async () => {
    const target = FACTORY_LABELS[0];
    const existing: GHLabel[] = [makeGHLabel(target.name, 'ffffff', target.description)];
    const mockFetch = makeMockFetch(existing, { failPatch: target.name });
    const result: InstallResult = await installLabels(repoRef, token, mockFetch as typeof fetch);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].name).toBe(target.name);
    expect(result.updated).toBe(0);
  });

  it('paginates: fetches page 2 when first page is full (100 items)', async () => {
    // Create 100 fake labels for page 1 (all unknown to canonical), plus one
    // real canonical label that will appear on page 2.
    const page1: GHLabel[] = Array.from({ length: 100 }, (_, i) =>
      makeGHLabel(`custom:label-${i}`, 'aabbcc', 'custom'),
    );
    const page2: GHLabel[] = [
      makeGHLabel(FACTORY_LABELS[0].name, FACTORY_LABELS[0].color, FACTORY_LABELS[0].description),
    ];

    let callCount = 0;
    const paginatingFetch = vi.fn(
      async (url: string | URL, init?: RequestInit): Promise<Response> => {
        const urlStr = String(url);
        const method = (init?.method ?? 'GET').toUpperCase();

        if (method === 'GET' && urlStr.includes('/labels')) {
          callCount += 1;
          // First call returns 100 items (triggers pagination), second returns 1
          const data = callCount === 1 ? page1 : page2;
          return new Response(JSON.stringify(data), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (method === 'POST') {
          return new Response(JSON.stringify({}), { status: 201 });
        }

        return new Response('Not Found', { status: 404 });
      },
    );

    const result: InstallResult = await installLabels(
      repoRef,
      token,
      paginatingFetch as typeof fetch,
    );

    // Page 2 contained FACTORY_LABELS[0] with correct values → should be skipped
    expect(result.skipped).toBe(1);
    expect(result.created).toBe(FACTORY_LABELS.length - 1);
    // Must have made 2 GET calls (page 1 = 100 items, page 2 = 1 item) + N-1 POSTs
    expect(paginatingFetch).toHaveBeenCalledTimes(
      2 + (FACTORY_LABELS.length - 1), // 2 GETs + N-1 POSTs
    );
  });
});
