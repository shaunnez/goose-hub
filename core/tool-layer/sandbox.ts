import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

function buildSettings(extraDenylist: string[] = [], extraPreToolUseHooks: object[] = []) {
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
export function writeWorkspaceSandbox(workspacePath: string): void {
  const claudeDir = join(workspacePath, '.claude');
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(join(claudeDir, 'settings.local.json'), buildSettings(), 'utf8');
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
 */
export function writeWpBuilderSandbox(
  workspacePath: string,
  _filesOwned: string[],
  _wpId: string,
): void {
  const extraPreToolUseHooks = [
    {
      matcher: 'Edit|Write',
      hooks: [{ type: 'command', command: `bash "${WP_FILE_GUARD_HOOK_PATH}"` }],
    },
  ];
  const claudeDir = join(workspacePath, '.claude');
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(
    join(claudeDir, 'settings.local.json'),
    buildSettings(WP_BUILDER_GIT_DENYLIST, extraPreToolUseHooks),
    'utf8',
  );
}
