/**
 * cli-bootstrap slice test — M12.06
 *
 * Exercises bootstrapCommand() with injected deps so no real GitHub calls
 * are made and no live workflow is invoked.
 */
import type { BootstrapResult } from '@goose-hub/core/workflows/bootstrap-project.js';
import { describe, expect, it, vi } from 'vitest';
import { bootstrapCommand } from '../../apps/cli/src/bootstrap-command.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<BootstrapResult> = {}): BootstrapResult {
  return {
    status: 'created',
    registrationPrUrl: 'https://github.com/shaunnez/goose-hub/pull/999',
    slug: 'widgets',
    stackSummary: 'node (pnpm) — scripts: test, lint',
    auditAction: 'ok',
    labelCounts: { created: 5, updated: 0, skipped: 3 },
    ...overrides,
  };
}

function captureLines(): { write: (line: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { write: (line: string) => lines.push(line), lines };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cli-bootstrap slice — bootstrapCommand', () => {
  it('missing <owner>/<repo> arg → exit 1, usage printed', async () => {
    const stdout = captureLines();
    const stderr = captureLines();
    const runWorkflow = vi.fn();

    const code = await bootstrapCommand({
      argv: ['goose', 'project', 'bootstrap'],
      env: { GITHUB_TOKEN: 'ghp_test' },
      runWorkflow,
      write: stdout.write,
      writeErr: stderr.write,
    });

    expect(code).toBe(1);
    expect(stderr.lines.join('\n')).toMatch(/Usage/i);
    expect(runWorkflow).not.toHaveBeenCalled();
  });

  it('malformed repo ref (no slash) → exit 1, usage printed', async () => {
    const stdout = captureLines();
    const stderr = captureLines();
    const runWorkflow = vi.fn();

    const code = await bootstrapCommand({
      argv: ['goose', 'project', 'bootstrap', 'badrepo'],
      env: { GITHUB_TOKEN: 'ghp_test' },
      runWorkflow,
      write: stdout.write,
      writeErr: stderr.write,
    });

    expect(code).toBe(1);
    expect(stderr.lines.join('\n')).toMatch(/owner\/repo/i);
    expect(runWorkflow).not.toHaveBeenCalled();
  });

  it('missing GITHUB_TOKEN → exit 1, helpful error printed', async () => {
    const stdout = captureLines();
    const stderr = captureLines();
    const runWorkflow = vi.fn();

    const code = await bootstrapCommand({
      argv: ['goose', 'project', 'bootstrap', 'acme/widgets'],
      env: {},
      runWorkflow,
      write: stdout.write,
      writeErr: stderr.write,
    });

    expect(code).toBe(1);
    expect(stderr.lines.join('\n')).toMatch(/GITHUB_TOKEN/i);
    expect(runWorkflow).not.toHaveBeenCalled();
  });

  it('happy path (status: created) → prints progress, PR URL, next-steps; exit 0', async () => {
    const stdout = captureLines();
    const stderr = captureLines();
    const runWorkflow = vi.fn().mockResolvedValue(makeResult());

    const code = await bootstrapCommand({
      argv: ['goose', 'project', 'bootstrap', 'acme/widgets'],
      env: { GITHUB_TOKEN: 'ghp_test' },
      runWorkflow,
      write: stdout.write,
      writeErr: stderr.write,
    });

    expect(code).toBe(0);
    const out = stdout.lines.join('\n');
    // Stack summary line
    expect(out).toContain('node (pnpm)');
    // Audit action line
    expect(out).toContain('ok');
    // Label counts line
    expect(out).toContain('created: 5');
    // PR URL
    expect(out).toContain('https://github.com/shaunnez/goose-hub/pull/999');
    // Next steps block
    expect(out).toMatch(/merge/i);
    expect(out).toMatch(/webhook/i);
    expect(runWorkflow).toHaveBeenCalledOnce();
  });

  it('idempotent-skip → prints existing PR URL; exit 0', async () => {
    const stdout = captureLines();
    const stderr = captureLines();
    const runWorkflow = vi.fn().mockResolvedValue(
      makeResult({
        status: 'idempotent-skip',
        stackSummary: '(skipped — existing PR)',
        auditAction: 'ok',
        labelCounts: undefined,
      }),
    );

    const code = await bootstrapCommand({
      argv: ['goose', 'project', 'bootstrap', 'acme/widgets'],
      env: { GITHUB_TOKEN: 'ghp_test' },
      runWorkflow,
      write: stdout.write,
      writeErr: stderr.write,
    });

    expect(code).toBe(0);
    const out = stdout.lines.join('\n');
    expect(out).toContain('https://github.com/shaunnez/goose-hub/pull/999');
    expect(out).toMatch(/already registered|idempotent|existing/i);
  });

  it('workflow throws → exit 1, error message printed to stderr', async () => {
    const stdout = captureLines();
    const stderr = captureLines();
    const runWorkflow = vi.fn().mockRejectedValue(new Error('repo not found'));

    const code = await bootstrapCommand({
      argv: ['goose', 'project', 'bootstrap', 'acme/widgets'],
      env: { GITHUB_TOKEN: 'ghp_test' },
      runWorkflow,
      write: stdout.write,
      writeErr: stderr.write,
    });

    expect(code).toBe(1);
    expect(stderr.lines.join('\n')).toContain('repo not found');
  });

  it('workflow throws BootstrapInputError → exit 1 with actionable message', async () => {
    const stdout = captureLines();
    const stderr = captureLines();
    const err = new Error('repoRef must be "owner/repo"');
    err.name = 'BootstrapInputError';
    const runWorkflow = vi.fn().mockRejectedValue(err);

    const code = await bootstrapCommand({
      argv: ['goose', 'project', 'bootstrap', 'acme/widgets'],
      env: { GITHUB_TOKEN: 'ghp_test' },
      runWorkflow,
      write: stdout.write,
      writeErr: stderr.write,
    });

    expect(code).toBe(1);
    expect(stderr.lines.join('\n')).toContain('repoRef must be "owner/repo"');
  });
});
