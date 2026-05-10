import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { deployPostHook } from './post-tool-use-hook.js';

const HOOKS_DIR = join(homedir(), '.factory', 'hooks');

const HOOK_SCRIPT = `#!/usr/bin/env node
/**
 * Factory PreToolUse hook — allowlist enforcement + tool-call audit.
 * Deployed by AgentRuntime to ~/.factory/hooks/pre-tool-use.js
 * Receives tool call via CC hook protocol on stdin as JSON.
 *
 * Normalises Codex CLI field aliases so the audit payload is homogeneous
 * across providers (Claude and Codex both emit tool_name + tool_input):
 *   tool_name : call.tool_name ?? call.name
 *   tool_input: call.tool_input ?? call.parameters ?? call.arguments ?? call.input ?? {}
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const allowlist = (process.env.FACTORY_RUN_ALLOWLIST ?? '').split(',').filter(Boolean);
const runId = process.env.FACTORY_RUN_ID ?? 'unknown';
// FACTORY_SERVER_PORT is set by ClaudeCliRuntime when spawning the agent
// subprocess (#209). Falls back to 3001 for backwards compatibility.
const serverPort = process.env.FACTORY_SERVER_PORT ?? '3001';

/** Returns v when it is a plain non-null object, else undefined. */
function asObj(v) {
  return (v != null && typeof v === 'object' && !Array.isArray(v)) ? v : undefined;
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let call;
  try { call = JSON.parse(input); } catch { process.exit(0); }

  // Normalise Codex hook aliases → canonical CC shape.
  const toolName = call?.tool_name ?? call?.name ?? '';
  const toolInput =
    asObj(call?.tool_input) ??
    asObj(call?.parameters) ??
    asObj(call?.arguments) ??
    asObj(call?.input) ??
    {};

  // Allowlist check — deny on mismatch
  if (allowlist.length > 0) {
    const permitted = allowlist.some((entry) => {
      if (entry === toolName) return true;
      const prefix = entry.split('(')[0];
      return prefix === toolName;
    });
    if (!permitted) {
      const msg = JSON.stringify({ decision: 'block', reason: \`Tool '\${toolName}' not in allowlist\` });
      process.stdout.write(msg);
      process.exit(0);
    }
  }

  // Emit tool-call audit event via HTTP to local event endpoint
  // (best-effort; hook failure must not block tool execution)
  try {
    const payload = {
      tool_name: toolName,
      run_id: runId,
      tool_input: toolInput,
    };
    await fetch(\`http://localhost:\${serverPort}/events/tool-call\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(500),
    }).catch(() => {});
  } catch { /* best-effort */ }

  process.exit(0);
}

main().catch(() => process.exit(0));
`;

/** Writes both PreToolUse and PostToolUse hook scripts to ~/.factory/hooks/. Always overwrites to pick up changes. */
export function deployHooks(): void {
  mkdirSync(HOOKS_DIR, { recursive: true });
  const hookPath = join(HOOKS_DIR, 'pre-tool-use.js');
  writeFileSync(hookPath, HOOK_SCRIPT, { encoding: 'utf8', mode: 0o755 });
  // Required so Node loads the hooks as ESM (import syntax).
  writeFileSync(join(HOOKS_DIR, 'package.json'), '{"type":"module"}', 'utf8');
  deployPostHook();
}

export const HOOK_PATH = join(HOOKS_DIR, 'pre-tool-use.js');
