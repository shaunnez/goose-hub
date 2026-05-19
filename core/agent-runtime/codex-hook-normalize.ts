/**
 * Normalises a raw Codex CLI hook event to the canonical CC (Claude Code)
 * PreToolUse / PostToolUse shape so the audit stream is homogeneous across
 * providers.
 *
 * Claude Code hook protocol (canonical):
 *   PreToolUse  → { tool_name: string, tool_input: object, ... }
 *   PostToolUse → { tool_name: string, tool_response: { output?: string, error?: string }, transcript_path?: string, ... }
 *
 * Codex CLI hook protocol (aliased keys):
 *   PreToolUse  → { name: string, parameters | arguments | input: object, ... }
 *   PostToolUse → { name: string, output?: string, error?: string, transcript_path?: string, ... }
 *
 * Priority rules (canonical wins when both are present):
 *   tool_name  > name
 *   tool_input > parameters > arguments > input
 *   tool_response > { output, error } reconstruction
 */
export interface NormalizedHookEvent {
  /** Canonical tool name, e.g. "Read", "Bash", "bash". */
  tool_name: string;
  /** Canonical input object. Present only on PreToolUse events. */
  tool_input?: Record<string, unknown>;
  /** Canonical response object. Present only on PostToolUse events. */
  tool_response?: { output: string; error: string };
  /** Transcript path forwarded from both Claude and Codex PostToolUse events. */
  transcript_path?: string;
}

function asObject(v: unknown): Record<string, unknown> | undefined {
  if (v != null && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return undefined;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Pure mapping from a raw hook stdin payload (either Claude or Codex format)
 * to the canonical {@link NormalizedHookEvent} shape.
 *
 * Safe to call with any unknown object — never throws.
 */
export function normalizeCodexHookEvent(raw: Record<string, unknown>): NormalizedHookEvent {
  // ── tool_name resolution ──────────────────────────────────────────────────
  const rawToolName = asString(raw.tool_name) || asString(raw.name);
  const tool_name =
    rawToolName === 'command_execution' || rawToolName === 'bash' ? 'Bash' : rawToolName;

  // ── transcript_path pass-through ─────────────────────────────────────────
  const transcript_path = typeof raw.transcript_path === 'string' ? raw.transcript_path : undefined;

  // ── tool_input (PreToolUse) ───────────────────────────────────────────────
  // Canonical: tool_input. Codex aliases: parameters, arguments, input.
  const rawInput =
    asObject(raw.tool_input) ??
    asObject(raw.parameters) ??
    asObject(raw.arguments) ??
    asObject(raw.input);

  // ── tool_response (PostToolUse) ───────────────────────────────────────────
  // Canonical: tool_response (object with output/error). Codex: top-level
  // output / error strings.
  const canonicalResponse = asObject(raw.tool_response);
  const hasRawOutputOrError =
    raw.output !== undefined || (raw.error !== undefined && raw.error !== null);

  let tool_response: NormalizedHookEvent['tool_response'];
  if (canonicalResponse !== undefined) {
    // Already in canonical shape — pass through (Claude origin or previously normalised).
    tool_response = {
      output: asString(canonicalResponse.output),
      error: asString(canonicalResponse.error),
    };
  } else if (hasRawOutputOrError) {
    // Codex PostToolUse: reconstruct tool_response from top-level fields.
    tool_response = {
      output: asString(raw.output),
      error: asString(raw.error),
    };
  }

  // ── Build result ─────────────────────────────────────────────────────────
  // Omit undefined keys so consumers can use `key in event` reliably.
  const result: NormalizedHookEvent = { tool_name };
  if (transcript_path !== undefined) result.transcript_path = transcript_path;
  if (rawInput !== undefined && tool_response === undefined) {
    // PreToolUse: input present, no response.
    result.tool_input = rawInput;
  } else if (rawInput !== undefined && tool_response !== undefined) {
    // Both present (shouldn't happen in practice, but be safe).
    result.tool_input = rawInput;
    result.tool_response = tool_response;
  } else if (tool_response !== undefined) {
    result.tool_response = tool_response;
  } else if (rawInput !== undefined) {
    result.tool_input = rawInput;
  }

  return result;
}
