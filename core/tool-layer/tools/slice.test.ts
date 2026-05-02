import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SandboxViolationError, readFile, searchFiles } from './read.js';

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
});
