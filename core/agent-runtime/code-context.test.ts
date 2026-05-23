import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

  it('skips symlinked files that resolve outside the worktree', () => {
    const root = mkdtempSync(join(tmpdir(), 'goose-hub-code-context-'));
    const outside = mkdtempSync(join(tmpdir(), 'goose-hub-code-context-outside-'));
    try {
      writeFileSync(join(outside, 'secret.txt'), 'secret\n');
      symlinkSync(join(outside, 'secret.txt'), join(root, 'linked-secret.txt'));

      expect(
        buildCodeContextBundle({
          worktreePath: root,
          keyFiles: [{ path: 'linked-secret.txt', line: 1, reason: 'symlink' }],
        }),
      ).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('recomputes line range metadata when snippet output is truncated', () => {
    const root = mkdtempSync(join(tmpdir(), 'goose-hub-code-context-'));
    try {
      mkdirSync(join(root, 'src'));
      writeFileSync(
        join(root, 'src', 'long.ts'),
        ['before '.repeat(80), 'target line', 'after '.repeat(80)].join('\n'),
      );

      const [entry] = buildCodeContextBundle({
        worktreePath: root,
        keyFiles: [{ path: 'src/long.ts', line: 2, reason: 'target' }],
        radius: 1,
        maxSnippetChars: 40,
      });

      expect(entry).toMatchObject({
        path: 'src/long.ts',
        startLine: 2,
        endLine: 2,
        snippet: '2: target line',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
