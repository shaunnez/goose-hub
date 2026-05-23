import { describe, expect, it } from 'vitest';
import { buildPrDiffWithContext } from './pr-diff-context.js';

describe('buildPrDiffWithContext', () => {
  it('extracts changed files and hunk line ranges from a PR diff', () => {
    const context = buildPrDiffWithContext(
      [
        'diff --git a/src/foo.ts b/src/foo.ts',
        '@@ -10,2 +10,3 @@ function foo()',
        '-old',
        '+new',
        'diff --git a/src/bar.ts b/src/bar.ts',
        '@@ -1 +1 @@',
        '+export const bar = true;',
      ].join('\n'),
    );

    expect(context.changedFiles).toEqual(['src/foo.ts', 'src/bar.ts']);
    expect(context.hunks).toEqual([
      {
        file: 'src/foo.ts',
        oldStart: 10,
        oldLines: 2,
        newStart: 10,
        newLines: 3,
        heading: 'function foo()',
      },
      {
        file: 'src/bar.ts',
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
      },
    ]);
  });

  it('parses quoted diff headers and unescapes unusual path characters', () => {
    const context = buildPrDiffWithContext(
      [
        'diff --git "a/src/foo b/bar\\tfile.ts" "b/src/foo b/bar\\tfile.ts"',
        '@@ -5 +5 @@ function quoted()',
        '-old',
        '+new',
      ].join('\n'),
    );

    expect(context.changedFiles).toEqual(['src/foo b/bar\tfile.ts']);
    expect(context.hunks).toMatchObject([
      { file: 'src/foo b/bar\tfile.ts', oldStart: 5, newStart: 5 },
    ]);
  });
});
