import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverPackageRoots, normalizeRepoRelativePath } from './path-normalization.js';

function makeWorktree(): string {
  const worktreePath = mkdtempSync(join(tmpdir(), 'goose-hub-path-normalization-'));
  writeFileSync(
    join(worktreePath, 'pnpm-workspace.yaml'),
    ['packages:', "  - 'apps/*'", "  - 'core'", "  - 'skills'"].join('\n'),
  );
  return worktreePath;
}

function touch(worktreePath: string, path: string): void {
  const absPath = join(worktreePath, path);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, '');
}

describe('repo-relative path normalization', () => {
  it('resolves a unique package-relative frontend path', () => {
    const worktreePath = makeWorktree();
    touch(worktreePath, 'apps/web/src/components/chrome/slice.test.ts');
    mkdirSync(join(worktreePath, 'core'), { recursive: true });
    mkdirSync(join(worktreePath, 'skills'), { recursive: true });

    const result = normalizeRepoRelativePath({
      rawPath: 'src/components/chrome/slice.test.ts',
      worktreePath,
    });

    expect(result).toEqual({
      path: 'apps/web/src/components/chrome/slice.test.ts',
      changed: true,
      source: 'package-root',
    });
  });

  it('strips an absolute worktree path to repo-relative form', () => {
    const worktreePath = makeWorktree();
    touch(worktreePath, 'core/agent-runtime/investigation-context.ts');

    const result = normalizeRepoRelativePath({
      rawPath: join(worktreePath, 'core/agent-runtime/investigation-context.ts'),
      worktreePath,
    });

    expect(result.path).toBe('core/agent-runtime/investigation-context.ts');
    expect(result.changed).toBe(true);
    expect(result.source).toBe('absolute-worktree');
  });

  it('strips leading dot slash from an otherwise canonical path', () => {
    const worktreePath = makeWorktree();
    touch(worktreePath, 'apps/web/foo.tsx');

    const result = normalizeRepoRelativePath({
      rawPath: './apps/web/foo.tsx',
      worktreePath,
    });

    expect(result).toEqual({
      path: 'apps/web/foo.tsx',
      changed: true,
      source: 'as-is',
    });
  });

  it('does not silently choose an ambiguous package-relative path', () => {
    const worktreePath = makeWorktree();
    touch(worktreePath, 'apps/web/src/index.ts');
    touch(worktreePath, 'apps/server/src/index.ts');

    const result = normalizeRepoRelativePath({
      rawPath: 'src/index.ts',
      worktreePath,
    });

    expect(result.source).toBe('unresolved');
    expect(result.path).toBe('src/index.ts');
    expect(result.ambiguous).toEqual(['apps/server/src/index.ts', 'apps/web/src/index.ts']);
  });

  it('discovers workspace package roots from pnpm-workspace.yaml plus fallbacks', () => {
    const worktreePath = makeWorktree();
    mkdirSync(join(worktreePath, 'apps/web'), { recursive: true });
    mkdirSync(join(worktreePath, 'core'), { recursive: true });
    mkdirSync(join(worktreePath, 'skills'), { recursive: true });

    expect(discoverPackageRoots(worktreePath)).toEqual(['apps/web', 'core', 'skills']);
  });
});
