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
import { isAbsolute, relative, resolve } from 'path';
const require = createRequire(import.meta.url);

const allowlist = (process.env.FACTORY_RUN_ALLOWLIST ?? '').split(',').filter(Boolean);
const runId = process.env.FACTORY_RUN_ID ?? 'unknown';
const workspaceDir = process.env.FACTORY_WORKSPACE_DIR ?? '';
const allowedSecondaryWorkspaces = (process.env.FACTORY_ALLOWED_SECONDARY_WORKSPACES ?? '')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);
// FACTORY_SERVER_PORT is set by ClaudeCliRuntime when spawning the agent
// subprocess (#209). Falls back to 3001 for backwards compatibility.
const serverPort = process.env.FACTORY_SERVER_PORT ?? '3001';

/** Returns v when it is a plain non-null object, else undefined. */
function asObj(v) {
  return (v != null && typeof v === 'object' && !Array.isArray(v)) ? v : undefined;
}

const pathScopedTools = new Set(['Read', 'Glob', 'Grep']);
const absoluteUserPathRe = /\\/Users\\/[^\\s'"\\\`]+/g;

function normalizeRoots(paths) {
  return paths
    .filter((path) => typeof path === 'string' && path.trim().length > 0)
    .map((path) => resolve(path));
}

function isUnderAnyRoot(target, roots) {
  return roots.some((root) => {
    const rel = relative(root, target);
    return rel === '' || (rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel));
  });
}

function requestedPath(toolInput) {
  const value = toolInput.file_path ?? toolInput.path ?? toolInput.cwd;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function bashCommand(toolInput) {
  const value = toolInput.command ?? toolInput.cmd;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function canonicalToolName(toolName) {
  if (toolName === 'mcp__factory-tools__repo_intel_query') {
    return 'mcp__factory-tools__repo_intel.query';
  }
  if (toolName === 'repo_intel_query') {
    return 'repo_intel.query';
  }
  return toolName;
}

function denyHookResponse(reason) {
  return {
    decision: 'block',
    reason,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

function workspaceBoundaryDecision(toolName, toolInput) {
  const roots = normalizeRoots([workspaceDir, ...allowedSecondaryWorkspaces]);
  if (roots.length === 0) return null;

  if (pathScopedTools.has(toolName)) {
    const path = requestedPath(toolInput);
    if (path != null) {
      const normalized = isAbsolute(path) ? resolve(path) : resolve(roots[0], path);
      if (!isUnderAnyRoot(normalized, roots)) {
        return \`Tool '\${toolName}' path escapes workspace: \${path}\`;
      }
    }
  }

  if (toolName === 'Bash') {
    const command = bashCommand(toolInput);
    if (command != null) {
      for (const absolutePath of command.match(absoluteUserPathRe) ?? []) {
        const normalized = resolve(absolutePath);
        if (!isUnderAnyRoot(normalized, roots)) {
          return \`Bash command references path outside workspace: \${absolutePath}\`;
        }
      }
    }
  }

  return null;
}

async function emitToolCallAudit(toolName, toolInput, extra = {}) {
  try {
    const payload = {
      tool_name: toolName,
      run_id: runId,
      tool_input: toolInput,
      workspace_dir: workspaceDir,
      ...extra,
    };
    await fetch(\`http://localhost:\${serverPort}/events/tool-call\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(500),
    }).catch(() => {});
  } catch { /* best-effort */ }
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let call;
  try { call = JSON.parse(input); } catch { process.exit(0); }

  // Normalise Codex hook aliases → canonical CC shape.
  const rawToolName = call?.tool_name ?? call?.name ?? '';
  const displayToolName =
    rawToolName === 'command_execution' || rawToolName === 'bash' ? 'Bash' : rawToolName;
  const toolName = canonicalToolName(displayToolName);
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
      const reason = \`tool not in allowlist: \${toolName}\`;
      await emitToolCallAudit(toolName, toolInput, {
        blocked: true,
        block_reason: reason,
      });
      const msg = JSON.stringify(denyHookResponse(reason));
      process.stdout.write(msg);
      process.exit(0);
    }
  }

  const boundaryReason = workspaceBoundaryDecision(toolName, toolInput);
  if (boundaryReason != null) {
    await emitToolCallAudit(toolName, toolInput, {
      blocked: true,
      block_reason: boundaryReason,
    });
    const msg = JSON.stringify(denyHookResponse(boundaryReason));
    process.stdout.write(msg);
    process.exit(0);
  }

  // Emit tool-call audit event via HTTP to local event endpoint
  // (best-effort; hook failure must not block tool execution)
  await emitToolCallAudit(toolName, toolInput);

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
