import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOOKS_DIR = join(homedir(), '.factory', 'hooks');

/**
 * PostToolUse hook that captures [decision] KIND: what — why markers from the
 * agent transcript and POSTs them to /api/decisions for DB persistence.
 * Generated once to ~/.factory/hooks/ and referenced conditionally from workspace
 * settings.local.json (excluded for holdout roles). Gated on experimental.recordDecisionTool.
 *
 * Heuristic what/why split: splits on " — " (em-dash with spaces), " (because ",
 * or ". Why: ". If no separator found, what = full text, why = "(not specified)".
 * recordDecision() requires both fields.
 */
const HOOK_SCRIPT = `#!/usr/bin/env node
/**
 * Factory decision-capture PostToolUse hook.
 * Deployed by AgentRuntime to ~/.factory/hooks/decision-capture.js
 * Reads [decision] KIND: what — why markers and POSTs to /api/decisions.
 */
import { existsSync, mkdirSync, openSync, readSync, closeSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const runId = process.env.FACTORY_RUN_ID ?? 'unknown';
const projectId = process.env.FACTORY_PROJECT_ID ?? 'unknown';
const serverPort = process.env.FACTORY_SERVER_PORT ?? '3001';
const iteration = parseInt(process.env.FACTORY_ITERATION ?? '0', 10) || 0;
const phase = process.env.FACTORY_PHASE ?? '';
const CURSOR_DIR = join(homedir(), '.factory', 'hooks', 'state');

function splitWhatWhy(text) {
  // Try em-dash separator first (canonical per issue spec)
  const emDash = text.indexOf(' \\u2014 ');
  if (emDash !== -1) return { what: text.slice(0, emDash).trim(), why: text.slice(emDash + 3).trim() };
  // Try " (because "
  const because = text.indexOf(' (because ');
  if (because !== -1) return { what: text.slice(0, because).trim(), why: text.slice(because + 10).trim() };
  // Try ". Why: "
  const whyColon = text.indexOf('. Why: ');
  if (whyColon !== -1) return { what: text.slice(0, whyColon).trim(), why: text.slice(whyColon + 7).trim() };
  return { what: text.trim(), why: '(not specified)' };
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let call;
  try { call = JSON.parse(input); } catch { process.exit(0); }

  const transcriptPath = call?.transcript_path;
  if (typeof transcriptPath !== 'string' || transcriptPath.length === 0) process.exit(0);

  mkdirSync(CURSOR_DIR, { recursive: true });
  const cursorFile = join(CURSOR_DIR, \`dc-\${runId}.cursor\`);
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

  // Match typed decision markers: [decision] KIND: <text>
  const DECISION_RE = /^\\[decision\\]\\s+([A-Z_]+):\\s*(.+)$/gm;

  const markers = [];
  let m;
  while ((m = DECISION_RE.exec(newContent)) !== null) {
    markers.push({ kind: m[1].trim(), text: m[2].trim() });
  }

  if (markers.length === 0) process.exit(0);

  for (const { kind, text } of markers) {
    const { what, why } = splitWhatWhy(text);
    try {
      await fetch(\`http://localhost:\${serverPort}/api/decisions\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, projectId, kind, what, why, iteration, phase }),
        signal: AbortSignal.timeout(500),
      }).catch(() => {});
    } catch { /* best-effort */ }
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
`;

/** Writes the decision-capture PostToolUse hook to ~/.factory/hooks/. Idempotent. */
export function deployDecisionCaptureHook(): void {
  mkdirSync(HOOKS_DIR, { recursive: true });
  writeFileSync(join(HOOKS_DIR, 'decision-capture.js'), HOOK_SCRIPT, {
    encoding: 'utf8',
    mode: 0o755,
  });
}

export const DECISION_CAPTURE_HOOK_PATH = join(HOOKS_DIR, 'decision-capture.js');
