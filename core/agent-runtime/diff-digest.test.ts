import { describe, expect, it } from 'vitest';
import { buildDiffDigest, formatDiffDigestSummary } from './diff-digest.js';

describe('buildDiffDigest', () => {
  it('summarizes changed files, hunks, size, tests, and risky areas', () => {
    const diff = [
      'diff --git a/core/db/schema.ts b/core/db/schema.ts',
      '--- a/core/db/schema.ts',
      '+++ b/core/db/schema.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/core/db/schema.test.ts b/core/db/schema.test.ts',
      '--- a/core/db/schema.test.ts',
      '+++ b/core/db/schema.test.ts',
      '@@ -10 +10,2 @@',
      '+expect(schema).toBeDefined();',
    ].join('\n');

    const digest = buildDiffDigest(diff, {
      artifactKey: 'pr-diff:abc',
      kind: 'pr-diff',
      summary: 'summary',
      bytes: 1200,
      stored: true,
    });

    expect(digest).toMatchObject({
      hunkCount: 2,
      additions: 2,
      deletions: 1,
      roughChangeSize: 'small',
      testFilesTouched: ['core/db/schema.test.ts'],
      riskyAreas: ['database-schema'],
      artifactKey: 'pr-diff:abc',
    });
    expect(digest.changedFiles).toEqual([
      { path: 'core/db/schema.test.ts', hunkCount: 1, additions: 1, deletions: 0 },
      { path: 'core/db/schema.ts', hunkCount: 1, additions: 1, deletions: 1 },
    ]);
  });

  it('formats a compact stable summary', () => {
    const digest = buildDiffDigest('diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n+x');

    expect(formatDiffDigestSummary(digest)).toBe(
      '1 changed files: src/a.ts; 1 hunks; +1/-0; small',
    );
  });
});
