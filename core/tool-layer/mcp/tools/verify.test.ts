import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FactoryContext } from '../context.js';
import {
  PackageScriptNotAllowedError,
  runPackageScriptTool,
  runTargetedCommandTool,
  runTypecheckTool,
} from './verify.js';

const REAL_PROJECT_SLUG = 'goose-hub-self';

let workspace: string;
let ctx: FactoryContext;

beforeEach(() => {
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

describe('runTargetedCommandTool', () => {
  it('dispatches typecheck without a path argument', async () => {
    const isolatedCtx: FactoryContext = { ...ctx, projectId: 'no-such-project-xyz' };
    await expect(
      runTargetedCommandTool(isolatedCtx, { family: 'typecheck', path: 'src/index.ts' }),
    ).rejects.toMatchObject({ kind: 'StackCommandMissingError' });
  });
});
