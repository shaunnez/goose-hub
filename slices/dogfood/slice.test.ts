import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AgentEventDto,
  CHECKLISTS,
  TERMINAL_STATES,
  newProgress,
  observeEvent,
  renderChecklist,
} from './checklist.js';
import { parseSseBlock, tailEvents } from './event-tail.js';
import {
  type ExecFileFn,
  GhClient,
  GhNotAuthenticatedError,
  GhNotInstalledError,
  parseIssueCreateOutput,
} from './gh-issue.js';
import { describeCompletion, newRun, newRunId } from './outcome.js';
import { computeCompletion, runDogfood } from './run.js';
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
        'frontend-003-format-tokens-rounding': 'apps/web/src/lib/utils.ts',
        'backend-001-budget-threshold': 'apps/server/src/shared/budget.ts',
        'backend-002-qa-priority-mapping': 'core/findings/priority.ts',
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

// ---------------------------------------------------------------------------
// gh-issue — wrapper around `gh issue create`.
// ---------------------------------------------------------------------------

describe('parseIssueCreateOutput', () => {
  it('extracts the issue URL from a single-line gh stdout', () => {
    const out = parseIssueCreateOutput('https://github.com/shaunnez/goose-hub/issues/123\n', '');
    expect(out.url).toBe('https://github.com/shaunnez/goose-hub/issues/123');
    expect(out.number).toBe(123);
  });

  it('extracts the URL even when other lines precede it', () => {
    const out = parseIssueCreateOutput(
      'Creating issue in shaunnez/goose-hub\nhttps://github.com/shaunnez/goose-hub/issues/42\n',
      '',
    );
    expect(out.number).toBe(42);
  });

  it('throws on output with no URL', () => {
    expect(() => parseIssueCreateOutput('something went wrong\n', '')).toThrowError(
      /Could not find/,
    );
  });
});

describe('GhClient', () => {
  it('assertReady throws GhNotInstalledError when gh is missing', async () => {
    const exec: ExecFileFn = async () => {
      const err = new Error('not found') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    };
    const gh = new GhClient({ exec });
    await expect(gh.assertReady()).rejects.toBeInstanceOf(GhNotInstalledError);
  });

  it('assertReady throws GhNotAuthenticatedError when gh auth status fails', async () => {
    const exec: ExecFileFn = vi
      .fn()
      .mockResolvedValueOnce({ stdout: 'gh version 2.x', stderr: '' })
      .mockRejectedValueOnce(
        Object.assign(new Error('auth fail'), { stderr: 'You are not logged in' }),
      );
    const gh = new GhClient({ exec });
    await expect(gh.assertReady()).rejects.toBeInstanceOf(GhNotAuthenticatedError);
  });

  it('createIssue passes labels as separate --label args', async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const exec: ExecFileFn = async (file, args) => {
      calls.push({ file, args });
      return {
        stdout: 'https://github.com/shaunnez/goose-hub/issues/77\n',
        stderr: '',
      };
    };
    const gh = new GhClient({ exec });
    const issue = await gh.createIssue({
      repo: 'shaunnez/goose-hub',
      title: 'T',
      body: 'B',
      labels: ['type:bug', 'priority:medium', 'factory:triaging'],
    });
    expect(issue.number).toBe(77);
    expect(calls[0].args).toContain('--label');
    expect(calls[0].args.filter((a) => a === '--label')).toHaveLength(3);
    expect(calls[0].args).toContain('factory:triaging');
  });
});

// ---------------------------------------------------------------------------
// checklist — observeEvent / renderChecklist / terminal detection.
// ---------------------------------------------------------------------------

describe('checklist', () => {
  it('CHECKLISTS.bug ends at factory:done', () => {
    const last = CHECKLISTS.bug.at(-1);
    expect(last?.state).toBe('factory:done');
  });

  it('observeEvent ticks an item when a state-transition arrives', () => {
    const p = newProgress('bug');
    const advanced = observeEvent(p, {
      kind: 'state.transitioned',
      payload: { to: 'factory:investigating' },
    });
    expect(advanced).toBe(true);
    expect(p.ticked.has('factory:investigating')).toBe(true);
  });

  it('observeEvent records failed node on agent.run-failed', () => {
    const p = newProgress('bug');
    observeEvent(p, { kind: 'agent.run-failed', payload: { skill: 'qa' } });
    expect(p.failedNode).toBe('qa');
  });

  it('observeEvent marks terminalReached when transitioning to a terminal state', () => {
    const p = newProgress('bug');
    observeEvent(p, { kind: 'state.transitioned', payload: { to: 'factory:done' } });
    expect(p.terminalReached).toBe(true);
  });

  it('observeEvent ignores transitions not in the checklist', () => {
    const p = newProgress('bug');
    const advanced = observeEvent(p, {
      kind: 'state.transitioned',
      payload: { to: 'factory:not-a-real-state' },
    });
    expect(advanced).toBe(false);
    expect(p.ticked.size).toBe(0);
  });

  it('renderChecklist marks ticked items with [x]', () => {
    const p = newProgress('bug');
    observeEvent(p, { kind: 'state.transitioned', payload: { to: 'factory:investigating' } });
    const text = renderChecklist(p);
    expect(text).toContain('[x] Issue triaged');
    expect(text).toContain('[ ] Investigation complete');
  });

  it('TERMINAL_STATES contains factory:done and factory:needs-human', () => {
    expect(TERMINAL_STATES.has('factory:done')).toBe(true);
    expect(TERMINAL_STATES.has('factory:needs-human')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// event-tail — parseSseBlock + tailEvents with mock fetch.
// ---------------------------------------------------------------------------

describe('parseSseBlock', () => {
  it('parses a well-formed SSE block', () => {
    const block = 'id: 7\ndata: {"kind":"state.transitioned","payload":{"to":"factory:done"}}';
    const ev = parseSseBlock(block);
    expect(ev?.kind).toBe('state.transitioned');
    expect((ev?.payload as { to?: string }).to).toBe('factory:done');
  });

  it('returns undefined when no data line is present', () => {
    expect(parseSseBlock('id: 7')).toBeUndefined();
  });

  it('returns undefined when data is not JSON', () => {
    expect(parseSseBlock('data: not json')).toBeUndefined();
  });
});

function mockSseFetch(events: AgentEventDto[]): typeof fetch {
  return async () => {
    const body = events.map((e, i) => `id: ${i + 1}\ndata: ${JSON.stringify(e)}\n\n`).join('');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }) as unknown as Response;
  };
}

describe('tailEvents', () => {
  it('streams events until the server closes and returns them in order', async () => {
    const fakeEvents: AgentEventDto[] = [
      { kind: 'state.transitioned', payload: { to: 'factory:investigating' } },
      { kind: 'state.transitioned', payload: { to: 'factory:dev-ready' } },
    ];
    const collected: AgentEventDto[] = [];
    const result = await tailEvents(
      {
        serverUrl: 'http://example/',
        projectId: 'p',
        workItemId: 1,
        fetchImpl: mockSseFetch(fakeEvents),
      },
      (e) => {
        collected.push(e);
        return false;
      },
    );
    expect(result.reason).toBe('server-closed');
    expect(collected.map((e) => (e.payload as { to: string }).to)).toEqual([
      'factory:investigating',
      'factory:dev-ready',
    ]);
  });

  it('stops early when the callback returns true', async () => {
    const fakeEvents: AgentEventDto[] = [
      { kind: 'state.transitioned', payload: { to: 'factory:investigating' } },
      { kind: 'state.transitioned', payload: { to: 'factory:dev-ready' } },
      { kind: 'state.transitioned', payload: { to: 'factory:done' } },
    ];
    let seen = 0;
    const result = await tailEvents(
      {
        serverUrl: 'http://example/',
        projectId: 'p',
        workItemId: 1,
        fetchImpl: mockSseFetch(fakeEvents),
      },
      (e) => {
        seen += 1;
        return (e.payload as { to?: string }).to === 'factory:dev-ready';
      },
    );
    expect(result.reason).toBe('callback-stopped');
    expect(seen).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// run — orchestrator integration, all deps injected.
// ---------------------------------------------------------------------------

describe('runDogfood orchestrator', () => {
  let storeDir: string;
  let store: RunsStore;
  let tmpRepoRoot: string;

  beforeEach(async () => {
    storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dogfood-orch-store-'));
    store = new RunsStore({ dir: storeDir });

    tmpRepoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dogfood-orch-repo-'));
    const loggerDir = path.join(tmpRepoRoot, 'apps', 'web', 'src', 'lib');
    await fs.mkdir(loggerDir, { recursive: true });
    // Copy the real source so the seed's ORIGINAL_BLOCK matches.
    const realSrc = await fs.readFile(
      path.resolve(__dirname, '../../apps/web/src/lib/logger.ts'),
      'utf8',
    );
    await fs.writeFile(path.join(loggerDir, 'logger.ts'), realSrc, 'utf8');
  });

  afterEach(async () => {
    await fs.rm(storeDir, { recursive: true, force: true });
    await fs.rm(tmpRepoRoot, { recursive: true, force: true });
  });

  function makeGh(): GhClient {
    const exec: ExecFileFn = async (_file, args) => {
      if (args[0] === '--version') return { stdout: 'gh 2.x', stderr: '' };
      if (args[0] === 'auth' && args[1] === 'status') return { stdout: '', stderr: '' };
      if (args[0] === 'issue' && args[1] === 'create') {
        return { stdout: 'https://github.com/shaunnez/goose-hub/issues/4242\n', stderr: '' };
      }
      throw new Error(`Unexpected args: ${args.join(' ')}`);
    };
    return new GhClient({ exec });
  }

  function makeTail(events: AgentEventDto[]): typeof tailEvents {
    return async (_opts, onEvent) => {
      const collected: AgentEventDto[] = [];
      for (const e of events) {
        collected.push(e);
        const stop = await onEvent(e);
        if (stop === true) return { events: collected, reason: 'callback-stopped' as const };
      }
      return { events: collected, reason: 'server-closed' as const };
    };
  }

  function makeSeedGit() {
    return {
      assertClean: vi.fn().mockResolvedValue(undefined),
      currentRef: vi.fn().mockResolvedValue('main'),
      createBranch: vi.fn().mockResolvedValue(undefined),
      commitAll: vi.fn().mockResolvedValue('seed-commit-sha'),
      pushBranch: vi.fn().mockResolvedValue(undefined),
      fetchBranch: vi.fn().mockResolvedValue(undefined),
      checkout: vi.fn(async () => {
        await restoreSeed('logger-001-drop-meta', { repoRoot: tmpRepoRoot }).catch(() => {});
      }),
      deleteLocalBranch: vi.fn().mockResolvedValue(undefined),
      deleteRemoteBranch: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('happy-path: applies seed, files issue, tails to terminal, records reached-terminal', async () => {
    const events: AgentEventDto[] = [
      { kind: 'state.transitioned', payload: { to: 'factory:investigating' } },
      { kind: 'state.transitioned', payload: { to: 'factory:dev-ready' } },
      { kind: 'state.transitioned', payload: { to: 'factory:needs-qa' } },
      { kind: 'state.transitioned', payload: { to: 'factory:needs-review' } },
      { kind: 'state.transitioned', payload: { to: 'factory:approved' } },
      { kind: 'state.transitioned', payload: { to: 'factory:done' } },
    ];
    const silent = { log: () => {}, warn: () => {}, error: () => {} } as Console;
    const seedGit = makeSeedGit();
    const result = await runDogfood({
      seedId: 'logger-001-drop-meta',
      repoRoot: tmpRepoRoot,
      gh: makeGh(),
      store,
      tail: makeTail(events),
      seedGit,
      logger: silent,
      skipVerifyRed: true,
      skipVerifyGreen: true,
    });

    expect(result.issue.number).toBe(4242);
    expect(result.completion).toBe('reached-terminal');
    expect(result.progress.terminalReached).toBe(true);

    const rows = await store.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].completion).toBe('reached-terminal');
    expect(rows[0].issue?.number).toBe(4242);
    expect(rows[0].baseBranch).toMatch(/^dogfood\/dogfood-/);
    expect(rows[0].baseRef).toBe('seed-commit-sha');
    expect(rows[0].seedCommit).toBe('seed-commit-sha');
    expect(rows[0].endedAt).toBeDefined();
  });

  it('tails the canonical repo-qualified GitHub work item id', async () => {
    let tailedWorkItemId: unknown;
    const silent = { log: () => {}, warn: () => {}, error: () => {} } as Console;
    await runDogfood({
      seedId: 'logger-001-drop-meta',
      repo: 'owner/repo',
      repoRoot: tmpRepoRoot,
      gh: makeGh(),
      store,
      tail: async (opts) => {
        tailedWorkItemId = opts.workItemId;
        return { events: [], reason: 'server-closed' as const };
      },
      seedGit: makeSeedGit(),
      appendEvent: () => {},
      logger: silent,
      skipVerifyRed: true,
      skipVerifyGreen: true,
    });

    expect(tailedWorkItemId).toBe('github:owner/repo#4242');
  });

  it('emits dogfood.seed-applied with base ref metadata', async () => {
    const appendEvent = vi.fn();
    const silent = { log: () => {}, warn: () => {}, error: () => {} } as Console;
    await runDogfood({
      seedId: 'logger-001-drop-meta',
      repo: 'owner/repo',
      repoRoot: tmpRepoRoot,
      gh: makeGh(),
      store,
      tail: makeTail([]),
      seedGit: makeSeedGit(),
      appendEvent,
      logger: silent,
      skipVerifyRed: true,
      skipVerifyGreen: true,
    });

    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'goose-hub-self',
        workItemId: 'github:owner/repo#4242',
        kind: 'dogfood.seed-applied',
        payload: expect.objectContaining({
          seedId: 'logger-001-drop-meta',
          baseBranch: expect.stringMatching(/^dogfood\/dogfood-/),
          baseRef: 'seed-commit-sha',
          seedCommit: 'seed-commit-sha',
          truthSignal: expect.objectContaining({
            testFile: 'apps/web/src/lib/logger.test.ts',
          }),
        }),
      }),
    );
  });

  it('failure path: records `failed:<node>` when an agent.run-failed arrives', async () => {
    const events: AgentEventDto[] = [
      { kind: 'state.transitioned', payload: { to: 'factory:investigating' } },
      { kind: 'agent.run-failed', payload: { skill: 'qa', reason: 'timeout' } },
    ];
    const silent = { log: () => {}, warn: () => {}, error: () => {} } as Console;
    const seedGit = makeSeedGit();
    const result = await runDogfood({
      seedId: 'logger-001-drop-meta',
      repoRoot: tmpRepoRoot,
      gh: makeGh(),
      store,
      tail: makeTail(events),
      seedGit,
      logger: silent,
      skipVerifyRed: true,
      skipVerifyGreen: true,
    });
    expect(typeof result.completion).toBe('object');
    if (typeof result.completion !== 'object') throw new Error('expected failed-object');
    expect(result.completion.failed.node).toBe('qa');
  });

  it('restores the seed locally after a run by default', async () => {
    const events: AgentEventDto[] = [
      { kind: 'state.transitioned', payload: { to: 'factory:done' } },
    ];
    const silent = { log: () => {}, warn: () => {}, error: () => {} } as Console;
    const targetPath = path.join(tmpRepoRoot, 'apps/web/src/lib/logger.ts');
    const before = await fs.readFile(targetPath, 'utf8');
    await runDogfood({
      seedId: 'logger-001-drop-meta',
      repoRoot: tmpRepoRoot,
      gh: makeGh(),
      store,
      tail: makeTail(events),
      seedGit: makeSeedGit(),
      logger: silent,
      skipVerifyRed: true,
      skipVerifyGreen: true,
    });
    const after = await fs.readFile(targetPath, 'utf8');
    expect(after).toBe(before);
  });

  it('computeCompletion translates timeout + no terminal into `stalled`', () => {
    const p = newProgress('bug');
    expect(computeCompletion(p, 'timeout')).toBe('stalled');
    expect(computeCompletion(p, 'server-closed')).toBe('stalled');
  });

  it('computeCompletion preserves a recorded failedNode over reason', () => {
    const p = newProgress('bug');
    p.failedNode = 'qa';
    const c = computeCompletion(p, 'callback-stopped');
    expect(typeof c).toBe('object');
    if (typeof c !== 'object') throw new Error('expected object');
    expect(c.failed.node).toBe('qa');
  });
});
