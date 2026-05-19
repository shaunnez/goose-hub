import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventStore } from '../../../event-stream/store.js';
import type { FactoryContext } from '../context.js';
import { PathPolicyViolation } from '../path-policy.js';
import {
  ApplyPatchError,
  DeleteKindError,
  EditMatchError,
  applyPatchTool,
  createDirectoryTool,
  deleteFileTool,
  editFileTool,
  moveFileTool,
  writeFileTool,
} from './write.js';

let workspace: string;
let ctx: FactoryContext;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'factory-write-'));
  ctx = {
    runId: `run-${Math.random().toString(36).slice(2, 12)}`,
    projectId: 'demo',
    workItemId: 'github:demo/repo#1',
    workspaceRoot: workspace,
    serverPort: 3001,
  };
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('writeFileTool', () => {
  it('creates a file and reports created=true', async () => {
    const result = await writeFileTool(ctx, {
      path: 'src/new.ts',
      content: 'export const X = 1;\n',
    });
    expect(result.created).toBe(true);
    expect(result.bytesWritten).toBe(20);
    expect(readFileSync(join(workspace, 'src/new.ts'), 'utf8')).toBe('export const X = 1;\n');
  });

  it('overwrites and reports created=false', async () => {
    writeFileSync(join(workspace, 'a.txt'), 'old');
    const result = await writeFileTool(ctx, { path: 'a.txt', content: 'new' });
    expect(result.created).toBe(false);
    expect(readFileSync(join(workspace, 'a.txt'), 'utf8')).toBe('new');
  });

  it('emits blocked tool-call on assistant-home path', async () => {
    await expect(
      writeFileTool(ctx, { path: '.claude/settings.json', content: 'evil' }),
    ).rejects.toBeInstanceOf(PathPolicyViolation);
    const events = eventStore.replay({ runId: ctx.runId, kind: 'agent.tool-call' });
    const blocked = events.find((e) => (e.payload as { blocked?: boolean }).blocked === true);
    expect(blocked).toBeTruthy();
    expect((blocked?.payload as { reason: string }).reason).toBe('assistant_home');
  });
});

describe('editFileTool', () => {
  beforeEach(() => {
    writeFileSync(join(workspace, 'edit.txt'), 'one\ntwo\nthree\n');
  });

  it('replaces a unique fragment', async () => {
    const result = await editFileTool(ctx, {
      path: 'edit.txt',
      oldString: 'two',
      newString: 'TWO',
    });
    expect(result.replacements).toBe(1);
    expect(readFileSync(join(workspace, 'edit.txt'), 'utf8')).toBe('one\nTWO\nthree\n');
  });

  it('refuses an ambiguous (>1 match) edit unless replaceAll', async () => {
    writeFileSync(join(workspace, 'dup.txt'), 'a\na\na\n');
    await expect(
      editFileTool(ctx, { path: 'dup.txt', oldString: 'a', newString: 'b' }),
    ).rejects.toBeInstanceOf(EditMatchError);
  });

  it('replaceAll replaces every occurrence', async () => {
    writeFileSync(join(workspace, 'dup.txt'), 'a\na\na\n');
    const result = await editFileTool(ctx, {
      path: 'dup.txt',
      oldString: 'a',
      newString: 'b',
      replaceAll: true,
    });
    expect(result.replacements).toBe(3);
    expect(readFileSync(join(workspace, 'dup.txt'), 'utf8')).toBe('b\nb\nb\n');
  });

  it('throws when oldString is missing', async () => {
    await expect(
      editFileTool(ctx, { path: 'edit.txt', oldString: 'nope', newString: 'x' }),
    ).rejects.toBeInstanceOf(EditMatchError);
  });
});

describe('applyPatchTool', () => {
  beforeEach(() => {
    execSync('git init -q', { cwd: workspace });
    writeFileSync(join(workspace, 'hello.txt'), 'hello\n');
  });

  it('applies a unified diff via git apply', async () => {
    const patch = [
      'diff --git a/hello.txt b/hello.txt',
      'index 0000000..1111111 100644',
      '--- a/hello.txt',
      '+++ b/hello.txt',
      '@@ -1 +1 @@',
      '-hello',
      '+goodbye',
      '',
    ].join('\n');

    const result = await applyPatchTool(ctx, { path: 'hello.txt', patch });
    expect(result.applied).toBe(true);
    expect(readFileSync(join(workspace, 'hello.txt'), 'utf8')).toBe('goodbye\n');
  });

  it('throws ApplyPatchError for a malformed patch', async () => {
    await expect(
      applyPatchTool(ctx, { path: 'hello.txt', patch: 'not a real patch\n' }),
    ).rejects.toBeInstanceOf(ApplyPatchError);
  });
});

describe('createDirectoryTool', () => {
  it('creates a nested directory and reports created=true', async () => {
    const result = await createDirectoryTool(ctx, { path: 'a/b/c' });
    expect(result.created).toBe(true);
    expect(existsSync(join(workspace, 'a/b/c'))).toBe(true);
  });

  it('reports created=false for an already-existing directory', async () => {
    mkdirSync(join(workspace, 'existing'));
    const result = await createDirectoryTool(ctx, { path: 'existing' });
    expect(result.created).toBe(false);
  });
});

describe('moveFileTool', () => {
  it('renames a file across nested paths', async () => {
    writeFileSync(join(workspace, 'a.txt'), 'x');
    const result = await moveFileTool(ctx, { from: 'a.txt', to: 'nested/b.txt' });
    expect(result.from).toBe('a.txt');
    expect(result.to).toBe('nested/b.txt');
    expect(existsSync(join(workspace, 'a.txt'))).toBe(false);
    expect(readFileSync(join(workspace, 'nested/b.txt'), 'utf8')).toBe('x');
  });
});

describe('deleteFileTool', () => {
  it('removes an existing file and reports deleted=true', async () => {
    writeFileSync(join(workspace, 'gone.txt'), 'x');
    const result = await deleteFileTool(ctx, { path: 'gone.txt' });
    expect(result.deleted).toBe(true);
    expect(existsSync(join(workspace, 'gone.txt'))).toBe(false);
  });

  it('reports deleted=false for a missing path (idempotent)', async () => {
    const result = await deleteFileTool(ctx, { path: 'never-existed.txt' });
    expect(result.deleted).toBe(false);
  });

  it('refuses to delete a directory', async () => {
    mkdirSync(join(workspace, 'dir'));
    await expect(deleteFileTool(ctx, { path: 'dir' })).rejects.toBeInstanceOf(DeleteKindError);
  });
});
