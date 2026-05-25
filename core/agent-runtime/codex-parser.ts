import { costFromCliEnvelope } from '../cost/extract.js';

export interface CodexEnvelope {
  result: string | null;
  isError: boolean;
  errorDetail: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    reasoningOutputTokens: number;
    costUsd: number | null;
  };
  numTurns: number | null;
}

export interface CodexToolCall {
  toolName: string;
  toolInput: Record<string, unknown>;
}

export interface CodexAssistantMessage {
  id: string | null;
  text: string;
  terminal: boolean;
}

/**
 * If `obj` is a Codex transport event of the form
 * `{"type":"item.completed","item":{"type":"agent_message","text":"..."}}`,
 * returns the inner assistant text. Returns null for all other shapes.
 * Exported for unit testing.
 */
export function pickCodexAgentMessageText(obj: Record<string, unknown>): string | null {
  if (obj.type !== 'item.completed' || typeof obj.item !== 'object' || obj.item === null) {
    return null;
  }
  const item = obj.item as Record<string, unknown>;
  if (!isAssistantItem(item)) return null;
  return pickAssistantText(item);
}

export function pickCodexAssistantMessage(
  obj: Record<string, unknown>,
): CodexAssistantMessage | null {
  if (!isAssistantMessageEvent(obj.type) || typeof obj.item !== 'object' || obj.item === null) {
    return null;
  }
  const item = obj.item as Record<string, unknown>;
  if (!isAssistantItem(item)) return null;
  const text = pickAssistantText(item);
  if (text == null || text.length === 0) return null;
  return {
    id: typeof item.id === 'string' ? item.id : null,
    text,
    terminal: obj.type === 'item.completed',
  };
}

/**
 * If `obj` is a Codex transport event for tool execution, returns the canonical
 * tool-call shape used by Goose Hub timeline events. Today Codex exposes shell
 * execution as `command_execution`, which corresponds to Claude Code's `Bash`.
 */
export function pickCodexToolCall(obj: Record<string, unknown>): CodexToolCall | null {
  if (obj.type !== 'item.started' || typeof obj.item !== 'object' || obj.item === null) {
    return null;
  }
  const item = obj.item as Record<string, unknown>;
  if (item.type !== 'command_execution') return null;
  const command = typeof item.command === 'string' ? item.command : null;
  if (command == null || command.length === 0) return null;
  return { toolName: 'Bash', toolInput: { command } };
}

/**
 * Best-effort parser for the `codex exec --json` output. Codex emits either
 * a single JSON envelope or a stream of newline-delimited events terminating
 * in a final summary; we accept either. Field aliases probed in order.
 *
 * Returns `null` when stdout is not parseable as JSON at all — the caller
 * surfaces that as a typed runtime error.
 */
export function parseCodexEnvelope(stdout: string): CodexEnvelope | null {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return null;

  // Try a single JSON envelope first.
  let envelope: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed != null && typeof parsed === 'object') {
      const candidate = parsed as Record<string, unknown>;
      // Unwrap Codex transport events so they never reach the skill schema validator.
      const agentText = pickCodexAgentMessageText(candidate);
      envelope = agentText != null ? { result: agentText } : candidate;
    }
  } catch {
    /* not a single envelope — try NDJSON */
  }

  // NDJSON: scan all events to collect both the terminal envelope (for cost/usage)
  // and any Codex API agent_message text (for the actual result content).
  // These may arrive in different events, so we do a single full pass without
  // breaking early, then merge.
  if (envelope == null) {
    const lines = trimmed.split(/\r?\n/).filter((l) => l.length > 0);
    let terminalEnvelope: Record<string, unknown> | null = null;
    let agentMessageText: string | null = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]) as unknown;
        if (parsed != null && typeof parsed === 'object') {
          const candidate = parsed as Record<string, unknown>;
          // Collect the last terminal event for cost/usage fields.
          if (
            terminalEnvelope == null &&
            ('result' in candidate ||
              'output' in candidate ||
              'usage' in candidate ||
              'error' in candidate)
          ) {
            terminalEnvelope = candidate;
          }
          // Codex API streaming format: item.completed with agent_message carries the result.
          if (agentMessageText == null) {
            const agentText = pickCodexAgentMessageText(candidate);
            if (agentText != null) agentMessageText = agentText;
          }
        }
      } catch {
        /* non-JSON line — ignore */
      }
    }
    if (agentMessageText != null) {
      // Merge: agent_message provides the result; terminal event provides usage/cost.
      envelope = { ...terminalEnvelope, result: agentMessageText };
    } else if (terminalEnvelope != null) {
      envelope = terminalEnvelope;
    }
  }

  if (envelope == null) return null;

  const result =
    pickString(envelope, ['result', 'output', 'text']) ??
    pickString(envelope, ['final_message', 'finalMessage']) ??
    null;

  const errorField = envelope.error;
  let isError = false;
  let errorDetail: string | null = null;
  if (typeof errorField === 'string' && errorField.length > 0) {
    isError = true;
    errorDetail = errorField;
  } else if (typeof errorField === 'boolean') {
    isError = errorField;
  } else if (errorField != null && typeof errorField === 'object') {
    isError = true;
    const obj = errorField as Record<string, unknown>;
    errorDetail =
      pickString(obj, ['message', 'detail', 'reason']) ?? JSON.stringify(errorField).slice(0, 800);
  }

  // Cost extraction reuses the existing alias-probing logic. costFromCliEnvelope
  // returns costUsd:0 when tokens are present but no cost field exists — that's
  // indistinguishable from a true $0 result. We check for an explicit cost field
  // ourselves so the caller can apply pricing fallback when costUsd is null.
  const rawCost = costFromCliEnvelope(envelope);
  const hasExplicitCostField =
    typeof envelope.total_cost_usd === 'number' ||
    typeof envelope.cost_usd === 'number' ||
    typeof envelope.cost === 'number';
  const resolvedCostUsd: number | null = hasExplicitCostField ? (rawCost?.costUsd ?? null) : null;

  const numTurns = pickNumber(envelope, ['num_turns', 'turns']);

  return {
    result,
    isError,
    errorDetail,
    usage: {
      inputTokens: rawCost?.inputTokens ?? 0,
      outputTokens: rawCost?.outputTokens ?? 0,
      cachedInputTokens: rawCost?.cachedInputTokens ?? 0,
      reasoningOutputTokens: rawCost?.reasoningOutputTokens ?? 0,
      costUsd: resolvedCostUsd,
    },
    numTurns,
  };
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string') return v;
  }
  return null;
}

function isAssistantMessageEvent(type: unknown): boolean {
  return type === 'item.updated' || type === 'item.completed';
}

function isAssistantItem(item: Record<string, unknown>): boolean {
  if (item.type === 'agent_message' || item.type === 'assistant_message') return true;
  return item.type === 'message' && item.role === 'assistant';
}

function pickAssistantText(item: Record<string, unknown>): string | null {
  const direct = pickString(item, ['text', 'content', 'message']);
  if (direct != null) return direct;
  if (Array.isArray(item.content)) {
    const parts = item.content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part != null && typeof part === 'object') {
          const obj = part as Record<string, unknown>;
          return pickString(obj, ['text', 'content']);
        }
        return null;
      })
      .filter((part): part is string => part != null);
    if (parts.length > 0) return parts.join('');
  }
  return null;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * Extracts the JSON value the agent returned. Mirrors the Claude runtime's
 * `extractResultJson` — handles bare JSON, markdown-fenced blocks, [decision]-prefixed
 * output, and falls back to the raw string so the schema validator surfaces a clear type error.
 * Exported for unit testing.
 */
export function extractResultJson(text: string, runId: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    /* continue */
  }
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match?.[1]) {
    try {
      return JSON.parse(match[1].trim());
    } catch {
      /* continue */
    }
  }
  // Strip [decision] marker lines emitted before the JSON object and retry.
  const stripped = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('[decision]'))
    .join('\n')
    .trim();
  if (stripped !== text.trim()) {
    try {
      return JSON.parse(stripped);
    } catch {
      /* continue */
    }
  }
  // Last resort: extract the outermost {...} block.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      /* continue */
    }
  }
  const preview = text.slice(0, 800);
  console.error(
    `[agent-runtime] extractResultJson (codex) fallback to raw string runId=${runId} preview=${JSON.stringify(preview)}`,
  );
  return text;
}
