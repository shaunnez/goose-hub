import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_STDERR_LIMIT_BYTES,
  DEFAULT_STDOUT_LIMIT_BYTES,
  minimalEnv,
  runCommand,
} from './command-policy.js';
import { FactoryContextError, loadFactoryContext } from './context.js';
import { PathPolicyViolation, resolveWorkspacePath } from './path-policy.js';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'factory-mcp-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('path-policy', () => {
  it('resolves a workspace-relative path to an absolute path under root', () => {
    writeFileSync(join(workspace, 'README.md'), '');
    const resolved = resolveWorkspacePath(workspace, 'README.md');
    expect(resolved.canonical.path).toBe('README.md');
    expect(resolved.absolute).toBe(join(workspace, 'README.md'));
  });

  it('rejects an absolute path with code absolute_path', () => {
    expect(() => resolveWorkspacePath(workspace, '/etc/passwd')).toThrow(PathPolicyViolation);
    try {
      resolveWorkspacePath(workspace, '/etc/passwd');
    } catch (err) {
      expect((err as PathPolicyViolation).code).toBe('absolute_path');
    }
  });

  it('rejects a parent traversal', () => {
    try {
      resolveWorkspacePath(workspace, '../sibling/file.ts');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PathPolicyViolation);
      expect((err as PathPolicyViolation).code).toBe('parent_traversal');
    }
  });

  it('rejects home expansion', () => {
    try {
      resolveWorkspacePath(workspace, '~/.bashrc');
      throw new Error('expected throw');
    } catch (err) {
      expect((err as PathPolicyViolation).code).toBe('home_expansion');
    }
  });

  it.each([
    ['.codex/auth.json', 'assistant_home'],
    ['.claude/settings.json', 'assistant_home'],
    ['.agents/notes.md', 'assistant_home'],
    ['.factory/mcp-config.json', 'factory_internals'],
    ['nested/.codex/auth.json', 'assistant_home'],
    ['nested/.factory/run.json', 'factory_internals'],
  ])('rejects denied segment %s with reason %s', (path, expected) => {
    try {
      resolveWorkspacePath(workspace, path);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as PathPolicyViolation).code).toBe(expected);
    }
  });

  it('rejects empty path', () => {
    try {
      resolveWorkspacePath(workspace, '   ');
      throw new Error('expected throw');
    } catch (err) {
      expect((err as PathPolicyViolation).code).toBe('empty_path');
    }
  });

  it('rejects normalized paths that resolve outside the workspace', () => {
    try {
      resolveWorkspacePath(workspace, 'a/../../escape.ts');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PathPolicyViolation);
      expect((err as PathPolicyViolation).code).toBe('parent_traversal');
    }
  });
});

describe('command-policy', () => {
  it('runs a successful command and returns structured output', async () => {
    const result = await runCommand({
      command: 'node',
      args: ['-e', 'process.stdout.write("hello")'],
      cwd: workspace,
      timeoutMs: 5_000,
      env: minimalEnv(),
    });
    expect(result.status).toBe('ok');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello');
    expect(result.truncated).toBe(false);
  });

  it('captures non-zero exit codes as failed without throwing', async () => {
    const result = await runCommand({
      command: 'node',
      args: ['-e', 'process.exit(2)'],
      cwd: workspace,
      timeoutMs: 5_000,
      env: minimalEnv(),
    });
    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(2);
  });

  it('truncates stdout once the byte cap is reached', async () => {
    const result = await runCommand({
      command: 'node',
      args: ['-e', 'process.stdout.write("a".repeat(50))'],
      cwd: workspace,
      timeoutMs: 5_000,
      stdoutLimitBytes: 10,
      env: minimalEnv(),
    });
    expect(result.stdout.length).toBe(10);
    expect(result.truncated).toBe(true);
  });

  it('returns timed_out when the timeout elapses', async () => {
    const result = await runCommand({
      command: 'node',
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: workspace,
      timeoutMs: 150,
      env: minimalEnv(),
    });
    expect(result.status).toBe('timed_out');
  });

  it('reports failed when the binary cannot be spawned', async () => {
    const result = await runCommand({
      command: '/does/not/exist/factory-bin',
      args: [],
      cwd: workspace,
      timeoutMs: 1_000,
      env: minimalEnv(),
    });
    expect(result.status).toBe('failed');
    expect(result.exitCode).toBeNull();
  });

  it('exposes stable default byte caps', () => {
    expect(DEFAULT_STDOUT_LIMIT_BYTES).toBeGreaterThan(0);
    expect(DEFAULT_STDERR_LIMIT_BYTES).toBeGreaterThan(0);
    expect(DEFAULT_STDOUT_LIMIT_BYTES).toBeGreaterThanOrEqual(DEFAULT_STDERR_LIMIT_BYTES);
  });
});

describe('context', () => {
  const baseEnv = (overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({
    FACTORY_RUN_ID: 'run-1',
    FACTORY_PROJECT_ID: 'proj-1',
    FACTORY_WORK_ITEM_ID: 'github:owner/repo#42',
    FACTORY_WORKSPACE_DIR: workspace,
    FACTORY_SERVER_PORT: '3001',
    ...overrides,
  });

  it('loads the full context when all env vars are set', () => {
    const ctx = loadFactoryContext(baseEnv());
    expect(ctx.runId).toBe('run-1');
    expect(ctx.projectId).toBe('proj-1');
    expect(ctx.workItemId).toBe('github:owner/repo#42');
    expect(ctx.workspaceRoot).toBe(workspace);
    expect(ctx.serverPort).toBe(3001);
  });

  it('throws FactoryContextError listing every missing var', () => {
    try {
      loadFactoryContext(baseEnv({ FACTORY_RUN_ID: undefined, FACTORY_PROJECT_ID: '' }));
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(FactoryContextError);
      expect((err as FactoryContextError).missing).toEqual(
        expect.arrayContaining(['FACTORY_RUN_ID', 'FACTORY_PROJECT_ID']),
      );
    }
  });

  it('rejects a workspace dir that does not exist', () => {
    expect(() => loadFactoryContext(baseEnv({ FACTORY_WORKSPACE_DIR: '/no/such/dir' }))).toThrow(
      FactoryContextError,
    );
  });

  it.each(['0', '-1', 'abc', '99999'])('rejects invalid port %s', (port) => {
    expect(() => loadFactoryContext(baseEnv({ FACTORY_SERVER_PORT: port }))).toThrow(
      FactoryContextError,
    );
  });
});
