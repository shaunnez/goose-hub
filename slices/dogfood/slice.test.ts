import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applySeed, restoreSeed, statusAll } from './runner.js';
import { getSeed, listSeeds } from './seeds/index.js';

const ORIGINAL_LOGGER_SRC = `type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const prefix = \`[goose-hub:\${level}]\`;
  if (meta != null) {
    console[level === 'debug' ? 'log' : level](prefix, message, meta);
  } else {
    console[level === 'debug' ? 'log' : level](prefix, message);
  }
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => log('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta),
};
`;

describe('dogfood slice', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dogfood-test-'));
    const loggerDir = path.join(tmpRoot, 'apps', 'web', 'src', 'lib');
    await fs.mkdir(loggerDir, { recursive: true });
    await fs.writeFile(path.join(loggerDir, 'logger.ts'), ORIGINAL_LOGGER_SRC, 'utf8');
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('lists registered seeds', () => {
    const seeds = listSeeds();
    expect(seeds.length).toBeGreaterThan(0);
    const found = seeds.find((s) => s.id === 'logger-001-drop-meta');
    expect(found).toBeDefined();
    expect(found?.truthSignal.testFile).toBe('apps/web/src/lib/logger.test.ts');
  });

  it('getSeed throws on unknown id', () => {
    expect(() => getSeed('nope-not-real')).toThrowError(/Unknown seed/);
  });

  it('apply mutates the target file and is detected by isApplied', async () => {
    const before = await fs.readFile(path.join(tmpRoot, 'apps/web/src/lib/logger.ts'), 'utf8');
    expect(before).toContain('if (meta != null)');

    const seed = await applySeed('logger-001-drop-meta', { repoRoot: tmpRoot });
    expect(seed.id).toBe('logger-001-drop-meta');

    const after = await fs.readFile(path.join(tmpRoot, 'apps/web/src/lib/logger.ts'), 'utf8');
    expect(after).not.toContain('if (meta != null)');
    expect(after).toContain("console[level === 'debug' ? 'log' : level](prefix, message);");

    expect(await seed.isApplied(tmpRoot)).toBe(true);
  });

  it('restore returns the file to its original state', async () => {
    await applySeed('logger-001-drop-meta', { repoRoot: tmpRoot });
    await restoreSeed('logger-001-drop-meta', { repoRoot: tmpRoot });

    const restored = await fs.readFile(path.join(tmpRoot, 'apps/web/src/lib/logger.ts'), 'utf8');
    expect(restored).toBe(ORIGINAL_LOGGER_SRC);

    const seed = getSeed('logger-001-drop-meta');
    expect(await seed.isApplied(tmpRoot)).toBe(false);
  });

  it('apply refuses to run twice without restore', async () => {
    await applySeed('logger-001-drop-meta', { repoRoot: tmpRoot });
    await expect(applySeed('logger-001-drop-meta', { repoRoot: tmpRoot })).rejects.toThrowError(
      /already applied/,
    );
  });

  it('apply fails loudly when the target file has drifted', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'apps/web/src/lib/logger.ts'),
      '// totally different file\nexport const logger = {};\n',
      'utf8',
    );
    await expect(applySeed('logger-001-drop-meta', { repoRoot: tmpRoot })).rejects.toThrowError(
      /drifted/,
    );
  });

  it('restore is idempotent when nothing was applied', async () => {
    await expect(restoreSeed('logger-001-drop-meta', { repoRoot: tmpRoot })).resolves.toBeDefined();
  });

  it('statusAll reports applied vs clean accurately', async () => {
    const before = await statusAll({ repoRoot: tmpRoot });
    expect(before.find((r) => r.id === 'logger-001-drop-meta')?.applied).toBe(false);

    await applySeed('logger-001-drop-meta', { repoRoot: tmpRoot });

    const after = await statusAll({ repoRoot: tmpRoot });
    expect(after.find((r) => r.id === 'logger-001-drop-meta')?.applied).toBe(true);
  });
});
