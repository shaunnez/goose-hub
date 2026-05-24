import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventStore } from '../../event-stream/store.js';
import {
  DEFAULT_STDERR_LIMIT_BYTES,
  DEFAULT_STDOUT_LIMIT_BYTES,
  minimalEnv,
  runCommand,
} from './command-policy.js';
import type { FactoryContext } from './context.js';
import { FactoryContextError, loadFactoryContext } from './context.js';
import { PathPolicyViolation, resolveWorkspacePath } from './path-policy.js';
import { buildFactoryMcpServer } from './server.js';
import {
  listDirTool,
  listFilesTool,
  readFileTool,
  readManyFilesTool,
  searchTextTool,
} from './tools/read.js';
import { writeFileTool } from './tools/write.js';

let workspace: string;
let duplicateNudgeThresholdEnv: string | undefined;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'factory-mcp-'));
  duplicateNudgeThresholdEnv = process.env.FACTORY_DUPLICATE_NUDGE_THRESHOLD;
  process.env.FACTORY_DUPLICATE_NUDGE_THRESHOLD = undefined;
});

afterEach(() => {
  if (duplicateNudgeThresholdEnv == null) process.env.FACTORY_DUPLICATE_NUDGE_THRESHOLD = undefined;
  else process.env.FACTORY_DUPLICATE_NUDGE_THRESHOLD = duplicateNudgeThresholdEnv;
  rmSync(workspace, { recursive: true, force: true });
});

function makeCtx(overrides: Partial<FactoryContext> = {}): FactoryContext {
  return {
    runId: `run-${Math.random().toString(36).slice(2, 12)}`,
    projectId: 'demo',
    workItemId: 'github:demo/repo#1',
    workspaceRoot: workspace,
    serverPort: 3001,
    ...overrides,
  };
}

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

describe('server resources', () => {
  it('registers workspace-files template and returns empty list for an empty workspace', async () => {
    const server = buildFactoryMcpServer({
      runId: 'run-1',
      projectId: 'demo',
      workItemId: '',
      workspaceRoot: workspace,
      serverPort: 3001,
    });

    const internals = server as unknown as {
      _resourceHandlersInitialized?: boolean;
      _registeredResources?: Record<string, unknown>;
      _registeredResourceTemplates?: Record<string, unknown>;
      server?: {
        _requestHandlers?: Map<
          string,
          (request: Record<string, unknown>, extra: Record<string, unknown>) => unknown
        >;
      };
    };

    // With low-level setRequestHandler registration, the SDK's high-level resource bookkeeping
    // (_resourceHandlersInitialized, _registeredResourceTemplates) is not used. Verify that
    // the handlers are registered directly on server.server._requestHandlers instead.
    expect(internals.server?._requestHandlers?.has('resources/list')).toBe(true);
    expect(internals.server?._requestHandlers?.has('resources/read')).toBe(true);
    expect(internals.server?._requestHandlers?.has('resources/templates/list')).toBe(true);

    const listResult = await internals.server?._requestHandlers?.get('resources/list')?.(
      { method: 'resources/list', params: {} },
      {},
    );
    expect((listResult as { resources: unknown[] }).resources).toEqual([]);

    const templatesResult = await internals.server?._requestHandlers?.get(
      'resources/templates/list',
    )?.({ method: 'resources/templates/list', params: {} }, {});
    expect(
      (templatesResult as { resourceTemplates: Array<{ name: string; uriTemplate: string }> })
        .resourceTemplates,
    ).toEqual([
      expect.objectContaining({ name: 'workspace-files', uriTemplate: 'factory://{+path}' }),
    ]);
  });
});

describe('per-run read cache', () => {
  it('returns identical read_file bytes with cached=true on the second call', async () => {
    const ctx = makeCtx();
    writeFileSync(join(workspace, 'README.md'), '# Demo\n\nhello world\n');

    const first = await readFileTool(ctx, { path: 'README.md' });
    const second = await readFileTool(ctx, { path: './README.md' });

    expect(second).toEqual({ ...first, cached: true });
    const readEvents = eventStore
      .replay({ runId: ctx.runId, kind: 'agent.tool-call' })
      .filter((event) => (event.payload as { tool_name?: string }).tool_name === 'read_file');
    expect(readEvents).toHaveLength(2);
    expect(readEvents[0].payload).not.toMatchObject({ cached: true });
    expect(readEvents[1].payload).toMatchObject({ cached: true });
  });

  it('caches read_many_files, list_dir, list_files, and search_text within one run', async () => {
    const ctx = makeCtx();
    mkdirSync(join(workspace, 'src'));
    writeFileSync(join(workspace, 'README.md'), '# Demo\n');
    writeFileSync(join(workspace, 'src', 'index.ts'), 'export const NEEDLE = 1;\n');

    await readManyFilesTool(ctx, { paths: ['README.md', 'src/index.ts'] });
    await listDirTool(ctx, { path: 'src' });
    await listFilesTool(ctx, { path: 'src', glob: '*.ts' });
    await searchTextTool(ctx, { query: 'NEEDLE', path: 'src' });

    expect(
      await readManyFilesTool(ctx, { paths: ['./README.md', './src/index.ts'] }),
    ).toMatchObject({ cached: true });
    expect(await listDirTool(ctx, { path: './src' })).toMatchObject({ cached: true });
    expect(await listFilesTool(ctx, { path: './src', glob: '*.ts' })).toMatchObject({
      cached: true,
    });
    expect(await searchTextTool(ctx, { query: 'NEEDLE', path: './src' })).toMatchObject({
      cached: true,
    });
  });

  it('invalidates overlapping entries after a write before re-reading', async () => {
    const ctx = makeCtx();
    writeFileSync(join(workspace, 'a.txt'), 'old\n');

    await readFileTool(ctx, { path: 'a.txt' });
    await writeFileTool(ctx, { path: 'a.txt', content: 'new\n' });
    const reread = await readFileTool(ctx, { path: 'a.txt' });

    expect(reread.content).toBe('new\n');
    expect(reread).not.toHaveProperty('cached');
    expect(readFileSync(join(workspace, 'a.txt'), 'utf8')).toBe('new\n');
  });

  it('does not share cached reads across different run ids', async () => {
    writeFileSync(join(workspace, 'a.txt'), 'run one\n');
    const firstRun = makeCtx({ runId: 'cache-run-one' });
    const secondRun = makeCtx({ runId: 'cache-run-two' });

    await readFileTool(firstRun, { path: 'a.txt' });
    writeFileSync(join(workspace, 'a.txt'), 'run two\n');
    const second = await readFileTool(secondRun, { path: 'a.txt' });

    expect(second.content).toBe('run two\n');
    expect(second).not.toHaveProperty('cached');
  });

  it('evicts a run cache when the run completes', async () => {
    const ctx = makeCtx({ runId: 'cache-run-evict' });
    writeFileSync(join(workspace, 'a.txt'), 'before\n');

    await readFileTool(ctx, { path: 'a.txt' });
    eventStore.appendEvent({
      projectId: ctx.projectId,
      workItemId: ctx.workItemId,
      runId: ctx.runId,
      kind: 'agent.run-completed',
      payload: {},
    });
    writeFileSync(join(workspace, 'a.txt'), 'after\n');
    const reread = await readFileTool(ctx, { path: 'a.txt' });

    expect(reread.content).toBe('after\n');
    expect(reread).not.toHaveProperty('cached');
  });

  it('caches a 200KB read payload and serves the second hit from memory', async () => {
    const ctx = makeCtx();
    mkdirSync(join(workspace, 'large'));
    writeFileSync(join(workspace, 'large', 'payload.txt'), 'x'.repeat(200 * 1024));

    const first = await readFileTool(ctx, { path: 'large/payload.txt' });
    const start = performance.now();
    const second = await readFileTool(ctx, { path: 'large/payload.txt' });
    const elapsedMs = performance.now() - start;

    expect(first.content).toHaveLength(200 * 1024);
    expect(second).toEqual({ ...first, cached: true });
    expect(elapsedMs).toBeLessThan(10);
  });

  it('nudges once after the third identical cached tool call and emits duplicate telemetry', async () => {
    const ctx = makeCtx();
    writeFileSync(join(workspace, 'README.md'), '# Demo\n');

    const first = await readFileTool(ctx, { path: 'README.md' });
    const second = await readFileTool(ctx, { path: 'README.md' });
    const third = await readFileTool(ctx, { path: 'README.md' });
    const fourth = await readFileTool(ctx, { path: 'README.md' });

    expect(first).not.toHaveProperty('duplicateNudge');
    expect(second).not.toHaveProperty('duplicateNudge');
    expect(third.duplicateNudge).toBe(
      '[harness] You have invoked this tool with identical args 3 times this run. The cached result was returned. If you need different information, change your query.',
    );
    expect(fourth).not.toHaveProperty('duplicateNudge');
    const readEvents = eventStore
      .replay({ runId: ctx.runId, kind: 'agent.tool-call' })
      .filter((event) => (event.payload as { tool_name?: string }).tool_name === 'read_file');
    expect(
      readEvents.map((event) => (event.payload as { duplicateCount?: number }).duplicateCount),
    ).toEqual([undefined, 2, 3, 4]);
  });

  it('honours FACTORY_DUPLICATE_NUDGE_THRESHOLD without blocking duplicate calls', async () => {
    process.env.FACTORY_DUPLICATE_NUDGE_THRESHOLD = '2';
    const ctx = makeCtx();
    writeFileSync(join(workspace, 'README.md'), '# Demo\n');

    const first = await readFileTool(ctx, { path: 'README.md' });
    const second = await readFileTool(ctx, { path: 'README.md' });
    const third = await readFileTool(ctx, { path: 'README.md' });

    expect(first).not.toHaveProperty('duplicateNudge');
    expect(second.duplicateNudge).toContain('identical args 2 times this run');
    expect(third.content).toBe('# Demo\n');
    expect(third).not.toHaveProperty('duplicateNudge');
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
    expect(ctx.skill).toBeNull();
    expect(ctx.workspaceRoot).toBe(workspace);
    expect(ctx.serverPort).toBe(3001);
  });

  it('loads optional skill attribution when present', () => {
    const ctx = loadFactoryContext(baseEnv({ FACTORY_SKILL: 'investigate' }));
    expect(ctx.skill).toBe('investigate');
  });

  it('loads optional persona attribution when present', () => {
    const ctx = loadFactoryContext(baseEnv({ FACTORY_PERSONA_ID: 'proj-1/developer/0' }));
    expect(ctx.personaId).toBe('proj-1/developer/0');
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
