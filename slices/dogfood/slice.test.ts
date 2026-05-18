import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { describeCompletion, newRun, newRunId } from './outcome.js';
import { applySeed, restoreSeed, statusAll } from './runner.js';
import { RunsStore, aggregate } from './runs-store.js';
import { getSeed, listSeeds } from './seeds/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    expect(before.find((r) => r.id === 'logger-001-drop-meta')?.state).toBe('clean');

    await applySeed('logger-001-drop-meta', { repoRoot: tmpRoot });

    const after = await statusAll({ repoRoot: tmpRoot });
    expect(after.find((r) => r.id === 'logger-001-drop-meta')?.state).toBe('applied');
  });

  it('statusAll surfaces isApplied errors as `unknown` instead of swallowing them', async () => {
    await fs.rm(path.join(tmpRoot, 'apps/web/src/lib/logger.ts'));

    const rows = await statusAll({ repoRoot: tmpRoot });
    const row = rows.find((r) => r.id === 'logger-001-drop-meta');
    expect(row?.state).toBe('unknown');
    expect(row?.error).toBeDefined();
    expect(row?.error).toMatch(/ENOENT|no such file/i);
  });

  it('seed labels include factory:triaging so the workflow entrypoint fires', () => {
    const seed = getSeed('logger-001-drop-meta');
    expect(seed.issue.labels).toContain('factory:triaging');
    expect(seed.issue.labels).toContain('type:bug');
  });

  it('seed issue body does not leak the failing test file or source path', () => {
    const seed = getSeed('logger-001-drop-meta');
    expect(seed.issue.body).not.toContain('logger.test.ts');
    expect(seed.issue.body).not.toContain('apps/web/src/lib/logger.ts');
  });
});

// ---------------------------------------------------------------------------
// Cross-seed invariants — every registered seed must satisfy these properties.
// Cheaper than duplicating apply/restore tests per seed; catches regressions
// when a new seed is registered without proper hygiene.
// ---------------------------------------------------------------------------

describe('every registered seed', () => {
  for (const seed of listSeeds()) {
    describe(seed.id, () => {
      it('has a factory:triaging label so dispatch fires when the issue is filed', () => {
        expect(seed.issue.labels).toContain('factory:triaging');
      });

      it('has a type:bug or type:chore or type:feature label', () => {
        const typeLabels = seed.issue.labels.filter((l) => l.startsWith('type:'));
        expect(typeLabels.length).toBeGreaterThan(0);
      });

      it('has a priority label', () => {
        const priorityLabels = seed.issue.labels.filter((l) => l.startsWith('priority:'));
        expect(priorityLabels.length).toBe(1);
      });

      it('issue body does not name the truth-signal test file', () => {
        const testFileBasename = seed.truthSignal.testFile.split('/').pop() ?? '';
        expect(seed.issue.body).not.toContain(testFileBasename);
        expect(seed.issue.body).not.toContain(seed.truthSignal.testFile);
      });

      it('issue body does not contain `.test.` or `.spec.` (test-file leak signal)', () => {
        expect(seed.issue.body).not.toMatch(/\.test\./);
        expect(seed.issue.body).not.toMatch(/\.spec\./);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Apply/restore round-trip against the real source files in this repo.
// Resilient to source drift: copies the real file into a tmpdir, exercises the
// seed there, and asserts the file returns byte-identical after restore. If
// the ORIGINAL_BLOCK no longer matches the real file, the seed's own drift
// detection fires here — exactly the signal we want before a dogfood run.
// ---------------------------------------------------------------------------

describe('apply/restore round-trip against real source files', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dogfood-real-src-'));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  for (const seed of listSeeds()) {
    it(`${seed.id}: apply → mutate → restore returns the file byte-identical`, async () => {
      // Identify the source file the seed targets by parsing the error from a
      // would-be-apply against an empty tmpdir. Simpler: rely on truthSignal
      // pointing at the test file, and infer the matching source file by
      // convention is brittle, so instead each seed throws a drift error that
      // names the target — we just exercise apply() which reads from disk.
      // Copy the seed's target path (a known repo-relative path) by trying to
      // apply; if the target is missing in tmpdir, the seed reports drift.
      // We approximate by mirroring known source paths from seed metadata.

      // Convention: seeds target source files; copy by walking known targets.
      // For this round-trip test we just copy the parent dir of the target.
      // Resolve via a small helper that knows each seed's target.
      const targetByID: Record<string, string> = {
        'logger-001-drop-meta': 'apps/web/src/lib/logger.ts',
        'frontend-002-truncate-boundary': 'apps/web/src/lib/utils.ts',
        'backend-001-budget-threshold': 'apps/server/src/shared/budget.ts',
      };
      const targetRel = targetByID[seed.id];
      if (!targetRel) {
        throw new Error(
          `Round-trip test does not know the target file for seed ${seed.id}. Update targetByID.`,
        );
      }

      const srcAbs = path.join(repoRoot, targetRel);
      const dstAbs = path.join(tmpRoot, targetRel);
      await fs.mkdir(path.dirname(dstAbs), { recursive: true });
      const originalContents = await fs.readFile(srcAbs, 'utf8');
      await fs.writeFile(dstAbs, originalContents, 'utf8');

      expect(await seed.isApplied(tmpRoot)).toBe(false);

      await seed.apply(tmpRoot);
      const mutated = await fs.readFile(dstAbs, 'utf8');
      expect(mutated).not.toBe(originalContents);
      expect(await seed.isApplied(tmpRoot)).toBe(true);

      await seed.restore(tmpRoot);
      const restored = await fs.readFile(dstAbs, 'utf8');
      expect(restored).toBe(originalContents);
      expect(await seed.isApplied(tmpRoot)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// Outcome tracking — runs-store + aggregate.
// ---------------------------------------------------------------------------

describe('runs store', () => {
  let storeDir: string;
  let store: RunsStore;

  beforeEach(async () => {
    storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dogfood-runs-'));
    store = new RunsStore({ dir: storeDir });
  });

  afterEach(async () => {
    await fs.rm(storeDir, { recursive: true, force: true });
  });

  it('newRunId yields unique ids on consecutive calls', () => {
    const ids = new Set([newRunId(), newRunId(), newRunId(), newRunId()]);
    expect(ids.size).toBe(4);
  });

  it('append + list round-trips a single row', async () => {
    const run = newRun('seed-a', 'bug');
    await store.append(run);
    const rows = await store.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].runId).toBe(run.runId);
    expect(rows[0].seedId).toBe('seed-a');
    expect(rows[0].completion).toBe('pending');
  });

  it('returns [] when the store file does not yet exist', async () => {
    const rows = await store.list();
    expect(rows).toEqual([]);
  });

  it('refuses to append a duplicate runId', async () => {
    const run = newRun('seed-a', 'bug');
    await store.append(run);
    await expect(store.append(run)).rejects.toThrowError(/already exists/);
  });

  it('update patches fields and preserves runId + startedAt', async () => {
    const run = newRun('seed-a', 'bug');
    await store.append(run);
    const updated = await store.update(run.runId, {
      completion: 'reached-terminal',
      truthPass: true,
    });
    expect(updated.runId).toBe(run.runId);
    expect(updated.startedAt).toBe(run.startedAt);
    expect(updated.completion).toBe('reached-terminal');
    expect(updated.truthPass).toBe(true);
  });

  it('update throws on unknown runId', async () => {
    await expect(store.update('nope', { truthPass: false })).rejects.toThrowError(/not found/);
  });

  it('listRecent returns most-recent-first', async () => {
    const r1 = newRun('a', 'bug');
    const r2 = newRun('b', 'bug');
    const r3 = newRun('c', 'bug');
    await store.append(r1);
    await store.append(r2);
    await store.append(r3);
    const recent = await store.listRecent();
    expect(recent.map((r) => r.runId)).toEqual([r3.runId, r2.runId, r1.runId]);
  });

  it('describeCompletion handles both string and failed shapes', () => {
    expect(describeCompletion('reached-terminal')).toBe('reached-terminal');
    expect(describeCompletion({ failed: { node: 'qa' } })).toMatch(/failed at qa/);
    expect(describeCompletion({ failed: { node: 'qa', reason: 'playwright crashed' } })).toMatch(
      /failed at qa: playwright crashed/,
    );
  });

  it('aggregate computes counts and rates correctly', async () => {
    const r1 = newRun('seed-a', 'bug');
    const r2 = newRun('seed-a', 'bug');
    const r3 = newRun('seed-b', 'bug');
    await store.append(r1);
    await store.append(r2);
    await store.append(r3);
    await store.update(r1.runId, {
      completion: 'reached-terminal',
      truthPass: true,
      qaCorrect: true,
    });
    await store.update(r2.runId, {
      completion: { failed: { node: 'qa' } },
      truthPass: false,
      qaCorrect: false,
    });
    await store.update(r3.runId, { completion: 'reached-terminal', truthPass: true });

    const stats = aggregate(await store.list());
    expect(stats.total).toBe(3);
    expect(stats.reachedTerminal).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.pending).toBe(0);
    expect(stats.truthPassRate).toBeCloseTo(2 / 3);
    expect(stats.qaCorrectRate).toBeCloseTo(0.5);
    expect(stats.bySeed['seed-a'].total).toBe(2);
    expect(stats.bySeed['seed-a'].reachedTerminal).toBe(1);
    expect(stats.bySeed['seed-a'].truthPassCount).toBe(1);
  });
});
