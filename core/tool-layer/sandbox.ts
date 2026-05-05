import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { POST_HOOK_PATH } from './post-tool-use-hook.js';
import { HOOK_PATH } from './pre-tool-use-hook.js';

const DENYLIST = ['Read(./.env*)', 'Bash(sudo *)', 'Bash(rm -rf *)'];

/** Writes workspace .claude/settings.json with deny rules and PreToolUse hook registration. Idempotent. */
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
        ],
        PostToolUse: [
          {
            matcher: '.*',
            hooks: [{ type: 'command', command: `"${process.execPath}" "${POST_HOOK_PATH}"` }],
          },
        ],
      },
    },
    null,
    2,
  );
  const claudeDir = join(workspacePath, '.claude');
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(join(claudeDir, 'settings.json'), settings, 'utf8');
}
