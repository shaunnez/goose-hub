import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectScopeManifest } from './scope-manifest.js';

function scratchRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'manifest-'));
  mkdirSync(join(root, 'apps/web/src/components/detail'), { recursive: true });
  writeFileSync(join(root, 'apps/web/src/components/detail/TaskHeader.tsx'), '');
  writeFileSync(join(root, 'apps/web/src/components/detail/api.ts.bak'), '');
  return root;
}

describe('collectScopeManifest', () => {
  it('returns file + dir entries under each scopeRoot, capped at 800', () => {
    const root = scratchRepo();
    const out = collectScopeManifest(root, ['apps/web/src/components/detail']);
    expect(
      out.find(
        (e) => e.path === 'apps/web/src/components/detail/TaskHeader.tsx' && e.kind === 'file',
      ),
    ).toBeDefined();
    expect(
      out.find((e) => e.path === 'apps/web/src/components/detail' && e.kind === 'dir'),
    ).toBeDefined();
    expect(out.length).toBeLessThanOrEqual(800);
  });

  it('returns [] for non-existent scopeRoots without throwing', () => {
    const root = scratchRepo();
    expect(collectScopeManifest(root, ['does/not/exist'])).toEqual([]);
  });

  it('skips node_modules, .git, dist, .factory', () => {
    const root = scratchRepo();
    mkdirSync(join(root, 'apps/web/src/components/detail/node_modules/foo'), { recursive: true });
    writeFileSync(join(root, 'apps/web/src/components/detail/node_modules/foo/index.ts'), '');
    const out = collectScopeManifest(root, ['apps/web/src/components/detail']);
    expect(out.every((e) => !e.path.includes('node_modules'))).toBe(true);
  });

  it('rejects absolute scopeRoot paths (security: path traversal)', () => {
    const root = scratchRepo();
    // /etc is an absolute path outside repoRoot — must yield no entries
    const out = collectScopeManifest(root, ['/etc']);
    expect(out).toEqual([]);
  });

  it('rejects traversal scopeRoot paths that resolve outside repoRoot', () => {
    const root = scratchRepo();
    // ../../etc resolves above repoRoot — must yield no entries
    const out = collectScopeManifest(root, ['../../etc']);
    expect(out).toEqual([]);
  });

  it('accepts an innocuous relative scopeRoot inside repoRoot', () => {
    const root = scratchRepo();
    const out = collectScopeManifest(root, ['apps/web/src/components/detail']);
    expect(out.some((e) => e.kind === 'file')).toBe(true);
  });
});
