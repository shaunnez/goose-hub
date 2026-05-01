import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DENYLIST = ['Read(./.env*)', 'Bash(sudo *)', 'Bash(rm -rf *)'];

const SETTINGS = JSON.stringify(
  { permissions: { deny: DENYLIST } },
  null,
  2,
);

/** Writes workspace .claude/settings.json with pattern-level deny rules. Idempotent. */
export function writeWorkspaceSandbox(workspacePath: string): void {
  const claudeDir = join(workspacePath, '.claude');
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(join(claudeDir, 'settings.json'), SETTINGS, 'utf8');
}
