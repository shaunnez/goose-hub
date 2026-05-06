import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * dispatch.ts dispatches to workflow modules via dynamic import. We use top-level
 * vi.mock() (hoisted) to intercept those dynamic imports at the module registry
 * level, then configure the mock functions per test using beforeEach.
 */

// ─── module-level mock stubs ───────────────────────────────────────────────

const mockRunTriageBatch = vi.fn();
const mockGetSourceForSlug = vi.fn();
const mockGetProject = vi.fn();
const mockLoggerError = vi.fn();
const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();

const mockRunRetroForItem = vi.fn();

vi.mock('../domains/workflows/triage-batch.js', () => ({
  runTriageBatch: mockRunTriageBatch,
}));

vi.mock('../domains/workflows/retro-batch.js', () => ({
  runRetroForItem: mockRunRetroForItem,
  runRetroBatch: vi.fn(),
}));

vi.mock('./source.js', () => ({
  getSourceForSlug: mockGetSourceForSlug,
  isValidSlug: vi.fn().mockReturnValue(true),
}));

vi.mock('./projects.js', () => ({
  getProject: mockGetProject,
}));

vi.mock('@goose-hub/core/logger.js', () => ({
  logger: {
    error: mockLoggerError,
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    debug: vi.fn(),
  },
}));

// ─── helpers ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetModules(); // reset module-level in-flight Sets between tests
  vi.resetAllMocks(); // clears call counts AND implementation queues (once-mocks)
  mockRunTriageBatch.mockResolvedValue(undefined);
  mockRunRetroForItem.mockResolvedValue(undefined);
  mockGetSourceForSlug.mockResolvedValue(null);
  // Default: single-workflow-per-project (backward-compat) for tests that don't override.
  mockGetProject.mockResolvedValue(null);
});

// ─── dispatchTriageBatch ──────────────────────────────────────────────────

describe('dispatchTriageBatch', () => {
  it('calls runTriageBatch with the slug', async () => {
    const { dispatchTriageBatch } = await import('./dispatch.js');
    await dispatchTriageBatch('my-project');

    expect(mockRunTriageBatch).toHaveBeenCalledOnce();
    expect(mockRunTriageBatch).toHaveBeenCalledWith('my-project');
  });

  it('swallows errors and does not throw (best-effort behaviour)', async () => {
    mockRunTriageBatch.mockRejectedValue(new Error('triage failed'));

    const { dispatchTriageBatch } = await import('./dispatch.js');
    // Must NOT throw
    await expect(dispatchTriageBatch('my-project')).resolves.toBeUndefined();
  });

  it('logs the error when runTriageBatch throws', async () => {
    mockRunTriageBatch.mockRejectedValue(new Error('kaboom'));

    const { dispatchTriageBatch } = await import('./dispatch.js');
    await dispatchTriageBatch('err-slug');

    expect(mockLoggerError).toHaveBeenCalledOnce();
    expect(mockLoggerError.mock.calls[0][0]).toContain('dispatchTriageBatch failed');
  });

  it('concurrent calls same slug: second coalesces into one deferred run', async () => {
    let resolveRun: (() => void) | undefined;
    mockRunTriageBatch
      .mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            resolveRun = r;
          }),
      )
      .mockResolvedValue(undefined);

    const { dispatchTriageBatch } = await import('./dispatch.js');

    // Fire all three concurrently — p2/p3 return immediately (coalesced to pending)
    const [p1, p2, p3] = [
      dispatchTriageBatch('slug'),
      dispatchTriageBatch('slug'),
      dispatchTriageBatch('slug'),
    ];
    await Promise.all([p2, p3]);

    // Wait until the dynamic import resolves and runTriageBatch is actually in-flight
    await vi.waitFor(() => {
      expect(resolveRun).toBeDefined();
    });
    expect(mockRunTriageBatch).toHaveBeenCalledTimes(1);

    resolveRun?.();
    await p1;

    // Wait for the single deferred run to complete (avoids leaked async work)
    await vi.waitFor(() => {
      expect(mockRunTriageBatch).toHaveBeenCalledTimes(2);
    });
  });

  it('different slugs do not block each other', async () => {
    const { dispatchTriageBatch } = await import('./dispatch.js');
    // Sequential is sufficient: if in-flight check for slug-a blocked slug-b,
    // slug-b would skip runTriageBatch. Sequential also avoids Vitest concurrent-
    // mock-cache timing issues with the same dynamic import path.
    await dispatchTriageBatch('slug-a');
    await dispatchTriageBatch('slug-b');

    expect(mockRunTriageBatch).toHaveBeenCalledTimes(2);
    expect(mockRunTriageBatch).toHaveBeenNthCalledWith(1, 'slug-a');
    expect(mockRunTriageBatch).toHaveBeenNthCalledWith(2, 'slug-b');
  });
});

// ─── dispatchInvestigate ──────────────────────────────────────────────────

describe('dispatchInvestigate', () => {
  it('returns early and logs when source is null', { timeout: 30_000 }, async () => {
    mockGetSourceForSlug.mockResolvedValue(null);

    const { dispatchInvestigate } = await import('./dispatch.js');
    await expect(dispatchInvestigate('no-source', 42)).resolves.toBeUndefined();
    expect(mockLoggerError).toHaveBeenCalledWith(
      'dispatchInvestigate: no source for slug',
      expect.objectContaining({ slug: 'no-source' }),
    );
  });

  it('drops duplicate trigger for same issue while in-flight', async () => {
    let resolveSource!: () => void;
    mockGetSourceForSlug.mockReturnValueOnce(
      new Promise<null>((r) => {
        resolveSource = () => r(null);
      }),
    );

    const { dispatchInvestigate } = await import('./dispatch.js');
    const p1 = dispatchInvestigate('slug', 5);
    const p2 = dispatchInvestigate('slug', 5); // duplicate — should be dropped

    await p2;
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'dispatchInvestigate: parallel-lock rejected (in-flight or at cap)',
      expect.objectContaining({ slug: 'slug', issueNumber: 5 }),
    );

    resolveSource();
    await p1;
    expect(mockGetSourceForSlug).toHaveBeenCalledTimes(1);
  });

  it('different issue numbers run independently when maxParallelAgents allows it', async () => {
    // Set maxParallelAgents=2 so both can run concurrently (M11 parallel dispatch).
    mockGetProject.mockResolvedValue({ budgets: { maxParallelAgents: 2 } });

    const { dispatchInvestigate } = await import('./dispatch.js');
    await Promise.all([dispatchInvestigate('slug', 1), dispatchInvestigate('slug', 2)]);
    expect(mockGetSourceForSlug).toHaveBeenCalledTimes(2);
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });
});

// ─── dispatchFixIssue ─────────────────────────────────────────────────────

describe('dispatchFixIssue', () => {
  it('returns early and logs when source is null', { timeout: 30_000 }, async () => {
    mockGetSourceForSlug.mockResolvedValue(null);

    const { dispatchFixIssue } = await import('./dispatch.js');
    await expect(dispatchFixIssue('no-source', 10)).resolves.toBeUndefined();
    expect(mockLoggerError).toHaveBeenCalledWith(
      'dispatchFixIssue: no source for slug',
      expect.objectContaining({ slug: 'no-source' }),
    );
  });

  it('drops duplicate trigger for same issue while in-flight', async () => {
    let resolveSource!: () => void;
    mockGetSourceForSlug.mockReturnValueOnce(
      new Promise<null>((r) => {
        resolveSource = () => r(null);
      }),
    );

    const { dispatchFixIssue } = await import('./dispatch.js');
    const p1 = dispatchFixIssue('slug', 7);
    const p2 = dispatchFixIssue('slug', 7);

    await p2;
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'dispatchFixIssue: parallel-lock rejected (in-flight or at cap)',
      expect.objectContaining({ slug: 'slug', issueNumber: 7 }),
    );

    resolveSource();
    await p1;
    expect(mockGetSourceForSlug).toHaveBeenCalledTimes(1);
  });
});

// ─── dispatchForLabel — label routing switch ─────────────────────────────

describe('dispatchForLabel', () => {
  it('routes factory:triaging to dispatchTriageBatch', async () => {
    const { dispatchForLabel } = await import('./dispatch.js');
    await dispatchForLabel('my-project', 1, 'factory:triaging');

    expect(mockRunTriageBatch).toHaveBeenCalledWith('my-project');
  });

  it(
    'routes factory:investigating to dispatchInvestigate (source null path)',
    { timeout: 30_000 },
    async () => {
      mockGetSourceForSlug.mockResolvedValue(null);

      const { dispatchForLabel } = await import('./dispatch.js');
      await expect(
        dispatchForLabel('my-project', 5, 'factory:investigating'),
      ).resolves.toBeUndefined();
      expect(mockLoggerError).toHaveBeenCalledWith(
        'dispatchInvestigate: no source for slug',
        expect.any(Object),
      );
    },
  );

  it(
    'routes factory:dev-ready to dispatchFixIssue (source null path)',
    { timeout: 30_000 },
    async () => {
      mockGetSourceForSlug.mockResolvedValue(null);

      const { dispatchForLabel } = await import('./dispatch.js');
      await expect(dispatchForLabel('my-project', 7, 'factory:dev-ready')).resolves.toBeUndefined();
      expect(mockLoggerError).toHaveBeenCalledWith(
        'dispatchFixIssue: no source for slug',
        expect.any(Object),
      );
    },
  );

  it('logs and does nothing for an unrecognised label (fallthrough)', async () => {
    const { dispatchForLabel } = await import('./dispatch.js');
    await expect(
      dispatchForLabel('my-project', 3, 'factory:unknown-label'),
    ).resolves.toBeUndefined();

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'dispatchForLabel: no workflow for label',
      expect.objectContaining({ labelName: 'factory:unknown-label' }),
    );
  });

  it('fallthrough: does not call triageBatch for unrecognised label', async () => {
    const { dispatchForLabel } = await import('./dispatch.js');
    await dispatchForLabel('my-project', 1, 'factory:needs-qa');

    expect(mockRunTriageBatch).not.toHaveBeenCalled();
  });
});

// ─── dispatchRetro ────────────────────────────────────────────────────────

describe('dispatchRetro', () => {
  it('returns early and logs when source is null', { timeout: 30_000 }, async () => {
    mockGetSourceForSlug.mockResolvedValue(null);

    const { dispatchRetro } = await import('./dispatch.js');
    await expect(dispatchRetro('no-source', 42)).resolves.toBeUndefined();
    expect(mockLoggerError).toHaveBeenCalledWith(
      'dispatchRetro: no source for slug',
      expect.objectContaining({ slug: 'no-source' }),
    );
    expect(mockRunRetroForItem).not.toHaveBeenCalled();
  });

  it('skips items whose state has already advanced past factory:retrospecting', async () => {
    const source = {
      getItem: vi.fn().mockResolvedValue({ state: 'factory:done' }),
    };
    mockGetSourceForSlug.mockResolvedValue(source);

    const { dispatchRetro } = await import('./dispatch.js');
    await dispatchRetro('slug', 42);

    expect(mockRunRetroForItem).not.toHaveBeenCalled();
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'dispatchRetro: state already advanced, skipping',
      expect.objectContaining({ slug: 'slug', issueNumber: 42, state: 'factory:done' }),
    );
  });

  it('runs retro when item is in factory:retrospecting', async () => {
    const item = { state: 'factory:retrospecting' };
    const source = { getItem: vi.fn().mockResolvedValue(item) };
    mockGetSourceForSlug.mockResolvedValue(source);

    const { dispatchRetro } = await import('./dispatch.js');
    await dispatchRetro('slug', 42);

    expect(mockRunRetroForItem).toHaveBeenCalledWith(item, source, 'slug');
  });
});
