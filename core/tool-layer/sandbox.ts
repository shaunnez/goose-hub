import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
            hooks: [{ type: 'command', command: `node ${HOOK_PATH}` }],
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
