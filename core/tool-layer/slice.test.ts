import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOL_BUNDLES, computeAllowlist } from './allowlist.js';
import { writeWorkspaceSandbox } from './sandbox.js';
import { redactSecrets } from './secret-redaction.js';

// ─── secret-redaction ────────────────────────────────────────────────────────

describe('redactSecrets', () => {
  it('redacts AWS AKIA key in a nested object', () => {
    const input = { creds: { key: 'AKIAIOSFODNN7EXAMPLE' } };
    const result = redactSecrets(input) as { creds: { key: string } };
    expect(result.creds.key).toBe('[REDACTED]');
  });

  it('redacts GitHub classic token (ghp_) in a string', () => {
    const token = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    const result = redactSecrets(`Authorization: ${token}`) as string;
    expect(result).toBe('Authorization: [REDACTED]');
    expect(result).not.toContain(token);
  });

  it('redacts GitHub Actions token (ghs_) in a string', () => {
    const token = 'ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901';
    const result = redactSecrets(token) as string;
    expect(result).toBe('[REDACTED]');
  });

  it('redacts Bearer token', () => {
    const result = redactSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload') as string;
    expect(result).toBe('Authorization: [REDACTED]');
  });

  it('redacts secret-looking env var values', () => {
    expect(redactSecrets('MY_API_KEY=supersecret123')).toBe('MY_API_KEY=[REDACTED]');
    expect(redactSecrets('STRIPE_SECRET=sk_live_abc')).toBe('STRIPE_SECRET=[REDACTED]');
    expect(redactSecrets('ACCESS_TOKEN=tok_abc123')).toBe('ACCESS_TOKEN=[REDACTED]');
  });

  it('does not redact non-secret env var values', () => {
    expect(redactSecrets('PORT=3000')).toBe('PORT=3000');
    expect(redactSecrets('NODE_ENV=production')).toBe('NODE_ENV=production');
    expect(redactSecrets('DATABASE_URL=postgresql://localhost/db')).toBe(
      'DATABASE_URL=postgresql://localhost/db',
    );
  });

  it('passthrough non-string primitives unchanged', () => {
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(true)).toBe(true);
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(undefined)).toBeUndefined();
  });

  it('deep-walks arrays', () => {
    const input = ['clean', 'AKIAIOSFODNN7EXAMPLE'];
    const result = redactSecrets(input) as string[];
    expect(result[0]).toBe('clean');
    expect(result[1]).toBe('[REDACTED]');
  });

  it('deep-walks nested objects', () => {
    const input = { a: { b: { token: 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx0123456' } } };
    const result = redactSecrets(input) as { a: { b: { token: string } } };
    expect(result.a.b.token).toBe('[REDACTED]');
  });
});

// ─── tool bundles + allowlist ─────────────────────────────────────────────────

describe('TOOL_BUNDLES', () => {
  it('defines read-only, read-write, and bash-restricted bundles', () => {
    expect(TOOL_BUNDLES['read-only']).toBeDefined();
    expect(TOOL_BUNDLES['read-write']).toBeDefined();
    expect(TOOL_BUNDLES['bash-restricted']).toBeDefined();
  });

  it('read-only bundle contains Read and Grep', () => {
    expect(TOOL_BUNDLES['read-only']).toContain('Read');
    expect(TOOL_BUNDLES['read-only']).toContain('Grep');
  });

  it('read-write bundle contains Write and Edit', () => {
    expect(TOOL_BUNDLES['read-write']).toContain('Write');
    expect(TOOL_BUNDLES['read-write']).toContain('Edit');
  });

  it('validate bundle contains Read, Write, and scoped Bash patterns', () => {
    expect(TOOL_BUNDLES.validate).toContain('Read');
    expect(TOOL_BUNDLES.validate).toContain('Write');
    expect(TOOL_BUNDLES.validate).toContain('Bash(pnpm test:e2e*)');
    expect(TOOL_BUNDLES.validate).toContain('Bash(git push*)');
  });

  it('validate bundle does not include unrestricted Bash', () => {
    expect(TOOL_BUNDLES.validate).not.toContain('Bash');
  });

  it('playwright-mcp bundle contains browser_* and planner_* and generator_* tools', () => {
    expect(TOOL_BUNDLES['playwright-mcp']).toContain('mcp__playwright-test__browser_navigate');
    expect(TOOL_BUNDLES['playwright-mcp']).toContain(
      'mcp__playwright-test__browser_take_screenshot',
    );
    expect(TOOL_BUNDLES['playwright-mcp']).toContain('mcp__playwright-test__planner_save_plan');
    expect(TOOL_BUNDLES['playwright-mcp']).toContain('mcp__playwright-test__generator_write_test');
  });

  it('playwright-mcp bundle entries are all mcp__playwright-test__ prefixed', () => {
    for (const tool of TOOL_BUNDLES['playwright-mcp']) {
      expect(tool.startsWith('mcp__playwright-test__')).toBe(true);
    }
  });
});

describe('computeAllowlist', () => {
  it('returns tools from specified bundles', () => {
    const list = computeAllowlist({ toolBundles: ['read-only'], toolExtras: [] });
    expect(list).toContain('Read');
    expect(list).toContain('Grep');
  });

  it('merges extras with bundle tools', () => {
    const list = computeAllowlist({ toolBundles: ['read-only'], toolExtras: ['Bash'] });
    expect(list).toContain('Bash');
  });

  it('deduplicates tools that appear in multiple bundles', () => {
    const list = computeAllowlist({ toolBundles: ['read-only', 'read-write'], toolExtras: [] });
    const reads = list.filter((t) => t === 'Read');
    expect(reads).toHaveLength(1);
  });

  it('returns empty list for empty bundles and extras', () => {
    const list = computeAllowlist({ toolBundles: [], toolExtras: [] });
    expect(list).toHaveLength(0);
  });
});

// ─── workspace sandbox ────────────────────────────────────────────────────────

describe('writeWorkspaceSandbox', () => {
  it('writes .claude/settings.json with denylist rules', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sandbox-test-'));
    try {
      writeWorkspaceSandbox(dir);
      const raw = readFileSync(join(dir, '.claude', 'settings.json'), 'utf8');
      const cfg = JSON.parse(raw) as { permissions: { deny: string[] } };
      expect(cfg.permissions.deny).toContain('Read(./.env*)');
      expect(cfg.permissions.deny).toContain('Bash(sudo *)');
      expect(cfg.permissions.deny).toContain('Bash(rm -rf *)');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('is idempotent — calling twice does not throw', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sandbox-idem-'));
    try {
      writeWorkspaceSandbox(dir);
      expect(() => writeWorkspaceSandbox(dir)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('registers PostToolUse hook in workspace settings.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sandbox-post-hook-'));
    try {
      writeWorkspaceSandbox(dir);
      const raw = readFileSync(join(dir, '.claude', 'settings.json'), 'utf8');
      const cfg = JSON.parse(raw) as { hooks?: { PostToolUse?: unknown[] } };
      expect(cfg.hooks?.PostToolUse).toBeDefined();
      expect(Array.isArray(cfg.hooks?.PostToolUse)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
