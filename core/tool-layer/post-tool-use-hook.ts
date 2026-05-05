import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

  // Live-marker grammar: \`[decision] KIND: <one-sentence summary>\`
  // (#466). KIND must be uppercase A-Z and underscores; the server validates
  // it against the canonical enum and coerces unknown values to UNKNOWN.
  // Spacing after the colon is tolerant (\\s*) so a missing space doesn't
  // silently drop the marker.
  const DECISION_TYPED_RE = /^\\[decision\\]\\s+([A-Z_]+):\\s*(.+)$/gm;
  // Backward-compat: legacy marker with no kind prefix → forwarded as UNKNOWN.
  // Negative lookahead matches the typed form; if the typed form starts but
  // is malformed (e.g. lowercase, mixed case, no colon), it falls through here.
  const DECISION_LEGACY_RE = /^\\[decision\\]\\s+(?![A-Z_]+:)(.+)$/gm;

  const markers = [];
  let m;
  while ((m = DECISION_TYPED_RE.exec(newContent)) !== null) {
    markers.push({ kind: m[1].trim(), summary: m[2].trim() });
  }
  while ((m = DECISION_LEGACY_RE.exec(newContent)) !== null) {
    markers.push({ kind: 'UNKNOWN', summary: m[1].trim() });
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
