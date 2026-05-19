import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canonicalPathStringFromAuditPayload,
  normalizeToolCallAuditPayload,
  normalizeToolResultAuditPayload,
} from './tool-call-audit.js';

function makeWorktree(): string {
  const worktreePath = mkdtempSync(join(tmpdir(), 'goose-hub-tool-call-audit-'));
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

describe('normalizeToolCallAuditPayload', () => {
  it('adds canonical path metadata while preserving sanitized raw input', () => {
    const worktreePath = makeWorktree();
    touch(worktreePath, 'apps/web/src/components/chrome/Sidebar.tsx');

    const payload = normalizeToolCallAuditPayload({
      tool_name: 'Read',
      run_id: 'run-1',
      workspace_dir: worktreePath,
      tool_input: { file_path: 'src/components/chrome/Sidebar.tsx' },
    });

    expect(payload).toMatchObject({
      tool_name: 'Read',
      run_id: 'run-1',
      tool_input: { file_path: 'src/components/chrome/Sidebar.tsx' },
      raw_path: 'src/components/chrome/Sidebar.tsx',
      canonical_path: {
        path: 'apps/web/src/components/chrome/Sidebar.tsx',
        root: 'worktree',
        packageRoot: 'apps/web',
        normalizedFrom: 'src/components/chrome/Sidebar.tsx',
      },
    });
    expect(payload.workspace_dir).toBeUndefined();
  });

  it('strips absolute worktree paths from persisted raw input', () => {
    const worktreePath = makeWorktree();
    touch(worktreePath, 'core/tool-layer/tools/read.ts');

    const payload = normalizeToolCallAuditPayload({
      tool_name: 'Read',
      run_id: 'run-2',
      workspace_dir: worktreePath,
      tool_input: { file_path: join(worktreePath, 'core/tool-layer/tools/read.ts') },
    });

    expect(payload).toMatchObject({
      tool_input: { file_path: '<worktree>/core/tool-layer/tools/read.ts' },
      raw_path: '<worktree>/core/tool-layer/tools/read.ts',
      canonical_path: {
        path: 'core/tool-layer/tools/read.ts',
        root: 'worktree',
        packageRoot: 'core',
        normalizedFrom: '<worktree>/core/tool-layer/tools/read.ts',
      },
    });
    expect(JSON.stringify(payload)).not.toContain(worktreePath);
  });

  it('redacts absolute user paths outside the worktree', () => {
    const payload = normalizeToolCallAuditPayload({
      tool_name: 'Bash',
      run_id: 'run-3',
      workspace_dir: '/Users/shaunnesbitt/project/worktree',
      tool_input: {
        command: 'cat /Users/shaunnesbitt/.ssh/id_rsa',
      },
    });

    expect(payload).toMatchObject({
      tool_input: { command: 'cat [REDACTED_PATH]' },
    });
    expect(JSON.stringify(payload)).not.toContain('/Users/shaunnesbitt');
  });
});

describe('normalizeToolResultAuditPayload', () => {
  it('sanitizes absolute paths in tool-result errors', () => {
    const payload = normalizeToolResultAuditPayload({
      run_id: 'run-4',
      tool_name: 'Bash',
      workspace_dir: '/Users/shaunnesbitt/project/worktree',
      error: 'ENOENT: /Users/shaunnesbitt/project/worktree/apps/web/src/App.tsx',
    });

    expect(payload.error).toBe('ENOENT: <worktree>/apps/web/src/App.tsx');
    expect(JSON.stringify(payload)).not.toContain('/Users/shaunnesbitt');
  });
});

describe('canonicalPathStringFromAuditPayload', () => {
  it('returns the canonical path for newer events and null for older payloads', () => {
    expect(
      canonicalPathStringFromAuditPayload({
        canonical_path: { path: 'apps/web/src/App.tsx', root: 'worktree' },
      }),
    ).toBe('apps/web/src/App.tsx');
    expect(canonicalPathStringFromAuditPayload({ tool_name: 'Read' })).toBeNull();
  });
});
