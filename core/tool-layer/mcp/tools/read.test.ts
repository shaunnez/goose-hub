import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventStore } from '../../../event-stream/store.js';
import type { FactoryContext } from '../context.js';
import { PathPolicyViolation } from '../path-policy.js';
import {
  fileExistsTool,
  fileInfoTool,
  listDirTool,
  listFilesTool,
  readFileTool,
  readManyFilesTool,
  searchTextTool,
} from './read.js';

let workspace: string;
let ctx: FactoryContext;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'factory-read-'));
  ctx = {
    runId: `run-${Math.random().toString(36).slice(2, 12)}`,
    projectId: 'demo',
    workItemId: 'github:demo/repo#1',
    workspaceRoot: workspace,
    serverPort: 3001,
  };
  writeFileSync(join(workspace, 'README.md'), '# Demo\n\nhello world\n');
  mkdirSync(join(workspace, 'src'));
  writeFileSync(join(workspace, 'src', 'index.ts'), 'export const NEEDLE = 42;\n');
  writeFileSync(join(workspace, 'src', 'util.ts'), 'export const OTHER = 1;\n');
  mkdirSync(join(workspace, '.codex'));
  writeFileSync(join(workspace, '.codex', 'auth.json'), 'secret');
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('readFileTool', () => {
  it('reads a workspace-relative file and emits a tool-call audit', async () => {
    const result = await readFileTool(ctx, { path: 'README.md' });
    expect(result.content).toContain('hello world');
    expect(result.path).toMatchObject({ path: 'README.md', root: 'worktree' });
    expect(result.truncated).toBe(false);

    const events = eventStore.replay({ runId: ctx.runId, kind: 'agent.tool-call' });
    expect(
      events.find((e) => (e.payload as { tool_name: string }).tool_name === 'read_file'),
    ).toBeTruthy();
  });

  it('emits a blocked tool-call event when path is .codex', async () => {
    await expect(readFileTool(ctx, { path: '.codex/auth.json' })).rejects.toBeInstanceOf(
      PathPolicyViolation,
    );
    const events = eventStore.replay({ runId: ctx.runId, kind: 'agent.tool-call' });
    const blocked = events.find(
      (e) => (e.payload as { blocked?: boolean; reason?: string }).blocked === true,
    );
    expect(blocked).toBeTruthy();
    expect((blocked?.payload as { reason: string }).reason).toBe('assistant_home');
  });

  it('honours startLine/lineCount', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n');
    writeFileSync(join(workspace, 'long.txt'), lines);
    const result = await readFileTool(ctx, {
      path: 'long.txt',
      startLine: 5,
      lineCount: 3,
    });
    expect(result.startLine).toBe(5);
    expect(result.endLine).toBe(7);
    expect(result.content).toBe('line5\nline6\nline7');
    expect(result.truncated).toBe(true);
  });
});

describe('readManyFilesTool', () => {
  it('returns successes and errors side-by-side', async () => {
    const result = await readManyFilesTool(ctx, {
      paths: ['README.md', 'does-not-exist.txt'],
    });
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toMatchObject({ path: 'README.md', root: 'worktree' });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toBe('does-not-exist.txt');
  });
});

describe('listDirTool', () => {
  it('lists immediate entries at depth 1', async () => {
    const result = await listDirTool(ctx, { path: 'src' });
    const names = result.entries.map((e) => e.name.path).sort();
    expect(names).toEqual(['src/index.ts', 'src/util.ts']);
  });

  it('rejects parent traversal', async () => {
    await expect(listDirTool(ctx, { path: '../escape' })).rejects.toBeInstanceOf(
      PathPolicyViolation,
    );
  });
});

describe('listFilesTool', () => {
  it('lists files via ripgrep with a glob filter', async () => {
    const result = await listFilesTool(ctx, { glob: '*.ts' });
    expect(result.files.some((f) => f.path.endsWith('index.ts'))).toBe(true);
    expect(result.files.some((f) => f.path.endsWith('util.ts'))).toBe(true);
    expect(result.files.some((f) => f.path.endsWith('README.md'))).toBe(false);
  });
});

describe('searchTextTool', () => {
  it('finds a literal needle and returns structured matches', async () => {
    const result = await searchTextTool(ctx, { query: 'NEEDLE' });
    expect(result.matches.length).toBeGreaterThan(0);
    const hit = result.matches.find((m) => m.path.path.endsWith('index.ts'));
    expect(hit).toBeTruthy();
    expect(hit?.line).toBe(1);
    expect(hit?.text).toContain('NEEDLE');
  });

  it('returns empty matches array when nothing matches (rg exit 1)', async () => {
    const result = await searchTextTool(ctx, { query: 'NO_SUCH_TOKEN_xyzzy' });
    expect(result.matches).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});

describe('canonical RepoRelativePath contract', () => {
  it('read_file returns RepoRelativePath with root=worktree', async () => {
    const result = await readFileTool(ctx, { path: 'README.md' });
    expect(result.path.root).toBe('worktree');
    expect(result.path.path).toBe('README.md');
  });

  it('list_dir returns workspace-relative entry paths', async () => {
    const result = await listDirTool(ctx, { path: 'src' });
    const paths = result.path;
    expect(paths.root).toBe('worktree');
    const entryPaths = result.entries.map((e) => e.name.path).sort();
    expect(entryPaths).toEqual(['src/index.ts', 'src/util.ts']);
  });

  it('search_text match paths are RepoRelativePath with root=worktree', async () => {
    const result = await searchTextTool(ctx, { query: 'NEEDLE' });
    const hit = result.matches.find((m) => m.path.path.endsWith('index.ts'));
    expect(hit?.path.root).toBe('worktree');
  });

  it('audit event carries canonical_path for a read_file call', async () => {
    await readFileTool(ctx, { path: 'README.md' });
    const events = eventStore.replay({ runId: ctx.runId, kind: 'agent.tool-call' });
    const readEvent = events.find((e) => (e.payload as { tool: string }).tool === 'read_file');
    expect(readEvent).toBeTruthy();
    const payload = readEvent?.payload as Record<string, unknown>;
    expect(payload.canonical_path).toMatchObject({ path: 'README.md', root: 'worktree' });
    expect(typeof payload.raw_path).toBe('string');
  });

  it.each([
    ['.codex/auth.json', 'assistant_home'],
    ['.agents/state.json', 'assistant_home'],
    ['.claude/settings.json', 'assistant_home'],
    ['.factory/mcp-config.json', 'factory_internals'],
    ['../escape.ts', 'parent_traversal'],
    ['/etc/passwd', 'absolute_path'],
  ])('denylist blocks %s with reason %s', async (path, expectedReason) => {
    await expect(readFileTool(ctx, { path })).rejects.toMatchObject({ code: expectedReason });
  });
});

describe('fileExistsTool', () => {
  it('returns true for an existing file', async () => {
    const result = await fileExistsTool(ctx, { path: 'README.md' });
    expect(result.exists).toBe(true);
  });

  it('returns false for a missing file', async () => {
    const result = await fileExistsTool(ctx, { path: 'no-such-file.txt' });
    expect(result.exists).toBe(false);
  });
});

describe('fileInfoTool', () => {
  it('returns size, kind, and mtime for an existing file', async () => {
    const result = await fileInfoTool(ctx, { path: 'README.md' });
    expect(result.exists).toBe(true);
    expect(result.kind).toBe('file');
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.mtime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('reports exists=false rather than throwing for a missing path', async () => {
    const result = await fileInfoTool(ctx, { path: 'no-such-file.txt' });
    expect(result.exists).toBe(false);
    expect(result.sizeBytes).toBe(0);
  });
});
