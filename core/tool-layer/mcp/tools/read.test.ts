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
    expect(result.path).toBe('README.md');
    expect(result.truncated).toBe(false);

    const events = eventStore.replay({ runId: ctx.runId, kind: 'agent.tool-call' });
    expect(events.find((e) => (e.payload as { tool: string }).tool === 'read_file')).toBeTruthy();
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
    expect(result.files[0].path).toBe('README.md');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toBe('does-not-exist.txt');
  });
});

describe('listDirTool', () => {
  it('lists immediate entries at depth 1', async () => {
    const result = await listDirTool(ctx, { path: 'src' });
    const names = result.entries.map((e) => e.name).sort();
    expect(names).toEqual(['index.ts', 'util.ts']);
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
    expect(result.files.some((f) => f.endsWith('index.ts'))).toBe(true);
    expect(result.files.some((f) => f.endsWith('util.ts'))).toBe(true);
    expect(result.files.some((f) => f.endsWith('README.md'))).toBe(false);
  });
});

describe('searchTextTool', () => {
  it('finds a literal needle and returns structured matches', async () => {
    const result = await searchTextTool(ctx, { query: 'NEEDLE' });
    expect(result.matches.length).toBeGreaterThan(0);
    const hit = result.matches.find((m) => m.path.endsWith('index.ts'));
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
