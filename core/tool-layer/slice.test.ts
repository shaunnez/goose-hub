import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOL_BUNDLES, computeAllowlist } from './allowlist.js';
import {
  DECISION_CAPTURE_EXCLUDED_ROLES,
  writeCodexWorkspaceSandbox,
  writeWorkspaceSandbox,
  writeWpBuilderSandbox,
} from './sandbox.js';
import { redactSecrets } from './secret-redaction.js';
import { bindToolsForAgentSpec } from './tool-binding.js';
import { evaluateWorkspaceBoundary } from './workspace-boundary.js';

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
  it('read / dev-tools / qa-tools / validate / core are defined', () => {
    expect(TOOL_BUNDLES.core).toBeDefined();
    expect(TOOL_BUNDLES.read).toBeDefined();
    expect(TOOL_BUNDLES['dev-tools']).toBeDefined();
    expect(TOOL_BUNDLES['qa-tools']).toBeDefined();
    expect(TOOL_BUNDLES.validate).toBeDefined();
  });

  // ─── Phase 5b (ADR 0045): native-tool cutover — bundles are factory-tools only ─

  it('read bundle includes factory-tools context + read + git/diff families', () => {
    expect(TOOL_BUNDLES.read).toContain('mcp__factory-tools__read_file');
    expect(TOOL_BUNDLES.read).toContain('mcp__factory-tools__search_text');
    expect(TOOL_BUNDLES.read).toContain('mcp__factory-tools__get_project_context');
    expect(TOOL_BUNDLES.read).toContain('mcp__factory-tools__get_diff');
  });

  it('dev-tools bundle includes factory-tools read + write + verify families', () => {
    expect(TOOL_BUNDLES['dev-tools']).toContain('mcp__factory-tools__write_file');
    expect(TOOL_BUNDLES['dev-tools']).toContain('mcp__factory-tools__edit_file');
    expect(TOOL_BUNDLES['dev-tools']).toContain('mcp__factory-tools__run_tests');
    expect(TOOL_BUNDLES['dev-tools']).toContain('mcp__factory-tools__record_decision');
  });

  it('qa-tools bundle includes factory-tools read + git/diff + qa families', () => {
    expect(TOOL_BUNDLES['qa-tools']).toContain('mcp__factory-tools__get_diff');
    expect(TOOL_BUNDLES['qa-tools']).toContain('mcp__factory-tools__get_pr_diff');
    expect(TOOL_BUNDLES['qa-tools']).toContain('mcp__factory-tools__run_isolated_test');
    expect(TOOL_BUNDLES['qa-tools']).toContain('mcp__factory-tools__get_verification_summary');
    expect(TOOL_BUNDLES['qa-tools']).toContain('mcp__factory-tools__check_acceptance_criteria');
  });

  it('qa-tools bundle does not include any factory-tools write tools (holdout discipline)', () => {
    for (const name of TOOL_BUNDLES['qa-tools']) {
      expect(name.startsWith('mcp__factory-tools__write_')).toBe(false);
      expect(name.startsWith('mcp__factory-tools__edit_')).toBe(false);
      expect(name.startsWith('mcp__factory-tools__apply_patch')).toBe(false);
      expect(name.startsWith('mcp__factory-tools__delete_file')).toBe(false);
    }
  });

  it('validate bundle includes factory-tools evidence family', () => {
    expect(TOOL_BUNDLES.validate).toContain('mcp__factory-tools__get_app_url');
    expect(TOOL_BUNDLES.validate).toContain('mcp__factory-tools__write_playwright_spec');
    expect(TOOL_BUNDLES.validate).toContain('mcp__factory-tools__run_playwright_spec');
    expect(TOOL_BUNDLES.validate).toContain('mcp__factory-tools__collect_evidence');
  });

  it('agent-facing bundles contain ONLY mcp__ tool names (no native Read/Write/Edit/Glob/Grep/Bash)', () => {
    const AGENT_BUNDLES = ['read', 'dev-tools', 'qa-tools', 'validate'] as const;
    const FORBIDDEN = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];
    for (const bundle of AGENT_BUNDLES) {
      for (const tool of TOOL_BUNDLES[bundle]) {
        expect(FORBIDDEN.includes(tool), `Bundle '${bundle}' must not contain native ${tool}`).toBe(
          false,
        );
        expect(
          tool === 'Bash' || tool.startsWith('Bash('),
          `Bundle '${bundle}' must not contain native Bash entry '${tool}'`,
        ).toBe(false);
      }
    }
  });

  it('no bundle exposes factory-tools workflow-owned mutations (stage/commit/PR/transition)', () => {
    const WORKFLOW_OWNED = [
      'mcp__factory-tools__stage_changes',
      'mcp__factory-tools__commit_changes',
      'mcp__factory-tools__open_pr',
      'mcp__factory-tools__update_pr',
      'mcp__factory-tools__post_issue_comment',
      'mcp__factory-tools__transition_state',
      'mcp__factory-tools__publish_evidence',
    ];
    for (const [name, tools] of Object.entries(TOOL_BUNDLES)) {
      for (const tool of WORKFLOW_OWNED) {
        expect(
          tools.includes(tool),
          `Bundle '${name}' must not include workflow-owned ${tool}`,
        ).toBe(false);
      }
    }
  });

  it('emergency-debug bundle is defined but no skill declares it by default', () => {
    expect(TOOL_BUNDLES['emergency-debug']).toEqual(['Bash']);
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
    const list = computeAllowlist({ toolBundles: ['read'], toolExtras: [] });
    expect(list).toContain('mcp__factory-tools__read_file');
    expect(list).toContain('mcp__factory-tools__search_text');
  });

  it('merges extras with bundle tools', () => {
    const list = computeAllowlist({
      toolBundles: ['read'],
      toolExtras: ['mcp__factory-tools__run_tests'],
    });
    expect(list).toContain('mcp__factory-tools__run_tests');
  });

  it('deduplicates tools that appear in multiple bundles', () => {
    const list = computeAllowlist({ toolBundles: ['read', 'dev-tools'], toolExtras: [] });
    const reads = list.filter((t) => t === 'mcp__factory-tools__read_file');
    expect(reads).toHaveLength(1);
  });

  it('returns empty list for empty bundles and extras', () => {
    const list = computeAllowlist({ toolBundles: [], toolExtras: [] });
    expect(list).toHaveLength(0);
  });

  it('keeps MCP record_decision in read bundles for live decision signaling', () => {
    const list = computeAllowlist({ toolBundles: ['read'], toolExtras: [] });
    expect(list).toContain('mcp__factory-tools__record_decision');
  });

  it('ignores unknown bundle names', () => {
    const list = computeAllowlist({ toolBundles: ['unknown-bundle'], toolExtras: [] });
    expect(list).toEqual([]);
  });
});

describe('bindToolsForAgentSpec', () => {
  it('builds a single binding artifact for read-only runs', () => {
    const binding = bindToolsForAgentSpec({
      toolBundles: ['read'],
      toolExtras: [],
      role: 'investigator',
      skill: 'investigate',
    });

    expect(binding.allowlist).toContain('mcp__factory-tools__read_file');
    expect(binding.allowlist).toContain('mcp__factory-tools__get_diff');
    expect(binding.enabledToolsByServer['factory-tools']).toContain('read_file');
    expect(binding.enabledToolsByServer['factory-tools']).toContain('get_diff');
    expect(binding.nativeTools).toEqual([]);
    expect(binding.mcpServerBundles).toEqual([]);
    expect(binding.sandboxMode).toBe('read-only');
  });

  it('binds dev-tools to workspace-write without native Bash', () => {
    const binding = bindToolsForAgentSpec({
      toolBundles: ['dev-tools'],
      toolExtras: [],
      role: 'developer',
      skill: 'implement',
    });

    expect(binding.allowlist).toContain('mcp__factory-tools__write_file');
    expect(binding.allowlist).toContain('mcp__factory-tools__run_tests');
    expect(binding.nativeTools).toEqual([]);
    expect(binding.sandboxMode).toBe('workspace-write');
  });

  it('binds evidence validation browser skills to danger-full-access and never approval', () => {
    const binding = bindToolsForAgentSpec({
      toolBundles: ['validate'],
      toolExtras: [],
      role: 'developer',
      skill: 'playwright-repro',
    });

    expect(binding.sandboxMode).toBe('danger-full-access');
    expect(binding.approvalPolicy).toBe('never');
  });

  it('keeps QA validate-like bundles read-only unless the skill needs browser process access', () => {
    const binding = bindToolsForAgentSpec({
      toolBundles: ['read', 'validate'],
      toolExtras: [],
      role: 'qa',
      skill: 'qa',
    });

    expect(binding.sandboxMode).toBe('read-only');
    expect(binding.approvalPolicy).toBeUndefined();
  });

  it('adds optional MCP server bundles separately from the flat allowlist', () => {
    const binding = bindToolsForAgentSpec({
      toolBundles: ['read', 'playwright-mcp'],
      toolExtras: [],
      role: 'developer',
      skill: 'spec-author',
    });

    expect(binding.mcpServerBundles).toEqual(['playwright-mcp']);
    expect(binding.enabledToolsByServer['playwright-test']).toContain('browser_navigate');
    expect(binding.allowlist).toContain('mcp__playwright-test__browser_navigate');
  });

  it('keeps MCP record_decision available to QA holdouts', () => {
    const binding = bindToolsForAgentSpec({
      toolBundles: ['read', 'qa-tools'],
      toolExtras: [],
      role: 'qa',
      skill: 'qa',
    });

    expect(binding.allowlist).toContain('mcp__factory-tools__record_decision');
    expect(binding.enabledToolsByServer['factory-tools']).toContain('record_decision');
  });

  it('keeps MCP record_decision available to reviewer holdouts', () => {
    const binding = bindToolsForAgentSpec({
      toolBundles: ['read', 'validate'],
      toolExtras: [],
      role: 'reviewer',
      skill: 'review',
    });

    expect(binding.allowlist).toContain('mcp__factory-tools__record_decision');
    expect(binding.enabledToolsByServer['factory-tools']).toContain('record_decision');
  });

  it('strips holdout-blocked capabilities from holdout roles', () => {
    const binding = bindToolsForAgentSpec({
      toolBundles: ['emergency-debug'],
      toolExtras: ['mcp__factory-tools__write_file'],
      role: 'reviewer',
      skill: 'review',
    });

    expect(binding.allowlist).toEqual([]);
    expect(binding.nativeTools).toEqual([]);
    expect(binding.sandboxMode).toBe('read-only');
  });

  it('normalizes bundle order before fingerprinting equivalent bindings', () => {
    const first = bindToolsForAgentSpec({
      toolBundles: ['read', 'qa-tools'],
      toolExtras: [],
      role: 'qa',
      skill: 'qa',
    });
    const second = bindToolsForAgentSpec({
      toolBundles: ['qa-tools', 'read'],
      toolExtras: [],
      role: 'qa',
      skill: 'qa',
    });

    expect(first.allowlist).toEqual(second.allowlist);
    expect(first.fingerprints.toolBindingHash).toBe(second.fingerprints.toolBindingHash);
    expect(first.fingerprints.toolAllowlistHash).toBe(second.fingerprints.toolAllowlistHash);
    expect(first.fingerprints.mcpServerSetHash).toBe(second.fingerprints.mcpServerSetHash);
  });
});

// ─── workspace boundary guard ────────────────────────────────────────────────

describe('evaluateWorkspaceBoundary', () => {
  it('blocks Read paths outside workspaceDir', () => {
    const decision = evaluateWorkspaceBoundary({
      toolName: 'Read',
      toolInput: { file_path: '/Users/shaunnesbitt/projects/goose-hub/core/types.ts' },
      workspaceDir: '/tmp/factory-worktree',
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('escapes workspace');
  });

  it('allows Read paths inside workspaceDir after normalization', () => {
    const decision = evaluateWorkspaceBoundary({
      toolName: 'Read',
      toolInput: { file_path: 'core/types.ts' },
      workspaceDir: '/tmp/factory-worktree',
    });

    expect(decision.allowed).toBe(true);
  });

  it('blocks Bash commands that reference obvious absolute repo escapes', () => {
    const decision = evaluateWorkspaceBoundary({
      toolName: 'Bash',
      toolInput: { command: 'rg runOneScout /Users/shaunnesbitt/projects/goose-hub' },
      workspaceDir: '/tmp/factory-worktree',
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('outside workspace');
  });

  it('allows explicitly configured secondary workspaces', () => {
    const decision = evaluateWorkspaceBoundary({
      toolName: 'Read',
      toolInput: { file_path: '/Users/shaunnesbitt/projects/goose-hub/evidence/out.png' },
      workspaceDir: '/tmp/factory-worktree',
      allowedSecondaryWorkspaces: ['/Users/shaunnesbitt/projects/goose-hub/evidence'],
    });

    expect(decision.allowed).toBe(true);
  });
});

// ─── workspace sandbox ────────────────────────────────────────────────────────

describe('writeWorkspaceSandbox', () => {
  it('writes .claude/settings.local.json with denylist rules', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sandbox-test-'));
    try {
      writeWorkspaceSandbox(dir);
      const raw = readFileSync(join(dir, '.claude', 'settings.local.json'), 'utf8');
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

  it('registers PostToolUse hook in workspace settings.local.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sandbox-post-hook-'));
    try {
      writeWorkspaceSandbox(dir);
      const raw = readFileSync(join(dir, '.claude', 'settings.local.json'), 'utf8');
      const cfg = JSON.parse(raw) as { hooks?: { PostToolUse?: unknown[] } };
      expect(cfg.hooks?.PostToolUse).toBeDefined();
      expect(Array.isArray(cfg.hooks?.PostToolUse)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe('writeCodexWorkspaceSandbox', () => {
  it('writes .codex/hooks.json with a broad Factory PreToolUse hook', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-sandbox-test-'));
    try {
      writeCodexWorkspaceSandbox(dir);
      const raw = readFileSync(join(dir, '.codex', 'hooks.json'), 'utf8');
      const cfg = JSON.parse(raw) as {
        hooks?: { PreToolUse?: Array<{ matcher?: string; hooks?: Array<{ command?: string }> }> };
      };
      const preHook = cfg.hooks?.PreToolUse?.find((entry) =>
        entry.hooks?.some((hook) => hook.command?.includes('pre-tool-use.js')),
      );
      expect(preHook).toBeDefined();
      expect(preHook?.matcher).toBe('.*');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

// ─── WP builder sandbox content ──────────────────────────────────────────────

describe('writeWpBuilderSandbox', () => {
  type Settings = {
    permissions: { deny: string[] };
    hooks: {
      PreToolUse: Array<{ matcher: string; hooks: Array<{ command: string }> }>;
      PostToolUse: Array<{ matcher: string; hooks: Array<{ command: string }> }>;
      Stop?: unknown[];
    };
  };

  function readSettings(dir: string): Settings {
    const raw = readFileSync(join(dir, '.claude', 'settings.local.json'), 'utf8');
    return JSON.parse(raw) as Settings;
  }

  it('writes git mutation denylist entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wp-sandbox-git-'));
    try {
      writeWpBuilderSandbox(dir, ['src/foo.ts'], 'WP1');
      const cfg = readSettings(dir);
      expect(cfg.permissions.deny).toContain('Bash(git commit*)');
      expect(cfg.permissions.deny).toContain('Bash(git add*)');
      expect(cfg.permissions.deny).toContain('Bash(git push*)');
      expect(cfg.permissions.deny).toContain('Bash(git reset*)');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('includes base denylist entries alongside WP git denylist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wp-sandbox-base-'));
    try {
      writeWpBuilderSandbox(dir, ['src/foo.ts'], 'WP1');
      const cfg = readSettings(dir);
      expect(cfg.permissions.deny).toContain('Read(./.env*)');
      expect(cfg.permissions.deny).toContain('Bash(sudo *)');
      expect(cfg.permissions.deny).toContain('Bash(rm -rf *)');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('registers wp-file-guard.sh as a PreToolUse hook on Edit|Write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wp-sandbox-guard-'));
    try {
      writeWpBuilderSandbox(dir, ['src/foo.ts'], 'WP1');
      const cfg = readSettings(dir);
      const guardEntry = cfg.hooks.PreToolUse.find((e) =>
        e.hooks.some((h) => h.command.includes('wp-file-guard.sh')),
      );
      expect(guardEntry).toBeDefined();
      expect(guardEntry?.matcher).toBe('Edit|Write');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('registers standard pre-tool-use hook on all tools', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wp-sandbox-pre-'));
    try {
      writeWpBuilderSandbox(dir, ['src/foo.ts'], 'WP1');
      const cfg = readSettings(dir);
      const stdHook = cfg.hooks.PreToolUse.find((e) =>
        e.hooks.some((h) => h.command.includes('pre-tool-use')),
      );
      expect(stdHook).toBeDefined();
      expect(stdHook?.matcher).toBe('.*');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('registers standard post-tool-use hook', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wp-sandbox-post-'));
    try {
      writeWpBuilderSandbox(dir, ['src/foo.ts'], 'WP1');
      const cfg = readSettings(dir);
      expect(Array.isArray(cfg.hooks.PostToolUse)).toBe(true);
      expect(cfg.hooks.PostToolUse.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('includes WP bash drift denylist entries (pipes, chaining, dep mutation)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wp-sandbox-bash-'));
    try {
      writeWpBuilderSandbox(dir, ['src/foo.ts'], 'WP1');
      const cfg = readSettings(dir);
      expect(cfg.permissions.deny).toContain('Bash(* | *)');
      expect(cfg.permissions.deny).toContain('Bash(* && *)');
      expect(cfg.permissions.deny).toContain('Bash(* ; *)');
      expect(cfg.permissions.deny).toContain('Bash(* > *)');
      expect(cfg.permissions.deny).toContain('Bash(pnpm install*)');
      expect(cfg.permissions.deny).toContain('Bash(npm install*)');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

// ─── decision-capture hook (M19.23) ──────────────────────────────────────────

describe('decision-capture hook installation', () => {
  function readSettings(dir: string) {
    const raw = readFileSync(join(dir, '.claude', 'settings.local.json'), 'utf8');
    return JSON.parse(raw) as {
      hooks?: { PostToolUse?: Array<{ hooks: Array<{ command: string }> }> };
    };
  }

  function hasDecisionCaptureHook(cfg: ReturnType<typeof readSettings>): boolean {
    return (cfg.hooks?.PostToolUse ?? []).some((entry) =>
      entry.hooks?.some((h) => h.command?.includes('decision-capture.js')),
    );
  }

  it('installs decision-capture hook when flag=true and role is non-holdout', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sandbox-dc-on-'));
    try {
      writeWorkspaceSandbox(dir, { role: 'developer', recordDecisionTool: true });
      expect(hasDecisionCaptureHook(readSettings(dir))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('does NOT install decision-capture hook when flag=false', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sandbox-dc-off-'));
    try {
      writeWorkspaceSandbox(dir, { role: 'developer', recordDecisionTool: false });
      expect(hasDecisionCaptureHook(readSettings(dir))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('does NOT install decision-capture hook for qa role even when flag=true', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sandbox-dc-qa-'));
    try {
      writeWorkspaceSandbox(dir, { role: 'qa', recordDecisionTool: true });
      expect(hasDecisionCaptureHook(readSettings(dir))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('does NOT install decision-capture hook for reviewer role even when flag=true', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sandbox-dc-reviewer-'));
    try {
      writeWorkspaceSandbox(dir, { role: 'reviewer', recordDecisionTool: true });
      expect(hasDecisionCaptureHook(readSettings(dir))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('does NOT install decision-capture hook for code-quality-audit role even when flag=true', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sandbox-dc-audit-'));
    try {
      writeWorkspaceSandbox(dir, { role: 'code-quality-audit', recordDecisionTool: true });
      expect(hasDecisionCaptureHook(readSettings(dir))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('DECISION_CAPTURE_EXCLUDED_ROLES contains qa, reviewer, code-quality-audit', () => {
    expect(DECISION_CAPTURE_EXCLUDED_ROLES.has('qa')).toBe(true);
    expect(DECISION_CAPTURE_EXCLUDED_ROLES.has('reviewer')).toBe(true);
    expect(DECISION_CAPTURE_EXCLUDED_ROLES.has('code-quality-audit')).toBe(true);
    expect(DECISION_CAPTURE_EXCLUDED_ROLES.has('developer')).toBe(false);
  });
});
