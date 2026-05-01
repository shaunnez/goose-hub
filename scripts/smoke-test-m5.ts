#!/usr/bin/env tsx
/**
 * M5 smoke test verifier.
 *
 * Usage:
 *   ISSUE_NUMBER=42 pnpm tsx scripts/smoke-test-m5.ts
 *
 * Requires: GITHUB_TOKEN env var, local server on :3001.
 */

const SERVER_BASE = process.env.SERVER_BASE ?? 'http://localhost:3001';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? '';
const REPO = 'shaunnez/goose-hub';
const ISSUE_NUMBER = process.env.ISSUE_NUMBER ?? process.argv[2] ?? '';
const TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 3_000;

if (!ISSUE_NUMBER) {
  console.error('Usage: ISSUE_NUMBER=<n> pnpm tsx scripts/smoke-test-m5.ts');
  process.exit(1);
}

if (!GITHUB_TOKEN) {
  console.error('GITHUB_TOKEN is required');
  process.exit(1);
}

async function ghGet<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

async function serverGet<T>(path: string): Promise<T> {
  const res = await fetch(`${SERVER_BASE}${path}`);
  if (!res.ok) throw new Error(`Server ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

async function pollUntil(
  label: string,
  check: () => Promise<boolean>,
  timeoutMs = TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await check()) {
        console.log(`  ✓ ${label}`);
        return;
      }
    } catch {
      // keep polling
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`TIMEOUT: ${label} not satisfied within ${timeoutMs}ms`);
}

async function main() {
  console.log(`\nM5 smoke test — issue #${ISSUE_NUMBER}\n`);

  // 1. Type label applied
  await pollUntil('type:* label applied', async () => {
    const issue = await ghGet<{ labels: Array<{ name: string }> }>(
      `/repos/${REPO}/issues/${ISSUE_NUMBER}`,
    );
    return issue.labels.some((l) => l.name.startsWith('type:'));
  });

  // 2. Priority label applied
  await pollUntil('priority:* label applied', async () => {
    const issue = await ghGet<{ labels: Array<{ name: string }> }>(
      `/repos/${REPO}/issues/${ISSUE_NUMBER}`,
    );
    return issue.labels.some((l) => l.name.startsWith('priority:'));
  });

  // 3. Triage comment posted
  await pollUntil('triage candidate comment posted', async () => {
    const comments = await ghGet<Array<{ body: string }>>(
      `/repos/${REPO}/issues/${ISSUE_NUMBER}/comments`,
    );
    return comments.some((c) => c.body.includes('**Triage complete**'));
  });

  // 4. factory:accepted label
  await pollUntil("state transitioned to factory:accepted", async () => {
    const issue = await ghGet<{ labels: Array<{ name: string }> }>(
      `/repos/${REPO}/issues/${ISSUE_NUMBER}`,
    );
    return issue.labels.some((l) => l.name === 'factory:accepted');
  });

  // 5. agent.triage-complete event in local event store
  await pollUntil('agent.triage-complete event in event store', async () => {
    const { triage } = await serverGet<{ triage: unknown | null }>(
      `/projects/goose-hub-self/issues/${ISSUE_NUMBER}/triage`,
    );
    return triage != null;
  });

  // 6. Override flow
  console.log('  Testing override flow…');
  const overrideRes = await fetch(
    `${SERVER_BASE}/projects/goose-hub-self/issues/${ISSUE_NUMBER}/repo-override`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: REPO }),
    },
  );
  if (!overrideRes.ok) throw new Error(`Override POST failed: ${overrideRes.status}`);
  const overrideData = await overrideRes.json() as { triage?: { overrideRepo?: string } };
  if (overrideData.triage?.overrideRepo !== REPO) {
    throw new Error('Override not reflected in response');
  }
  console.log('  ✓ Human override stores event and reflects in triage data');

  const { triage: finalTriage } = await serverGet<{ triage: { overrideRepo: string | null } | null }>(
    `/projects/goose-hub-self/issues/${ISSUE_NUMBER}/triage`,
  );
  if (finalTriage?.overrideRepo !== REPO) {
    throw new Error('Override not reflected in GET /triage');
  }
  console.log('  ✓ GET /triage returns overrideRepo after override');

  console.log('\n✅ All M5 smoke checks passed\n');
}

main().catch((err: unknown) => {
  console.error('\n❌', String(err), '\n');
  process.exit(1);
});
