/**
 * Additional tests for core/tool-layer/tools/read.ts
 * Focuses on the searchFiles function — specifically the spawn-based paths that
 * are unreachable in slice.test.ts when `rg` is not installed.
 * Uses vi.mock to stub `node:child_process` so tests run everywhere.
 */
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── mock node:child_process ──────────────────────────────────────────────────

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// Import after mock is registered
import { spawn } from 'node:child_process';
import { SandboxViolationError, searchFiles } from './read.js';

// ---------------------------------------------------------------------------
// Helper: build a minimal fake child process
// ---------------------------------------------------------------------------

function makeChild(opts: {
  stdoutData?: string;
  stderrData?: string;
  exitCode?: number;
  spawnError?: Error;
}) {
  const stdout = new EventEmitter() as EventEmitter & { pipe?: unknown };
  const stderr = new EventEmitter() as EventEmitter & { pipe?: unknown };
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => void;
  };
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = () => {};

  // Emit events on the next tick so the Promise has time to register listeners
  setTimeout(() => {
    if (opts.spawnError != null) {
      child.emit('error', opts.spawnError);
      return;
    }
    if (opts.stdoutData != null) {
      stdout.emit('data', Buffer.from(opts.stdoutData));
    }
    if (opts.stderrData != null) {
      stderr.emit('data', Buffer.from(opts.stderrData));
    }
    child.emit('close', opts.exitCode ?? 0);
  }, 0);

  return child;
}

beforeEach(() => {
  vi.mocked(spawn).mockReset();
});

// ---------------------------------------------------------------------------
// searchFiles — validation (no spawn needed)
// ---------------------------------------------------------------------------

describe('searchFiles — input validation', () => {
  it('rejects an empty pattern with SandboxViolationError', async () => {
    await expect(searchFiles({ workspaceRoot: '/tmp', pattern: '' })).rejects.toThrow(
      SandboxViolationError,
    );
  });

  it('rejects a pattern containing ../ with SandboxViolationError', async () => {
    await expect(searchFiles({ workspaceRoot: '/tmp', pattern: '../secret' })).rejects.toThrow(
      SandboxViolationError,
    );
  });
});

// ---------------------------------------------------------------------------
// searchFiles — spawn-backed paths
// ---------------------------------------------------------------------------

describe('searchFiles — spawn paths', () => {
  it('returns stdout on exit code 0 (match found)', async () => {
    vi.mocked(spawn).mockReturnValue(
      makeChild({ stdoutData: 'file.ts:1: match', exitCode: 0 }) as ReturnType<typeof spawn>,
    );

    const result = await searchFiles({ workspaceRoot: '/workspace', pattern: 'match' });

    expect(result).toBe('file.ts:1: match');
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('returns empty string on exit code 1 (no matches)', async () => {
    vi.mocked(spawn).mockReturnValue(makeChild({ exitCode: 1 }) as ReturnType<typeof spawn>);

    const result = await searchFiles({ workspaceRoot: '/workspace', pattern: 'nomatch' });

    expect(result).toBe('');
  });

  it('rejects with an Error on exit code >= 2 (ripgrep error)', async () => {
    vi.mocked(spawn).mockReturnValue(
      makeChild({ exitCode: 2, stderrData: 'some rg error' }) as ReturnType<typeof spawn>,
    );

    await expect(searchFiles({ workspaceRoot: '/workspace', pattern: 'x' })).rejects.toThrow(
      'ripgrep exited with code 2',
    );
  });

  it('includes stderr in the rejection message', async () => {
    vi.mocked(spawn).mockReturnValue(
      makeChild({ exitCode: 2, stderrData: 'bad pattern error' }) as ReturnType<typeof spawn>,
    );

    await expect(searchFiles({ workspaceRoot: '/workspace', pattern: 'x' })).rejects.toThrow(
      'bad pattern error',
    );
  });

  it('rejects when spawn itself emits an error (e.g. rg not found)', async () => {
    vi.mocked(spawn).mockReturnValue(
      makeChild({ spawnError: new Error('spawn ENOENT') }) as ReturnType<typeof spawn>,
    );

    await expect(searchFiles({ workspaceRoot: '/workspace', pattern: 'x' })).rejects.toThrow(
      'Failed to spawn ripgrep',
    );
  });

  it('passes the glob option to ripgrep args when provided', async () => {
    vi.mocked(spawn).mockReturnValue(makeChild({ exitCode: 1 }) as ReturnType<typeof spawn>);

    await searchFiles({ workspaceRoot: '/workspace', pattern: 'x', glob: '*.ts' });

    const spawnArgs = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(spawnArgs).toContain('--glob');
    expect(spawnArgs).toContain('*.ts');
  });

  it('omits the glob flag when glob is not provided', async () => {
    vi.mocked(spawn).mockReturnValue(makeChild({ exitCode: 1 }) as ReturnType<typeof spawn>);

    await searchFiles({ workspaceRoot: '/workspace', pattern: 'x' });

    const spawnArgs = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(spawnArgs).not.toContain('--glob');
  });

  it('omits the glob flag when glob is an empty string', async () => {
    vi.mocked(spawn).mockReturnValue(makeChild({ exitCode: 1 }) as ReturnType<typeof spawn>);

    await searchFiles({ workspaceRoot: '/workspace', pattern: 'x', glob: '' });

    const spawnArgs = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(spawnArgs).not.toContain('--glob');
  });

  it('always pins the search path to workspaceRoot (never user-supplied)', async () => {
    vi.mocked(spawn).mockReturnValue(
      makeChild({ exitCode: 0, stdoutData: '' }) as ReturnType<typeof spawn>,
    );

    const root = '/my/workspace';
    await searchFiles({ workspaceRoot: root, pattern: 'x' });

    const spawnArgs = vi.mocked(spawn).mock.calls[0][1] as string[];
    // Last arg is the search path — must be workspaceRoot
    expect(spawnArgs[spawnArgs.length - 1]).toBe(root);
  });

  it('collects stdout across multiple data events', async () => {
    const child = makeChild({}) as ReturnType<typeof spawn>;
    // Override the auto-emit with manual control
    vi.mocked(spawn).mockReturnValue(child);

    const promise = searchFiles({ workspaceRoot: '/w', pattern: 'x' });

    // Manually emit two chunks then close
    child.stdout?.emit('data', Buffer.from('chunk1'));
    child.stdout?.emit('data', Buffer.from('chunk2'));
    child.emit('close', 0);

    const result = await promise;
    expect(result).toBe('chunk1chunk2');
  });
});
