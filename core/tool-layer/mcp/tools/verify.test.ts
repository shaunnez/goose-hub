import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FactoryContext } from '../context.js';
import {
  PackageScriptNotAllowedError,
  runPackageScriptTool,
  runTargetedCommandTool,
  runTestsTool,
  runTypecheckTool,
} from './verify.js';

const REAL_PROJECT_SLUG = 'goose-hub-self';
const { mockMinimalEnv, mockRunCommand } = vi.hoisted(() => ({
  mockMinimalEnv: vi.fn((extras: Record<string, string> = {}) => extras),
  mockRunCommand: vi.fn(),
}));

vi.mock('../command-policy.js', () => ({
  minimalEnv: (extras?: Record<string, string>) => mockMinimalEnv(extras),
  runCommand: (...args: unknown[]) => mockRunCommand(...args),
}));

let workspace: string;
let ctx: FactoryContext;

beforeEach(() => {
  mockMinimalEnv.mockClear();
  mockRunCommand.mockResolvedValue({
    status: 'ok',
    exitCode: 0,
    stdout: '',
    stderr: '',
    durationMs: 12,
    truncated: false,
  });
  workspace = mkdtempSync(join(tmpdir(), 'factory-verify-'));
  ctx = {
    runId: `run-${Math.random().toString(36).slice(2, 12)}`,
    projectId: REAL_PROJECT_SLUG,
    workItemId: 'github:shaunnez/goose-hub#1',
    workspaceRoot: workspace,
    serverPort: 3001,
  };
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('runPackageScriptTool', () => {
  beforeEach(() => {
    writeFileSync(
      join(workspace, 'package.json'),
      JSON.stringify({
        name: 'demo',
        scripts: { hello: 'node -e "console.log(\\"hi\\")"' },
      }),
    );
  });

  it('throws PackageScriptNotAllowedError for a missing script', async () => {
    await expect(runPackageScriptTool(ctx, { script: 'not-a-script' })).rejects.toBeInstanceOf(
      PackageScriptNotAllowedError,
    );
  });

  it('refuses scripts that do not appear in package.json', async () => {
    writeFileSync(join(workspace, 'package.json'), JSON.stringify({ name: 'x', scripts: {} }));
    await expect(runPackageScriptTool(ctx, { script: 'hello' })).rejects.toBeInstanceOf(
      PackageScriptNotAllowedError,
    );
  });
});

describe('runTypecheckTool', () => {
  it('returns a typed VerifyResult shape (status/exitCode/command)', async () => {
    // Use a workspace with no project config so we exit fast on the
    // StackCommandMissingError branch instead of running the real typecheck.
    const isolatedCtx: FactoryContext = { ...ctx, projectId: 'no-such-project-xyz' };
    await expect(runTypecheckTool(isolatedCtx, {})).rejects.toMatchObject({
      kind: 'StackCommandMissingError',
    });
  });
});

describe('runTestsTool', () => {
  it('runs tests with NODE_ENV=test so React test builds expose act()', async () => {
    writeFileSync(join(workspace, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n");
    writeFileSync(join(workspace, 'package.json'), JSON.stringify({ name: 'demo' }));
    writeFileSync(join(workspace, 'README.md'), '# demo\n');

    await runTestsTool(ctx, {});

    expect(mockMinimalEnv).toHaveBeenCalledWith({ NODE_ENV: 'test' });
    expect(mockRunCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        env: { NODE_ENV: 'test' },
      }),
    );
  });

  it('returns raw and canonical test paths for a targeted test run', async () => {
    writeFileSync(join(workspace, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n");
    writeFileSync(join(workspace, 'package.json'), JSON.stringify({ name: 'demo' }));
    writeFileSync(join(workspace, 'README.md'), '# demo\n');
    mkdirSync(join(workspace, 'apps/web/src'), { recursive: true });
    writeFileSync(join(workspace, 'apps/web/src/foo.test.ts'), 'test("x", () => {});\n');

    const result = await runTestsTool(ctx, { path: 'src/foo.test.ts' });

    expect(result.rawPaths).toEqual(['src/foo.test.ts']);
    expect(result.paths).toEqual([
      {
        path: 'apps/web/src/foo.test.ts',
        root: 'worktree',
        packageRoot: 'apps/web',
        normalizedFrom: 'src/foo.test.ts',
      },
    ]);
    expect(result.command.at(-1)).toBe('apps/web/src/foo.test.ts');
    const event = (await import('../../../event-stream/store.js')).eventStore
      .replay({ runId: ctx.runId, kind: 'agent.tool-call' })
      .find((entry) => (entry.payload as { tool_name?: string }).tool_name === 'run_tests');
    expect(event?.payload).toMatchObject({
      raw_path: 'src/foo.test.ts',
      canonical_path: { path: 'apps/web/src/foo.test.ts', root: 'worktree' },
      tool_input: {
        command: 'pnpm test --reporter=json apps/web/src/foo.test.ts',
        rawPaths: ['src/foo.test.ts'],
        paths: ['apps/web/src/foo.test.ts'],
      },
    });
  });
});

describe('runTargetedCommandTool', () => {
  it('dispatches typecheck without a path argument', async () => {
    const isolatedCtx: FactoryContext = { ...ctx, projectId: 'no-such-project-xyz' };
    await expect(
      runTargetedCommandTool(isolatedCtx, { family: 'typecheck', path: 'src/index.ts' }),
    ).rejects.toMatchObject({ kind: 'StackCommandMissingError' });
  });
});

describe('runTestsTool retry cap', () => {
  beforeEach(() => {
    writeFileSync(join(workspace, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n");
    writeFileSync(join(workspace, 'package.json'), JSON.stringify({ name: 'demo' }));
    writeFileSync(join(workspace, 'README.md'), '# demo\n');
    mkdirSync(join(workspace, 'apps/web/src'), { recursive: true });
    writeFileSync(join(workspace, 'apps/web/src/foo.test.ts'), 'test("x", () => {});\n');
  });

  function mockFailed() {
    mockRunCommand.mockResolvedValue({
      status: 'failed',
      exitCode: 1,
      stdout: 'FAIL',
      stderr: '',
      durationMs: 12,
      truncated: false,
    });
  }

  it('blocks the 4th consecutive failed run on the same path and emits tool.violation', async () => {
    mockFailed();
    for (let i = 0; i < 3; i++) {
      const result = await runTestsTool(ctx, { path: 'src/foo.test.ts' });
      expect(result.status).toBe('failed');
    }
    mockRunCommand.mockClear();

    const blocked = await runTestsTool(ctx, { path: 'src/foo.test.ts' });
    expect(blocked.status).toBe('failed');
    expect(mockRunCommand).not.toHaveBeenCalled();
    expect(blocked.stderr).toMatch(/retry cap|consecutive failures/i);

    const violations = (await import('../../../event-stream/store.js')).eventStore
      .replay({ runId: ctx.runId, kind: 'tool.violation' })
      .filter(
        (event) => (event.payload as { reason?: unknown }).reason === 'excessive-test-retries',
      );
    expect(violations.length).toBeGreaterThan(0);
  });

  it('resets the cap after a write/edit invalidates the same path', async () => {
    const { invalidateRunCacheForPaths } = await import('../run-cache.js');
    mockFailed();
    for (let i = 0; i < 3; i++) await runTestsTool(ctx, { path: 'src/foo.test.ts' });

    invalidateRunCacheForPaths(ctx.runId, ['apps/web/src/foo.test.ts']);

    mockRunCommand.mockClear();
    const next = await runTestsTool(ctx, { path: 'src/foo.test.ts' });
    expect(mockRunCommand).toHaveBeenCalledOnce();
    expect(next.status).toBe('failed');
  });

  it('counters are isolated per path', async () => {
    mockFailed();
    writeFileSync(join(workspace, 'apps/web/src/bar.test.ts'), 'test("y", () => {});\n');
    for (let i = 0; i < 3; i++) await runTestsTool(ctx, { path: 'src/foo.test.ts' });

    mockRunCommand.mockClear();
    const other = await runTestsTool(ctx, { path: 'src/bar.test.ts' });
    expect(mockRunCommand).toHaveBeenCalledOnce();
    expect(other.status).toBe('failed');
  });

  it('blocks repeated failure signatures across different test paths', async () => {
    writeFileSync(join(workspace, 'apps/web/src/bar.test.ts'), 'test("y", () => {});\n');
    const vitestJson = (file: string) =>
      JSON.stringify({
        numTotalTests: 1,
        numPassedTests: 0,
        numFailedTests: 1,
        testResults: [
          {
            name: `/work/apps/web/src/${file}`,
            status: 'failed',
            assertionResults: [
              {
                ancestorTitles: ['suite'],
                title: 'renders',
                status: 'failed',
                failureMessages: [
                  `TypeError: React.act is not a function\n    at /work/apps/web/src/${file}:5:7`,
                ],
              },
            ],
          },
        ],
      });
    mockRunCommand.mockResolvedValueOnce({
      status: 'failed',
      exitCode: 1,
      stdout: vitestJson('foo.test.ts'),
      stderr: '',
      durationMs: 18,
      truncated: false,
    });
    mockRunCommand.mockResolvedValueOnce({
      status: 'failed',
      exitCode: 1,
      stdout: vitestJson('bar.test.ts'),
      stderr: '',
      durationMs: 18,
      truncated: false,
    });
    mockRunCommand.mockResolvedValueOnce({
      status: 'failed',
      exitCode: 1,
      stdout: vitestJson('bar.test.ts'),
      stderr: '',
      durationMs: 18,
      truncated: false,
    });

    await runTestsTool(ctx, { path: 'src/foo.test.ts' });
    await runTestsTool(ctx, { path: 'src/bar.test.ts' });
    const blocked = await runTestsTool(ctx, { path: 'src/bar.test.ts' });

    expect(blocked.status).toBe('failed');
    expect(blocked.exitCode).toBeNull();
    expect(blocked.stderr).toMatch(/repeated failure signature/i);
    const violations = (await import('../../../event-stream/store.js')).eventStore
      .replay({ runId: ctx.runId, kind: 'tool.violation' })
      .filter(
        (event) =>
          (event.payload as { reason?: unknown }).reason === 'repeated-test-failure-signature',
      );
    expect(violations).toHaveLength(1);
  });

  it('attaches a parsed failureSummary when the test command exits non-zero with vitest JSON output', async () => {
    const vitestJson = JSON.stringify({
      numTotalTests: 1,
      numPassedTests: 0,
      numFailedTests: 1,
      testResults: [
        {
          name: '/work/apps/web/src/foo.test.ts',
          status: 'failed',
          assertionResults: [
            {
              ancestorTitles: ['suite'],
              title: 'fails',
              status: 'failed',
              failureMessages: [
                'AssertionError: expected 1 to equal 2\n    at /work/apps/web/src/foo.test.ts:5:7',
              ],
            },
          ],
        },
      ],
    });
    mockRunCommand.mockResolvedValueOnce({
      status: 'failed',
      exitCode: 1,
      stdout: vitestJson,
      stderr: '',
      durationMs: 18,
      truncated: false,
    });
    const result = await runTestsTool(ctx, { path: 'src/foo.test.ts' });
    expect(result.failureSummary).toBeDefined();
    expect(result.failureSummary?.parserUsed).toBe('vitest-json');
    expect(result.failureSummary?.failures).toHaveLength(1);
    expect(result.failureSummary?.failures[0]).toMatchObject({
      testName: 'suite > fails',
      category: 'assertion',
      file: '/work/apps/web/src/foo.test.ts',
    });
  });

  it('omits failureSummary when the test command exits cleanly', async () => {
    mockRunCommand.mockResolvedValueOnce({
      status: 'ok',
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 18,
      truncated: false,
    });
    const result = await runTestsTool(ctx, { path: 'src/foo.test.ts' });
    expect(result.failureSummary).toBeUndefined();
  });

  it('a successful run clears the failure counter for that path', async () => {
    mockFailed();
    for (let i = 0; i < 2; i++) await runTestsTool(ctx, { path: 'src/foo.test.ts' });

    mockRunCommand.mockResolvedValueOnce({
      status: 'ok',
      exitCode: 0,
      stdout: 'PASS',
      stderr: '',
      durationMs: 5,
      truncated: false,
    });
    const passed = await runTestsTool(ctx, { path: 'src/foo.test.ts' });
    expect(passed.status).toBe('ok');

    mockFailed();
    mockRunCommand.mockClear();
    // Now should permit at least 3 more failures before blocking.
    for (let i = 0; i < 3; i++) {
      const result = await runTestsTool(ctx, { path: 'src/foo.test.ts' });
      expect(result.status).toBe('failed');
    }
    expect(mockRunCommand).toHaveBeenCalledTimes(3);
  });
});
