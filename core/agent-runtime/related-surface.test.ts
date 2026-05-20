import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildRelatedSurfaceManifest,
  discoveryCallsRepeatRelatedSurface,
} from './related-surface.js';

function makeWorktree(paths: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'goose-hub-related-surface-'));
  writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n  - 'core'\n");
  for (const path of paths) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, '');
  }
  return root;
}

describe('buildRelatedSurfaceManifest', () => {
  it('finds existing sibling tests and package roots', () => {
    const worktreePath = makeWorktree([
      'apps/web/src/components/chrome/Sidebar.tsx',
      'apps/web/src/components/chrome/Sidebar.test.tsx',
    ]);

    const manifest = buildRelatedSurfaceManifest({
      worktreePath,
      workItemNumber: 876,
      evidencePostEnabled: true,
      investigation: {
        keyFiles: [{ path: 'apps/web/src/components/chrome/Sidebar.tsx' }],
        openQuestions: [],
      },
    });

    expect(manifest?.packageRoots).toEqual(['apps/web']);
    expect(manifest?.existingTests).toEqual(['apps/web/src/components/chrome/Sidebar.test.tsx']);
    expect(manifest?.targetedTestPaths).toEqual([
      'apps/web/src/components/chrome/Sidebar.test.tsx',
    ]);
    expect(manifest?.evidenceSpecPath).toBe('apps/web/e2e/issue-876.spec.ts');
  });

  it('returns a deterministic test candidate when no sibling test exists', () => {
    const worktreePath = makeWorktree(['core/agent-runtime/foo.ts']);

    const manifest = buildRelatedSurfaceManifest({
      worktreePath,
      workItemNumber: 42,
      evidencePostEnabled: true,
      investigation: {
        keyFiles: [{ path: 'core/agent-runtime/foo.ts' }],
        openQuestions: [],
      },
    });

    expect(manifest?.existingTests).toEqual([]);
    expect(manifest?.testCandidates[0]).toBe('core/agent-runtime/foo.test.ts');
    expect(manifest?.checkedAbsent).toContain('core/agent-runtime/foo.test.ts');
    expect(manifest?.targetedTestPaths).toEqual(['core/agent-runtime/foo.test.ts']);
    expect(manifest?.evidenceSpecPath).toBeNull();
  });
});

describe('discoveryCallsRepeatRelatedSurface', () => {
  it('warns when a search repeats a checked-absent test path', () => {
    expect(
      discoveryCallsRepeatRelatedSurface({
        relatedSurface: {
          keyFiles: [{ path: 'apps/web/src/components/chrome/Sidebar.tsx' }],
          packageRoots: ['apps/web'],
          existingTests: [],
          testCandidates: ['apps/web/src/components/chrome/Sidebar.test.tsx'],
          evidenceSpecPath: 'apps/web/e2e/issue-876.spec.ts',
          checkedAbsent: ['apps/web/src/components/chrome/Sidebar.test.tsx'],
          targetedTestPaths: ['apps/web/src/components/chrome/Sidebar.test.tsx'],
        },
        toolEvents: [
          {
            kind: 'agent.tool-call',
            payload: {
              tool_name: 'list_files',
              tool_input: { path: 'apps/web/src/components/chrome', glob: 'Sidebar.test.tsx' },
            },
          },
        ],
      }),
    ).toBe(true);
  });
});
