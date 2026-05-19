import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FactoryContext } from '../context.js';
import { PathPolicyViolation } from '../path-policy.js';
import {
  EvidenceConfigMissingError,
  SpecPathRejectedError,
  getAppUrlTool,
  runPlaywrightSpecTool,
  writePlaywrightSpecTool,
} from './evidence.js';

let workspace: string;
let ctx: FactoryContext;
const ORIG_APP_URL = process.env.FACTORY_APP_URL;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'factory-evidence-'));
  ctx = {
    runId: `run-${Math.random().toString(36).slice(2, 12)}`,
    projectId: 'no-such-project-zzz',
    workItemId: 'github:demo/repo#1',
    workspaceRoot: workspace,
    serverPort: 3001,
  };
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
  process.env.FACTORY_APP_URL = ORIG_APP_URL ?? '';
});

describe('getAppUrlTool', () => {
  it('returns unset when FACTORY_APP_URL is empty', () => {
    process.env.FACTORY_APP_URL = '';
    const result = getAppUrlTool(ctx);
    expect(result).toEqual({ url: null, source: 'unset' });
  });

  it('returns the env URL when set', () => {
    process.env.FACTORY_APP_URL = 'http://localhost:5173';
    const result = getAppUrlTool(ctx);
    expect(result).toEqual({ url: 'http://localhost:5173', source: 'env' });
  });
});

describe('writePlaywrightSpecTool', () => {
  it('rejects specs outside apps/web/e2e/', async () => {
    await expect(
      writePlaywrightSpecTool(ctx, {
        path: 'src/foo.spec.ts',
        content: 'export {};',
      }),
    ).rejects.toBeInstanceOf(SpecPathRejectedError);
  });

  it('rejects non-spec filenames inside apps/web/e2e/', async () => {
    await expect(
      writePlaywrightSpecTool(ctx, {
        path: 'apps/web/e2e/helper.ts',
        content: 'export {};',
      }),
    ).rejects.toBeInstanceOf(SpecPathRejectedError);
  });

  it('rejects assistant-home paths before the spec check', async () => {
    await expect(
      writePlaywrightSpecTool(ctx, {
        path: '.claude/foo.spec.ts',
        content: 'export {};',
      }),
    ).rejects.toBeInstanceOf(PathPolicyViolation);
  });
});

describe('runPlaywrightSpecTool', () => {
  it('rejects specs outside apps/web/e2e/', async () => {
    await expect(runPlaywrightSpecTool(ctx, { spec: 'src/foo.spec.ts' })).rejects.toBeInstanceOf(
      SpecPathRejectedError,
    );
  });

  it('throws EvidenceConfigMissingError when the project has no e2eCommand', async () => {
    await expect(
      runPlaywrightSpecTool(ctx, { spec: 'apps/web/e2e/foo.spec.ts' }),
    ).rejects.toBeInstanceOf(EvidenceConfigMissingError);
  });
});
