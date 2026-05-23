import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DECISION_MARKER_RE_SOURCE } from '../agent-runtime/decision-markers.js';

const HOOKS_DIR = join(homedir(), '.factory', 'hooks');

const HOOK_SCRIPT = `#!/usr/bin/env node
/**
 * Factory PostToolUse hook — live [decision] marker forwarding.
 * Deployed by AgentRuntime to ~/.factory/hooks/post-tool-use.js
 * Receives hook event via CC hook protocol on stdin as JSON.
 */
import { existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const runId = process.env.FACTORY_RUN_ID ?? 'unknown';
const serverPort = process.env.FACTORY_SERVER_PORT ?? '3001';
const CURSOR_DIR = join(homedir(), '.factory', 'hooks', 'state');

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let call;
  try { call = JSON.parse(input); } catch { process.exit(0); }

  const transcriptPath = call?.transcript_path;
  if (typeof transcriptPath !== 'string' || transcriptPath.length === 0) process.exit(0);

  mkdirSync(CURSOR_DIR, { recursive: true });
  const cursorFile = join(CURSOR_DIR, \`\${runId}.cursor\`);
  let lastOffset = 0;
  if (existsSync(cursorFile)) {
    try { lastOffset = parseInt(readFileSync(cursorFile, 'utf8').trim(), 10) || 0; } catch {}
  }

  let newContent = '';
  try {
    const stat = statSync(transcriptPath);
    const fileSize = stat.size;
    if (fileSize <= lastOffset) process.exit(0);
    const fd = openSync(transcriptPath, 'r');
    const buffer = Buffer.allocUnsafe(fileSize - lastOffset);
    readSync(fd, buffer, 0, fileSize - lastOffset, lastOffset);
    closeSync(fd);
    newContent = buffer.toString('utf8');
    writeFileSync(cursorFile, String(fileSize), 'utf8');
  } catch { process.exit(0); }

  // Live-marker grammar (#466). Single combined regex so typed and legacy
  // markers are emitted in transcript order — splitting them across two
  // passes would re-order mixed-format chunks (typed before legacy regardless
  // of source position) and break timeline / retro sequence analysis.
  //
  //   [decision] KIND: <summary>   ← typed:  group 1 = KIND, group 2 = summary
  //   [decision] <free text>       ← legacy: group 3 = full summary, kind=UNKNOWN
  //
  // Spacing after the colon is tolerant (\\s*) so a missing space after the
  // colon doesn't silently drop the marker. KIND is uppercase A-Z and
  // underscores; the server validates it against the canonical enum and
  // coerces unknown values to UNKNOWN.
  const DECISION_RE = new RegExp(${JSON.stringify(DECISION_MARKER_RE_SOURCE)}, 'gm');

  const markers = [];
  let m;
  while ((m = DECISION_RE.exec(newContent)) !== null) {
    if (m[1] != null) {
      markers.push({ kind: m[1].trim(), summary: m[2].trim() });
    } else {
      markers.push({ kind: 'UNKNOWN', summary: m[3].trim() });
    }
  }

  // Bash error capture: emit agent.tool-result when tool returned an error.
  // Normalise Codex hook aliases → canonical CC PostToolUse shape:
  //   tool_name : call.tool_name ?? call.name
  //   tool_error: call.tool_response?.error ?? call.error
  const toolName = call?.tool_name ?? call?.name ?? '';
  const toolError =
    (call?.tool_response != null && typeof call.tool_response === 'object'
      ? call.tool_response?.error
      : undefined) ??
    (typeof call?.error === 'string' ? call.error : '') ??
    '';
  if (toolName === 'Bash' && typeof toolError === 'string' && toolError.length > 0) {
    const truncated = toolError.length > 2048;
    const errorText = truncated ? toolError.slice(0, 2048) : toolError;
    try {
      await fetch(\`http://localhost:\${serverPort}/events/tool-result\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_id: runId,
          tool_name: toolName,
          error: errorText,
          truncated,
          workspace_dir: process.env.FACTORY_WORKSPACE_DIR ?? '',
        }),
        signal: AbortSignal.timeout(500),
      }).catch(() => {});
    } catch { /* best-effort */ }
  }

  const duplicateNudge =
    call?.tool_response != null &&
    typeof call.tool_response === 'object' &&
    typeof call.tool_response?.duplicateNudge === 'string'
      ? call.tool_response.duplicateNudge
      : '';

  if (duplicateNudge.length > 0) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: duplicateNudge,
      },
    }));
  }

  if (markers.length === 0) process.exit(0);

  for (const { kind, summary } of markers) {
    try {
      await fetch(\`http://localhost:\${serverPort}/events/decision-summary\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: runId, kind, summary, timestamp: new Date().toISOString() }),
        signal: AbortSignal.timeout(500),
      }).catch(() => {});
    } catch { /* best-effort */ }
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
`;

/** Writes the PostToolUse hook script to ~/.factory/hooks/. Always overwrites to pick up changes. */
export function deployPostHook(): void {
  mkdirSync(HOOKS_DIR, { recursive: true });
  writeFileSync(join(HOOKS_DIR, 'post-tool-use.js'), HOOK_SCRIPT, {
    encoding: 'utf8',
    mode: 0o755,
  });
}

export const POST_HOOK_PATH = join(HOOKS_DIR, 'post-tool-use.js');
