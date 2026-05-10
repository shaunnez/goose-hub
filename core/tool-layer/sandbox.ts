import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECISION_CAPTURE_HOOK_PATH } from './decision-capture-hook.js';
import { POST_HOOK_PATH } from './post-tool-use-hook.js';
import { HOOK_PATH } from './pre-tool-use-hook.js';

const DENYLIST = ['Read(./.env*)', 'Bash(sudo *)', 'Bash(rm -rf *)'];

// Deny list applied to WP builders: blocks all git mutations (ADR 0031, rule 37).
const WP_BUILDER_GIT_DENYLIST = [
  'Bash(git commit*)',
  'Bash(git add*)',
  'Bash(git push*)',
  'Bash(git checkout*)',
  'Bash(git reset*)',
  'Bash(git rebase*)',
  'Bash(git merge*)',
  'Bash(git worktree*)',
  'Bash(git branch*)',
];

// Absolute paths to SDLC shell hooks shipped with the repo (M11.16).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REQUIRE_SPEC_HOOK_PATH = join(REPO_ROOT, 'hooks', 'require-spec.sh');
export const STOP_VERIFY_AC_HOOK_PATH = join(REPO_ROOT, 'hooks', 'stop-verify-ac.sh');
export const WP_FILE_GUARD_HOOK_PATH = join(REPO_ROOT, 'hooks', 'wp-file-guard.sh');

// Roles that must NOT receive the decision-capture hook. Broader than HOLDOUT_ROLES
// (which is qa + reviewer) — code-quality-audit is also excluded because it functions
// like a holdout: its output must not be influenced by live-marker feedback loops.
export const DECISION_CAPTURE_EXCLUDED_ROLES = new Set(['qa', 'reviewer', 'code-quality-audit']);

export interface SandboxOptions {
  /** Role of the spawned agent. Used to determine if decision-capture hook is installed. */
  role?: string;
  /** When true, install the decision-capture PostToolUse hook (experimental.recordDecisionTool). */
  recordDecisionTool?: boolean;
}

function buildSettings(
  extraDenylist: string[] = [],
  extraPreToolUseHooks: object[] = [],
  extraPostToolUseHooks: object[] = [],
) {
  return JSON.stringify(
    {
      permissions: { deny: [...DENYLIST, ...extraDenylist] },
      hooks: {
        PreToolUse: [
          {
            matcher: '.*',
            // process.execPath is the absolute path to the node binary running
            // the server. Required because the agent subprocess gets a minimal
            // PATH that omits non-standard install locations (e.g. /opt/homebrew
            // on Apple Silicon), so bare `node` would not be found.
            hooks: [{ type: 'command', command: `"${process.execPath}" "${HOOK_PATH}"` }],
          },
          {
            matcher: 'Edit|Write',
            // Plan-first gate: deny edits when no spec artefact exists (M11.16).
            hooks: [{ type: 'command', command: `bash "${REQUIRE_SPEC_HOOK_PATH}"` }],
          },
          ...extraPreToolUseHooks,
        ],
        PostToolUse: [
          {
            matcher: '.*',
            hooks: [{ type: 'command', command: `"${process.execPath}" "${POST_HOOK_PATH}"` }],
          },
          ...extraPostToolUseHooks,
        ],
        Stop: [
          {
            // AC-completeness gate: deny stop when unchecked ACs remain (M11.16).
            hooks: [{ type: 'command', command: `bash "${STOP_VERIFY_AC_HOOK_PATH}"` }],
          },
        ],
      },
    },
    null,
    2,
  );
}

/** Writes workspace .claude/settings.local.json with deny rules and hook registrations. Idempotent. */
export function writeWorkspaceSandbox(workspacePath: string, opts: SandboxOptions = {}): void {
  const extraPostToolUseHooks: object[] = [];
  // Decision-capture hook: install only when flag is on AND role is not excluded.
  if (opts.recordDecisionTool && !DECISION_CAPTURE_EXCLUDED_ROLES.has(opts.role ?? '')) {
    extraPostToolUseHooks.push({
      matcher: '.*',
      hooks: [
        { type: 'command', command: `"${process.execPath}" "${DECISION_CAPTURE_HOOK_PATH}"` },
      ],
    });
  }
  const claudeDir = join(workspacePath, '.claude');
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(
    join(claudeDir, 'settings.local.json'),
    buildSettings([], [], extraPostToolUseHooks),
    'utf8',
  );
}

/**
 * Writes a WP builder sandbox — extends `writeWorkspaceSandbox` with:
 *   1. Hard-block on all git mutations (`Bash(git *)` patterns, ADR 0031 / rule 37).
 *   2. `wp-file-guard.sh` PreToolUse hook that denies Edit|Write outside `filesOwned`.
 *
 * The orchestrator sets `FACTORY_WP_FILESOWNED` and `FACTORY_WP_ID` env vars at spawn
 * time so the hook knows which files this builder is permitted to touch.
 *
 * @param workspacePath - Absolute path to the WP scratch worktree.
 * @param filesOwned    - Workspace-relative paths owned by this WP.
 * @param wpId          - Work Package identifier (for violation messages).
 * @param opts          - Optional sandbox options (role, recordDecisionTool flag).
 */
export function writeWpBuilderSandbox(
  workspacePath: string,
  _filesOwned: string[],
  _wpId: string,
  opts: SandboxOptions = {},
): void {
  const extraPreToolUseHooks = [
    {
      matcher: 'Edit|Write',
      hooks: [{ type: 'command', command: `bash "${WP_FILE_GUARD_HOOK_PATH}"` }],
    },
  ];
  const extraPostToolUseHooks: object[] = [];
  if (opts.recordDecisionTool && !DECISION_CAPTURE_EXCLUDED_ROLES.has(opts.role ?? '')) {
    extraPostToolUseHooks.push({
      matcher: '.*',
      hooks: [
        { type: 'command', command: `"${process.execPath}" "${DECISION_CAPTURE_HOOK_PATH}"` },
      ],
    });
  }
  const claudeDir = join(workspacePath, '.claude');
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(
    join(claudeDir, 'settings.local.json'),
    buildSettings(WP_BUILDER_GIT_DENYLIST, extraPreToolUseHooks, extraPostToolUseHooks),
    'utf8',
  );
}
