import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Resolve hook paths relative to this file
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const REQUIRE_SPEC = join(REPO_ROOT, 'hooks', 'require-spec.sh');
const STOP_VERIFY_AC = join(REPO_ROOT, 'hooks', 'stop-verify-ac.sh');

function runRequireSpec(
  tool: string,
  filePath: string,
  env: Record<string, string> = {},
  cwd = REPO_ROOT,
) {
  const input = JSON.stringify({ tool_name: tool, tool_input: { file_path: filePath } });
  return spawnSync('bash', [REQUIRE_SPEC], {
    input,
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function runStopVerifyAc(env: Record<string, string> = {}, cwd = REPO_ROOT) {
  return spawnSync('bash', [STOP_VERIFY_AC], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

describe('require-spec.sh', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'require-spec-test-'));
    mkdirSync(join(tmpDir, 'slices'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('allows non-Edit/Write tools unconditionally', () => {
    const result = runRequireSpec('Read', '/any/file.ts', { FACTORY_RUN_ID: 'test-run' }, tmpDir);
    expect(result.status).toBe(0);
  });

  it('allows when FACTORY_RUN_ALLOWLIST is set (read-only/triage skip)', () => {
    const result = runRequireSpec(
      'Edit',
      '/some/code.ts',
      { FACTORY_RUN_ID: 'test-run', FACTORY_RUN_ALLOWLIST: 'read-only' },
      tmpDir,
    );
    expect(result.status).toBe(0);
  });

  it('allows spec files themselves (allowlist pattern)', () => {
    const result = runRequireSpec(
      'Write',
      'slices/test-run/spec.ts',
      { FACTORY_RUN_ID: 'test-run' },
      tmpDir,
    );
    expect(result.status).toBe(0);
  });

  it('allows docs/ paths', () => {
    const result = runRequireSpec('Edit', 'docs/PLAN.md', { FACTORY_RUN_ID: 'test-run' }, tmpDir);
    expect(result.status).toBe(0);
  });

  it('allows README.md paths', () => {
    const result = runRequireSpec(
      'Write',
      'slices/my-slice/README.md',
      { FACTORY_RUN_ID: 'test-run' },
      tmpDir,
    );
    expect(result.status).toBe(0);
  });

  it('allows when no FACTORY_RUN_ID (backwards compat)', () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k, v]) => k !== 'FACTORY_RUN_ID' && v !== undefined),
    ) as Record<string, string>;
    const result = runRequireSpec('Edit', 'core/foo.ts', env, tmpDir);
    expect(result.status).toBe(0);
  });

  it('allows Edit when spec.ts exists for run', () => {
    const runId = 'my-feature';
    mkdirSync(join(tmpDir, 'slices', runId), { recursive: true });
    writeFileSync(join(tmpDir, 'slices', runId, 'spec.ts'), '// spec\n');

    const result = runRequireSpec('Edit', 'core/foo.ts', { FACTORY_RUN_ID: runId }, tmpDir);
    expect(result.status).toBe(0);
  });

  it('allows Edit when spec.json exists for run', () => {
    const runId = 'my-feature';
    mkdirSync(join(tmpDir, 'slices', runId), { recursive: true });
    writeFileSync(join(tmpDir, 'slices', runId, 'spec.json'), '{}');

    const result = runRequireSpec('Edit', 'core/foo.ts', { FACTORY_RUN_ID: runId }, tmpDir);
    expect(result.status).toBe(0);
  });

  it('denies Edit when no spec exists for run', () => {
    const result = runRequireSpec(
      'Edit',
      'core/foo.ts',
      { FACTORY_RUN_ID: 'missing-spec-run' },
      tmpDir,
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Plan-first gate');
    expect(result.stderr).toContain('missing-spec-run');
  });

  it('denies Write when no spec exists for run', () => {
    const result = runRequireSpec(
      'Write',
      'apps/server/src/foo.ts',
      { FACTORY_RUN_ID: 'no-spec' },
      tmpDir,
    );
    expect(result.status).toBe(2);
  });
});

describe('stop-verify-ac.sh', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'stop-ac-test-'));
    mkdirSync(join(tmpDir, 'slices'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes when no FACTORY_RUN_ID set', () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k, v]) => k !== 'FACTORY_RUN_ID' && v !== undefined),
    ) as Record<string, string>;
    const result = runStopVerifyAc(env, tmpDir);
    expect(result.status).toBe(0);
  });

  it('passes when no spec file present for run', () => {
    const result = runStopVerifyAc({ FACTORY_RUN_ID: 'no-spec-run' }, tmpDir);
    expect(result.status).toBe(0);
  });

  it('passes when all ACs are checked [x]', () => {
    const runId = 'checked-run';
    mkdirSync(join(tmpDir, 'slices', runId), { recursive: true });
    writeFileSync(
      join(tmpDir, 'slices', runId, 'spec.ts'),
      '// - [x] First AC\n// - [x] Second AC\n',
    );
    const result = runStopVerifyAc({ FACTORY_RUN_ID: runId }, tmpDir);
    expect(result.status).toBe(0);
  });

  it('denies when unchecked [ ] ACs remain', () => {
    const runId = 'unchecked-run';
    mkdirSync(join(tmpDir, 'slices', runId), { recursive: true });
    writeFileSync(
      join(tmpDir, 'slices', runId, 'spec.ts'),
      '// - [x] Done\n// - [ ] Not done yet\n',
    );
    const result = runStopVerifyAc({ FACTORY_RUN_ID: runId }, tmpDir);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('AC-completeness gate');
    expect(result.stderr).toContain('1 unchecked AC');
  });

  it('denies when multiple unchecked ACs remain', () => {
    const runId = 'many-unchecked';
    mkdirSync(join(tmpDir, 'slices', runId), { recursive: true });
    writeFileSync(
      join(tmpDir, 'slices', runId, 'spec.ts'),
      '// - [ ] AC one\n// - [ ] AC two\n// - [ ] AC three\n',
    );
    const result = runStopVerifyAc({ FACTORY_RUN_ID: runId }, tmpDir);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('3 unchecked AC');
  });
});

describe('writeWorkspaceSandbox registers SDLC hooks', () => {
  it('REQUIRE_SPEC_HOOK_PATH and STOP_VERIFY_AC_HOOK_PATH are exported', async () => {
    const { REQUIRE_SPEC_HOOK_PATH, STOP_VERIFY_AC_HOOK_PATH } = await import(
      '@goose-hub/core/tool-layer/sandbox.js'
    );
    expect(typeof REQUIRE_SPEC_HOOK_PATH).toBe('string');
    expect(REQUIRE_SPEC_HOOK_PATH).toContain('require-spec.sh');
    expect(typeof STOP_VERIFY_AC_HOOK_PATH).toBe('string');
    expect(STOP_VERIFY_AC_HOOK_PATH).toContain('stop-verify-ac.sh');
  });

  it('writeWorkspaceSandbox includes require-spec PreToolUse hook', async () => {
    const { writeWorkspaceSandbox } = await import('@goose-hub/core/tool-layer/sandbox.js');
    const tmpDir = mkdtempSync(join(tmpdir(), 'sandbox-test-'));
    try {
      writeWorkspaceSandbox(tmpDir);
      const { readFileSync } = await import('node:fs');
      const settings = JSON.parse(readFileSync(join(tmpDir, '.claude', 'settings.local.json'), 'utf8'));
      const preHooks = settings.hooks?.PreToolUse ?? [];
      const requireSpecEntry = preHooks.find((h: { hooks?: Array<{ command?: string }> }) =>
        h.hooks?.some((cmd) => cmd.command?.includes('require-spec.sh')),
      );
      expect(requireSpecEntry).toBeDefined();
      expect(requireSpecEntry.matcher).toBe('Edit|Write');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('writeWorkspaceSandbox includes stop-verify-ac Stop hook', async () => {
    const { writeWorkspaceSandbox } = await import('@goose-hub/core/tool-layer/sandbox.js');
    const tmpDir = mkdtempSync(join(tmpdir(), 'sandbox-stop-test-'));
    try {
      writeWorkspaceSandbox(tmpDir);
      const { readFileSync } = await import('node:fs');
      const settings = JSON.parse(readFileSync(join(tmpDir, '.claude', 'settings.local.json'), 'utf8'));
      const stopHooks = settings.hooks?.Stop ?? [];
      const acEntry = stopHooks.find((h: { hooks?: Array<{ command?: string }> }) =>
        h.hooks?.some((cmd) => cmd.command?.includes('stop-verify-ac.sh')),
      );
      expect(acEntry).toBeDefined();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
