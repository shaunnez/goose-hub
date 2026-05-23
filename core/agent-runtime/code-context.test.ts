import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCodeContextBundle } from './code-context.js';

describe('buildCodeContextBundle', () => {
  it('builds bounded line hunks for key files with precise lines', () => {
    const root = mkdtempSync(join(tmpdir(), 'goose-hub-code-context-'));
    try {
      writeFileSync(
        join(root, 'target.ts'),
        Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join('\n'),
      );

      const bundle = buildCodeContextBundle({
        worktreePath: root,
        keyFiles: [{ path: 'target.ts', line: 40, reason: 'root cause' }],
        radius: 3,
      });

      expect(bundle).toEqual([
        {
          path: 'target.ts',
          startLine: 37,
          endLine: 43,
          snippet: [
            '37: line 37',
            '38: line 38',
            '39: line 39',
            '40: line 40',
            '41: line 41',
            '42: line 42',
            '43: line 43',
          ].join('\n'),
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips missing paths and files without a line', () => {
    const root = mkdtempSync(join(tmpdir(), 'goose-hub-code-context-'));
    try {
      writeFileSync(join(root, 'target.ts'), 'line 1\nline 2\n');

      expect(
        buildCodeContextBundle({
          worktreePath: root,
          keyFiles: [
            { path: 'target.ts', reason: 'no line' },
            { path: 'missing.ts', line: 1, reason: 'missing' },
          ],
        }),
      ).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
