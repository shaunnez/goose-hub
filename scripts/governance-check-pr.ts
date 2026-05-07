#!/usr/bin/env tsx
/**
 * Governance PR check script.
 *
 * Called by .github/workflows/governance-check.yml on every pull_request event.
 * Reads the GitHub event payload, fetches the PR's changed files via REST,
 * and passes them through checkGovernance() from core/bootstrap/governance-check.ts.
 *
 * Exits 0 on pass, 1 on failure (with a clear error listing each violation).
 *
 * Usage (in CI):
 *   pnpm tsx scripts/governance-check-pr.ts
 *
 * Required env vars:
 *   GITHUB_TOKEN       — GitHub Actions token with read access to pull requests
 *   GITHUB_EVENT_PATH  — Path to the GitHub Actions event JSON payload
 *   GITHUB_REPOSITORY  — e.g. "shaunnez/goose-hub"
 */

import fs from 'node:fs';
import type { PrFileChange } from '../core/bootstrap/governance-check.js';
import { checkGovernance, expandPrFileChanges } from '../core/bootstrap/governance-check.js';

const BOOTSTRAP_LABEL = 'factory:bootstrap-pr';

interface GitHubPRFile {
  filename: string;
  status: string;
  previous_filename?: string;
}

interface GitHubLabel {
  name: string;
}

interface GitHubEventPR {
  number: number;
  labels?: GitHubLabel[];
}

interface GitHubEvent {
  pull_request?: GitHubEventPR;
}

async function fetchPRFiles(
  token: string,
  repo: string,
  prNumber: number,
): Promise<GitHubPRFile[]> {
  const all: GitHubPRFile[] = [];
  let page = 1;

  while (true) {
    const url = `https://api.github.com/repos/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'goose-hub-governance-check',
      },
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`GitHub API error ${res.status}: ${body}`);
      process.exit(1);
    }

    const batch = (await res.json()) as GitHubPRFile[];
    all.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }

  return all;
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const repo = process.env.GITHUB_REPOSITORY;

  if (!token) {
    console.error('GITHUB_TOKEN is not set.');
    process.exit(1);
  }
  if (!eventPath) {
    console.error('GITHUB_EVENT_PATH is not set.');
    process.exit(1);
  }
  if (!repo) {
    console.error('GITHUB_REPOSITORY is not set.');
    process.exit(1);
  }

  // Read the event payload.
  const event: GitHubEvent = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
  const pr = event.pull_request;

  if (!pr) {
    console.log('Not a pull_request event — skipping governance check.');
    process.exit(0);
  }

  const prNumber = pr.number;

  // Determine bootstrap label from the event payload (most up-to-date for
  // labeled/unlabeled events). For synchronize/opened, GitHub also includes
  // current labels on the PR object.
  const hasBootstrapLabel = (pr.labels ?? []).some((l) => l.name === BOOTSTRAP_LABEL);

  console.log(`Governance check for PR #${prNumber} in ${repo}`);
  console.log(`factory:bootstrap-pr label present: ${hasBootstrapLabel}`);

  // Fetch changed files.
  const prFiles = await fetchPRFiles(token, repo, prNumber);
  console.log(`Changed files: ${prFiles.length}`);

  const changes = expandPrFileChanges(prFiles as PrFileChange[]);

  const result = checkGovernance(changes, hasBootstrapLabel);

  if (result.ok) {
    console.log('Governance check PASSED — no governance file violations.');
    process.exit(0);
  }

  console.error('\nGovernance check FAILED — the following violations were found:\n');
  for (const v of result.violations) {
    console.error(`  - ${v.reason}`);
  }
  console.error(
    '\nGovernance files (MISSION.md, FACTORY_RULES.md, CLAUDE.md, project configs, persona configs)',
  );
  console.error('cannot be modified by Factory-dispatched PRs (FACTORY_RULES rule 12).');
  console.error(
    'Only PRs labelled `factory:bootstrap-pr` may ADD new governance files (not modify/remove/rename).',
  );
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
