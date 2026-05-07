#!/usr/bin/env tsx
/**
 * Install the full factory:* label set on a GitHub repo.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx pnpm install-labels <owner>/<repo>
 *
 * Idempotent: existing labels are updated to match the canonical color/description.
 *             Labels not in this script are left alone (we never delete).
 *
 * Label definitions live in core/bootstrap/labels.ts — single source of truth.
 */

import { FACTORY_LABELS } from '../core/bootstrap/labels.js';
import type { Label } from '../core/bootstrap/labels.js';

interface GitHubLabel extends Label {
  id: number;
  url: string;
  default: boolean;
}

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.argv[2];

if (!TOKEN) {
  console.error('Set GITHUB_TOKEN env var (a GitHub personal access token with repo scope).');
  process.exit(1);
}
if (!REPO || !REPO.includes('/')) {
  console.error('Usage: GITHUB_TOKEN=xxx pnpm install-labels <owner>/<repo>');
  process.exit(1);
}

const API = `https://api.github.com/repos/${REPO}/labels`;

const headers: Record<string, string> = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'goose-hub-bootstrap-script',
};

async function getExistingLabels(): Promise<Map<string, GitHubLabel>> {
  const all: GitHubLabel[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${API}?per_page=100&page=${page}`, { headers });
    if (!res.ok) {
      console.error(`Failed to list labels: ${res.status} ${await res.text()}`);
      process.exit(1);
    }
    const batch = (await res.json()) as GitHubLabel[];
    all.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return new Map(all.map((l) => [l.name, l]));
}

async function createLabel(label: Label): Promise<boolean> {
  const res = await fetch(API, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(label),
  });
  if (!res.ok) {
    console.error(`  failed to create ${label.name}: ${res.status} ${await res.text()}`);
    return false;
  }
  return true;
}

async function updateLabel(oldName: string, label: Label): Promise<boolean> {
  const res = await fetch(`${API}/${encodeURIComponent(oldName)}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      new_name: label.name,
      color: label.color,
      description: label.description,
    }),
  });
  if (!res.ok) {
    console.error(`  failed to update ${oldName}: ${res.status} ${await res.text()}`);
    return false;
  }
  return true;
}

async function main(): Promise<void> {
  console.log(`Installing ${FACTORY_LABELS.length} labels on ${REPO}...`);
  const existing = await getExistingLabels();

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const label of FACTORY_LABELS) {
    const current = existing.get(label.name);
    if (!current) {
      const ok = await createLabel(label);
      if (ok) {
        created++;
        console.log(`  + ${label.name}`);
      } else {
        failed++;
      }
    } else if (current.color !== label.color || (current.description || '') !== label.description) {
      const ok = await updateLabel(label.name, label);
      if (ok) {
        updated++;
        console.log(`  ~ ${label.name}`);
      } else {
        failed++;
      }
    } else {
      unchanged++;
    }
  }

  console.log(`\nDone. Created ${created}, updated ${updated}, unchanged ${unchanged}, failed ${failed}.`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
