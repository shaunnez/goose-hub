import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalizeFactoryToolPath } from './path-contract.js';

function makeWorktree(): string {
  const worktreePath = mkdtempSync(join(tmpdir(), 'goose-hub-tool-path-contract-'));
  writeFileSync(
    join(worktreePath, 'pnpm-workspace.yaml'),
    ['packages:', "  - 'apps/*'", "  - 'core'"].join('\n'),
  );
  return worktreePath;
}

function touch(worktreePath: string, path: string): void {
  const absPath = join(worktreePath, path);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, '');
}

describe('factory tool path contract', () => {
  it('returns canonical metadata for a unique package-relative path', () => {
    const worktreePath = makeWorktree();
    touch(worktreePath, 'apps/web/src/components/chrome/Sidebar.tsx');

    const result = canonicalizeFactoryToolPath({
      rawPath: 'src/components/chrome/Sidebar.tsx',
      worktreePath,
    });

    expect(result).toMatchObject({
      ok: true,
      path: {
        path: 'apps/web/src/components/chrome/Sidebar.tsx',
        root: 'worktree',
        packageRoot: 'apps/web',
        normalizedFrom: 'src/components/chrome/Sidebar.tsx',
      },
    });
  });

  it('strips absolute worktree paths from response metadata', () => {
    const worktreePath = makeWorktree();
    touch(worktreePath, 'core/tool-layer/tools/read.ts');

    const result = canonicalizeFactoryToolPath({
      rawPath: join(worktreePath, 'core/tool-layer/tools/read.ts'),
      worktreePath,
    });

    expect(result).toMatchObject({
      ok: true,
      path: {
        path: 'core/tool-layer/tools/read.ts',
        root: 'worktree',
        packageRoot: 'core',
        normalizedFrom: join(worktreePath, 'core/tool-layer/tools/read.ts'),
      },
    });
  });

  it('returns a structured error for ambiguous package-relative paths', () => {
    const worktreePath = makeWorktree();
    touch(worktreePath, 'apps/server/src/index.ts');
    touch(worktreePath, 'apps/web/src/index.ts');

    const result = canonicalizeFactoryToolPath({
      rawPath: 'src/index.ts',
      worktreePath,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'ambiguous-repo-relative-path',
        rawPath: 'src/index.ts',
        candidates: ['apps/server/src/index.ts', 'apps/web/src/index.ts'],
        message:
          'Path "src/index.ts" is ambiguous. Choose one canonical repo-relative path explicitly.',
      },
    });
  });
});
