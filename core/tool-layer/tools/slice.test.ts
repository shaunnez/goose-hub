import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BASH_DENYLIST, runBash } from './bash.js';
import {
  SandboxViolationError,
  readFile,
  readFileWithMetadata,
  searchFiles,
  searchFilesWithMetadata,
} from './read.js';
import { runTests } from './test.js';
import { writeFile, writeFileWithMetadata } from './write.js';

const rgAvailable = (() => {
  try {
    execSync('rg --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

// ─── readFile ─────────────────────────────────────────────────────────────────

describe('readFile', () => {
  it('reads a file within the workspace root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'read-tool-test-'));
    try {
      writeFileSync(join(dir, 'hello.txt'), 'hello world');
      const content = await readFile({ workspaceRoot: dir, path: 'hello.txt' });
      expect(content).toBe('hello world');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('reads a file in a subdirectory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'read-tool-test-'));
    try {
      mkdirSync(join(dir, 'sub'));
      writeFileSync(join(dir, 'sub', 'nested.txt'), 'nested content');
      const content = await readFile({ workspaceRoot: dir, path: 'sub/nested.txt' });
      expect(content).toBe('nested content');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('rejects absolute paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'read-tool-test-'));
    try {
      await expect(readFile({ workspaceRoot: dir, path: '/etc/passwd' })).rejects.toThrow(
        SandboxViolationError,
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('normalizes a unique package-relative path before reading', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'read-tool-test-'));
    try {
      writeFileSync(join(dir, 'pnpm-workspace.yaml'), ['packages:', "  - 'apps/*'"].join('\n'));
      mkdirSync(join(dir, 'apps/web/src'), { recursive: true });
      writeFileSync(join(dir, 'apps/web/src/app.ts'), 'export const app = true;');

      const result = await readFileWithMetadata({ workspaceRoot: dir, path: 'src/app.ts' });

      expect(result.content).toBe('export const app = true;');
      expect(result.path).toEqual({
        path: 'apps/web/src/app.ts',
        root: 'worktree',
        packageRoot: 'apps/web',
        normalizedFrom: 'src/app.ts',
      });
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('strips an absolute worktree path before returning metadata', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'read-tool-test-'));
    try {
      writeFileSync(join(dir, 'hello.txt'), 'hello world');

      const result = await readFileWithMetadata({
        workspaceRoot: dir,
        path: join(dir, 'hello.txt'),
      });

      expect(result.path).toEqual({
        path: 'hello.txt',
        root: 'worktree',
        normalizedFrom: join(dir, 'hello.txt'),
      });
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('rejects ../ traversal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'read-tool-test-'));
    try {
      await expect(readFile({ workspaceRoot: dir, path: '../outside.txt' })).rejects.toThrow(
        SandboxViolationError,
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('rejects deeply nested traversal that escapes root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'read-tool-test-'));
    try {
      await expect(readFile({ workspaceRoot: dir, path: 'sub/../../outside.txt' })).rejects.toThrow(
        SandboxViolationError,
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('rejects empty path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'read-tool-test-'));
    try {
      await expect(readFile({ workspaceRoot: dir, path: '' })).rejects.toThrow(
        SandboxViolationError,
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

// ─── searchFiles ──────────────────────────────────────────────────────────────

describe.skipIf(!rgAvailable)('searchFiles', () => {
  it('returns grep matches within the workspace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'search-tool-test-'));
    try {
      writeFileSync(join(dir, 'foo.ts'), 'const greeting = "hello";\nconst farewell = "goodbye";');
      const results = await searchFiles({ workspaceRoot: dir, pattern: 'hello' });
      expect(results).toContain('hello');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('returns empty string when no matches found', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'search-tool-test-'));
    try {
      writeFileSync(join(dir, 'foo.ts'), 'const greeting = "hello";');
      const results = await searchFiles({ workspaceRoot: dir, pattern: 'zzznomatch' });
      expect(results).toBe('');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('searches recursively across subdirectories', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'search-tool-test-'));
    try {
      mkdirSync(join(dir, 'sub'));
      writeFileSync(join(dir, 'sub', 'bar.ts'), 'export const SECRET_MARKER = 42;');
      const results = await searchFiles({ workspaceRoot: dir, pattern: 'SECRET_MARKER' });
      expect(results).toContain('SECRET_MARKER');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('rejects patterns containing path traversal (../)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'search-tool-test-'));
    try {
      await expect(searchFiles({ workspaceRoot: dir, pattern: '../outside' })).rejects.toThrow(
        SandboxViolationError,
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('rejects empty pattern', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'search-tool-test-'));
    try {
      await expect(searchFiles({ workspaceRoot: dir, pattern: '' })).rejects.toThrow(
        SandboxViolationError,
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('accepts optional glob filter', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'search-tool-test-'));
    try {
      writeFileSync(join(dir, 'app.ts'), 'const x = "findme";');
      writeFileSync(join(dir, 'app.txt'), 'const y = "findme";');
      const results = await searchFiles({
        workspaceRoot: dir,
        pattern: 'findme',
        glob: '*.ts',
      });
      expect(results).toContain('app.ts');
      expect(results).not.toContain('app.txt');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('returns canonical match paths from metadata search', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'search-tool-test-'));
    try {
      mkdirSync(join(dir, 'apps/web/src'), { recursive: true });
      writeFileSync(join(dir, 'apps/web/src/app.ts'), 'const marker = "findme";');
      const { stdout, paths } = await searchFilesWithMetadata({
        workspaceRoot: dir,
        pattern: 'findme',
      });

      expect(stdout).toContain('apps/web/src/app.ts:1:');
      expect(paths).toEqual([
        {
          path: 'apps/web/src/app.ts',
          root: 'worktree',
          packageRoot: 'apps/web',
          normalizedFrom: './apps/web/src/app.ts',
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

// ─── writeFile ────────────────────────────────────────────────────────────────

describe('writeFile', () => {
  it('writes a file within the workspace root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'write-tool-test-'));
    try {
      await writeFile({ workspaceRoot: dir, path: 'hello.txt', content: 'hello world' });
      expect(readFileSync(join(dir, 'hello.txt'), 'utf8')).toBe('hello world');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('creates parent directories by default', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'write-tool-test-'));
    try {
      await writeFile({
        workspaceRoot: dir,
        path: 'src/deep/nested/file.ts',
        content: 'export const x = 1;',
      });
      expect(statSync(join(dir, 'src/deep/nested/file.ts')).isFile()).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('overwrites existing files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'write-tool-test-'));
    try {
      writeFileSync(join(dir, 'a.txt'), 'old');
      await writeFile({ workspaceRoot: dir, path: 'a.txt', content: 'new' });
      expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('new');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('rejects absolute paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'write-tool-test-'));
    try {
      await expect(
        writeFile({ workspaceRoot: dir, path: '/etc/passwd', content: 'pwned' }),
      ).rejects.toThrow(SandboxViolationError);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('rejects ../ traversal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'write-tool-test-'));
    try {
      await expect(
        writeFile({ workspaceRoot: dir, path: '../escape.txt', content: 'pwned' }),
      ).rejects.toThrow(SandboxViolationError);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('rejects deeply nested traversal that escapes root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'write-tool-test-'));
    try {
      await expect(
        writeFile({
          workspaceRoot: dir,
          path: 'sub/../../escape.txt',
          content: 'pwned',
        }),
      ).rejects.toThrow(SandboxViolationError);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('rejects empty path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'write-tool-test-'));
    try {
      await expect(writeFile({ workspaceRoot: dir, path: '', content: 'x' })).rejects.toThrow(
        SandboxViolationError,
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('returns canonical path metadata for writes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'write-tool-test-'));
    try {
      const result = await writeFileWithMetadata({
        workspaceRoot: dir,
        path: './apps/web/src/new-file.ts',
        content: 'export const value = 1;',
      });

      expect(readFileSync(join(dir, 'apps/web/src/new-file.ts'), 'utf8')).toBe(
        'export const value = 1;',
      );
      expect(result).toEqual({
        path: {
          path: 'apps/web/src/new-file.ts',
          root: 'worktree',
          normalizedFrom: './apps/web/src/new-file.ts',
        },
        written: true,
      });
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

// ─── runBash ──────────────────────────────────────────────────────────────────

describe('runBash', () => {
  it('runs a simple command and captures stdout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bash-tool-test-'));
    try {
      const result = await runBash({
        workspaceRoot: dir,
        argv: ['node', '-e', "process.stdout.write('hello bash tool')"],
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('hello bash tool');
      expect(result.timedOut).toBe(false);
      expect(result.truncated).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('captures non-zero exit codes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bash-tool-test-'));
    try {
      const result = await runBash({ workspaceRoot: dir, argv: ['node', '-e', 'process.exit(1)'] });
      expect(result.exitCode).not.toBe(0);
      // BashResult intentionally has no `passed` field — that's runTests' job.
      expect('passed' in result).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('runs in the workspace cwd', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bash-tool-test-'));
    try {
      writeFileSync(join(dir, 'marker.txt'), '');
      const result = await runBash({
        workspaceRoot: dir,
        argv: [
          'node',
          '-e',
          "const fs=require('node:fs');process.stdout.write(fs.readdirSync('.').join('\\n'))",
        ],
      });
      expect(result.stdout).toContain('marker.txt');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('rejects empty argv', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bash-tool-test-'));
    try {
      await expect(runBash({ workspaceRoot: dir, argv: [] })).rejects.toThrow(
        SandboxViolationError,
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('rejects denylisted patterns (sudo)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bash-tool-test-'));
    try {
      await expect(
        runBash({ workspaceRoot: dir, argv: ['sudo', 'rm', 'file.txt'] }),
      ).rejects.toThrow(SandboxViolationError);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('rejects denylisted patterns (rm -rf /)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bash-tool-test-'));
    try {
      await expect(runBash({ workspaceRoot: dir, argv: ['rm', '-rf', '/'] })).rejects.toThrow(
        SandboxViolationError,
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('rejects git push --force', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bash-tool-test-'));
    try {
      await expect(
        runBash({ workspaceRoot: dir, argv: ['git', 'push', '--force'] }),
      ).rejects.toThrow(SandboxViolationError);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('honours a custom denylist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bash-tool-test-'));
    try {
      await expect(
        runBash({ workspaceRoot: dir, argv: ['echo', 'forbidden'], denylist: ['forbidden'] }),
      ).rejects.toThrow(SandboxViolationError);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('does not invoke a shell (argv strings remain literal)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bash-tool-test-'));
    try {
      // Shell-metachar in an argv element should be literal text — no command substitution.
      // JSON.stringify(process.argv) surfaces all argv elements so the assertion
      // doesn't depend on a specific index position.
      const result = await runBash({
        workspaceRoot: dir,
        argv: ['node', '-e', 'process.stdout.write(JSON.stringify(process.argv))', '$(whoami)'],
      });
      expect(result.stdout).toContain('$(whoami)');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('kills runaway processes after the timeout and reports timedOut', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bash-tool-test-'));
    try {
      const result = await runBash({
        workspaceRoot: dir,
        argv: ['node', '-e', 'setTimeout(()=>{},10000)'],
        timeoutMs: 100,
      });
      expect(result.timedOut).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('exposes a default denylist that includes sudo and rm -rf /', () => {
    expect(DEFAULT_BASH_DENYLIST).toContain('sudo ');
    expect(DEFAULT_BASH_DENYLIST).toContain('rm -rf /');
  });

  it('captures stderr output from the child process', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bash-tool-test-'));
    try {
      // sh -c 'echo err >&2' writes to stderr; on all platforms 'node' is available
      const result = await runBash({
        workspaceRoot: dir,
        argv: ['node', '-e', 'process.stderr.write("err output")'],
      });
      expect(result.stderr).toContain('err output');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('truncates stdout at BASH_STDOUT_CAP and sets truncated: true', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bash-tool-test-'));
    try {
      // Generate ~5 MB of output (> 4 MB cap) with node so it's cross-platform
      const result = await runBash({
        workspaceRoot: dir,
        argv: [
          'node',
          '-e',
          // Write 5 MB in chunks to exceed the 4 MB cap
          `const chunk = 'x'.repeat(1024 * 1024); for(let i=0;i<5;i++) process.stdout.write(chunk);`,
        ],
        timeoutMs: 10_000,
      });
      expect(result.truncated).toBe(true);
      // stdout length should be at most 4 MB
      expect(result.stdout.length).toBeLessThanOrEqual(4 * 1024 * 1024);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('rejects with an error when the command cannot be spawned', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bash-tool-test-'));
    try {
      await expect(
        runBash({ workspaceRoot: dir, argv: ['__no_such_command_xyz__'] }),
      ).rejects.toThrow('__no_such_command_xyz__');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('rejects argv entries that are not strings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bash-tool-test-'));
    try {
      // biome-ignore lint/suspicious/noExplicitAny: intentional bad arg for test
      await expect(runBash({ workspaceRoot: dir, argv: [42 as any] })).rejects.toThrow(
        SandboxViolationError,
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

// ─── runTests ─────────────────────────────────────────────────────────────────

describe('runTests', () => {
  it('returns passed: true on exit code 0', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'test-tool-test-'));
    try {
      const result = await runTests({ workspaceRoot: dir, testCommand: 'node -e process.exit(0)' });
      expect(result.passed).toBe(true);
      expect(result.exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('returns passed: false on non-zero exit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'test-tool-test-'));
    try {
      const result = await runTests({ workspaceRoot: dir, testCommand: 'node -e process.exit(1)' });
      expect(result.passed).toBe(false);
      expect(result.exitCode).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('tokenises a multi-word testCommand into argv', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'test-tool-test-'));
    try {
      // A two-token command reaches spawn as discrete argv elements — verified by --version output.
      const result = await runTests({ workspaceRoot: dir, testCommand: 'node --version' });
      expect(result.passed).toBe(true);
      expect(result.stdout.trim()).toMatch(/^v\d+/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('rejects empty testCommand', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'test-tool-test-'));
    try {
      await expect(runTests({ workspaceRoot: dir, testCommand: '   ' })).rejects.toThrow(
        SandboxViolationError,
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('inherits the bash denylist (rejects sudo testCommand)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'test-tool-test-'));
    try {
      await expect(runTests({ workspaceRoot: dir, testCommand: 'sudo make test' })).rejects.toThrow(
        SandboxViolationError,
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('returns canonical metadata for supplied test paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'test-tool-test-'));
    try {
      writeFileSync(join(dir, 'pnpm-workspace.yaml'), ['packages:', "  - 'apps/*'"].join('\n'));
      mkdirSync(join(dir, 'apps/web/src'), { recursive: true });
      writeFileSync(join(dir, 'apps/web/src/app.test.ts'), 'test file');

      const result = await runTests({
        workspaceRoot: dir,
        testCommand: 'node -e process.exit(0)',
        paths: ['src/app.test.ts'],
      });

      expect(result.paths).toEqual([
        {
          path: 'apps/web/src/app.test.ts',
          root: 'worktree',
          packageRoot: 'apps/web',
          normalizedFrom: 'src/app.test.ts',
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
