/**
 * Idempotent label installer for any GitHub repository.
 *
 * Uses the canonical `FACTORY_LABELS` set from `./labels.ts` as the
 * single source of truth. Accepts an injected `fetch` implementation
 * for testability.
 *
 * Algorithm:
 *   1. GET `/repos/{owner}/{repo}/labels?per_page=100` (paginate all pages).
 *   2. For each canonical label:
 *      - absent   → POST  (create)
 *      - present but color or description differs → PATCH (update)
 *      - present and identical → skip
 *   3. Return `InstallResult` with counts and any per-label errors.
 */

import { FACTORY_LABELS } from './labels.js';
import type { Label } from './labels.js';

export interface InstallError {
  name: string;
  message: string;
}

export interface InstallResult {
  created: number;
  updated: number;
  skipped: number;
  errors: InstallError[];
}

interface GitHubLabel {
  name: string;
  color: string;
  description: string;
}

export async function installLabels(
  repoRef: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<InstallResult> {
  const baseUrl = `https://api.github.com/repos/${repoRef}/labels`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'goose-hub-bootstrap',
  };

  // Step 1: paginate all existing labels
  const existing = await fetchAllExistingLabels(baseUrl, headers, fetchImpl);

  // Step 2: reconcile each canonical label
  const result: InstallResult = { created: 0, updated: 0, skipped: 0, errors: [] };

  for (const label of FACTORY_LABELS) {
    const current = existing.get(label.name);

    if (current == null) {
      const err = await createLabel(baseUrl, label, headers, fetchImpl);
      if (err != null) {
        result.errors.push({ name: label.name, message: err });
      } else {
        result.created += 1;
      }
    } else if (current.color !== label.color || (current.description ?? '') !== label.description) {
      const err = await updateLabel(baseUrl, label, headers, fetchImpl);
      if (err != null) {
        result.errors.push({ name: label.name, message: err });
      } else {
        result.updated += 1;
      }
    } else {
      result.skipped += 1;
    }
  }

  return result;
}

async function fetchAllExistingLabels(
  baseUrl: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<Map<string, GitHubLabel>> {
  const all: GitHubLabel[] = [];
  let page = 1;

  while (true) {
    const url = `${baseUrl}?per_page=100&page=${page}`;
    const res = await fetchImpl(url, { headers });
    if (!res.ok) {
      throw new Error(`Failed to list labels: ${res.status} ${res.statusText}`);
    }
    const batch = (await res.json()) as GitHubLabel[];
    all.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }

  return new Map(all.map((l) => [l.name, l]));
}

async function createLabel(
  baseUrl: string,
  label: Label,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const res = await fetchImpl(baseUrl, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(label),
  });
  if (!res.ok) {
    const text = await res.text();
    return `${res.status} ${text}`;
  }
  return null;
}

async function updateLabel(
  baseUrl: string,
  label: Label,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const url = `${baseUrl}/${encodeURIComponent(label.name)}`;
  const res = await fetchImpl(url, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      new_name: label.name,
      color: label.color,
      description: label.description,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    return `${res.status} ${text}`;
  }
  return null;
}
