import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POST_HOOK_PATH } from './post-tool-use-hook.js';
import { HOOK_PATH } from './pre-tool-use-hook.js';

const DENYLIST = ['Read(./.env*)', 'Bash(sudo *)', 'Bash(rm -rf *)'];

// Absolute paths to SDLC shell hooks shipped with the repo (M11.16).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REQUIRE_SPEC_HOOK_PATH = join(REPO_ROOT, 'hooks', 'require-spec.sh');
export const STOP_VERIFY_AC_HOOK_PATH = join(REPO_ROOT, 'hooks', 'stop-verify-ac.sh');

/** Writes workspace .claude/settings.local.json with deny rules and hook registrations. Idempotent. */
export function writeWorkspaceSandbox(workspacePath: string): void {
  const settings = JSON.stringify(
    {
      permissions: { deny: DENYLIST },
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
  const claudeDir = join(workspacePath, '.claude');
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(join(claudeDir, 'settings.local.json'), settings, 'utf8');
}
