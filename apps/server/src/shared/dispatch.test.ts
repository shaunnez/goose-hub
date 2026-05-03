import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * dispatch.ts dispatches to workflow modules via dynamic import. We use top-level
 * vi.mock() (hoisted) to intercept those dynamic imports at the module registry
 * level, then configure the mock functions per test using beforeEach.
 */

// ─── module-level mock stubs ───────────────────────────────────────────────

const mockRunTriageBatch = vi.fn();
const mockGetSourceForSlug = vi.fn();
const mockLoggerError = vi.fn();
const mockLoggerInfo = vi.fn();

vi.mock('../domains/workflows/triage-batch.js', () => ({
  runTriageBatch: mockRunTriageBatch,
}));

vi.mock('./source.js', () => ({
  getSourceForSlug: mockGetSourceForSlug,
  isValidSlug: vi.fn().mockReturnValue(true),
}));

vi.mock('@goose-hub/core/logger.js', () => ({
  logger: {
    error: mockLoggerError,
    info: mockLoggerInfo,
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── helpers ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockRunTriageBatch.mockResolvedValue(undefined);
  mockGetSourceForSlug.mockResolvedValue(null);
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
