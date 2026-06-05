import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stackCommandsForWorktree } from './stack-commands.js';

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'stack-commands-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

describe('selected repo stack commands', () => {
  it('derives commands from the selected npm repo instead of broad project pnpm defaults', async () => {
    const dir = repo({
      'package.json': JSON.stringify({
        scripts: {
          test: 'jest',
          lint: 'eslint .',
        },
      }),
      'package-lock.json': '{}',
    });

    await expect(
      stackCommandsForWorktree(dir, {
        runtime: 'node',
        packageManager: 'pnpm',
        testCommand: 'pnpm --filter broad-project test',
        lintCommand: 'pnpm biome check .',
        typecheckCommand: 'pnpm typecheck',
        e2eCommand: 'pnpm test:e2e',
        detectedAt: '2026-06-05T00:00:00.000Z',
      }),
    ).resolves.toMatchObject({
      runtime: 'node',
      packageManager: 'npm',
      installCommand: ['npm', 'ci'],
      testCommand: 'npm test',
      lintCommand: 'npm run lint',
      typecheckCommand: 'pnpm typecheck',
      e2eCommand: 'pnpm test:e2e',
    });
  });

  it('preserves configured commands when the selected repo omits matching scripts', async () => {
    const dir = repo({
      'package.json': JSON.stringify({
        scripts: {
          test: 'vitest',
          'test:e2e:pipeline': 'playwright test',
        },
      }),
      'pnpm-lock.yaml': 'lockfileVersion: 9\n',
    });

    await expect(
      stackCommandsForWorktree(dir, {
        runtime: 'node',
        packageManager: 'pnpm',
        testCommand: 'pnpm test --reporter=json',
        lintCommand: 'pnpm lint',
        typecheckCommand: 'pnpm typecheck',
        e2eCommand: 'pnpm test:e2e:pipeline',
        detectedAt: '2026-06-05T00:00:00.000Z',
      }),
    ).resolves.toMatchObject({
      runtime: 'node',
      packageManager: 'pnpm',
      testCommand: 'pnpm test',
      lintCommand: 'pnpm lint',
      typecheckCommand: 'pnpm typecheck',
      e2eCommand: 'pnpm test:e2e:pipeline',
    });
  });

  it('only exposes optional commands when package scripts exist', async () => {
    const dir = repo({
      'package.json': JSON.stringify({
        scripts: {
          test: 'vitest',
        },
      }),
      'pnpm-lock.yaml': 'lockfileVersion: 9\n',
    });

    await expect(stackCommandsForWorktree(dir)).resolves.toEqual(
      expect.not.objectContaining({
        lintCommand: expect.any(String),
        typecheckCommand: expect.any(String),
        e2eCommand: expect.any(String),
      }),
    );
  });
});
