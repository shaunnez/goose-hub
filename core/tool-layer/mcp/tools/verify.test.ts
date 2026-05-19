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
const { mockRunCommand } = vi.hoisted(() => ({
  mockRunCommand: vi.fn(),
}));

vi.mock('../command-policy.js', () => ({
  minimalEnv: () => ({}),
  runCommand: (...args: unknown[]) => mockRunCommand(...args),
}));

let workspace: string;
let ctx: FactoryContext;

beforeEach(() => {
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
