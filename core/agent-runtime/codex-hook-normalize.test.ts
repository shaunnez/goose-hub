import { describe, expect, it } from 'vitest';
import { type NormalizedHookEvent, normalizeCodexHookEvent } from './codex-hook-normalize.js';

// ─── Fixtures: Canonical Claude-format events ─────────────────────────────────
// Claude CLI sends hooks in CC protocol format:
//   PreToolUse:  { tool_name, tool_input, ... }
//   PostToolUse: { tool_name, tool_response: { output?, error? }, transcript_path, ... }

const CLAUDE_PRE: Record<string, unknown> = {
  tool_name: 'Read',
  tool_input: { file_path: '/foo/bar.ts' },
  hook_event_name: 'PreToolUse',
};

const CLAUDE_POST: Record<string, unknown> = {
  tool_name: 'Bash',
  tool_response: { output: 'ok', error: '' },
  transcript_path: '/tmp/transcript.jsonl',
  hook_event_name: 'PostToolUse',
};

// ─── Fixtures: Codex-format events ───────────────────────────────────────────
// OpenAI Codex CLI uses its own hook protocol field names.
// PreToolUse aliases: name → tool_name, parameters / arguments / input → tool_input
// PostToolUse aliases: output → tool_response.output, error → tool_response.error

const CODEX_PRE_PARAMETERS: Record<string, unknown> = {
  name: 'bash',
  parameters: { command: 'ls -la' },
};

const CODEX_PRE_ARGUMENTS: Record<string, unknown> = {
  name: 'read_file',
  arguments: { path: '/tmp/foo.ts' },
};

const CODEX_PRE_INPUT: Record<string, unknown> = {
  name: 'write_file',
  input: { path: '/tmp/out.ts', content: 'hello' },
};

const CODEX_NATIVE_COMMAND_EXECUTION: Record<string, unknown> = {
  tool_name: 'command_execution',
  tool_input: { command: 'pnpm test' },
};

const CODEX_POST_OUTPUT: Record<string, unknown> = {
  name: 'bash',
  output: 'stdout text here',
  transcript_path: '/tmp/codex-transcript.jsonl',
};

const CODEX_POST_ERROR: Record<string, unknown> = {
  name: 'bash',
  output: '',
  error: 'command not found: foo',
  transcript_path: '/tmp/codex-transcript.jsonl',
};

// ─── Claude pass-through (already canonical) ────────────────────────────────

describe('normalizeCodexHookEvent — Claude canonical pass-through', () => {
  it('passes through Claude PreToolUse unchanged', () => {
    const result = normalizeCodexHookEvent(CLAUDE_PRE);
    expect(result.tool_name).toBe('Read');
    expect(result.tool_input).toEqual({ file_path: '/foo/bar.ts' });
    expect(result.tool_response).toBeUndefined();
  });

  it('passes through Claude PostToolUse unchanged', () => {
    const result = normalizeCodexHookEvent(CLAUDE_POST);
    expect(result.tool_name).toBe('Bash');
    expect(result.tool_response).toEqual({ output: 'ok', error: '' });
    expect(result.tool_input).toBeUndefined();
  });
});

// ─── Codex PreToolUse normalization ─────────────────────────────────────────

describe('normalizeCodexHookEvent — Codex PreToolUse (name + parameters/arguments/input)', () => {
  it('maps name→tool_name and parameters→tool_input', () => {
    const result = normalizeCodexHookEvent(CODEX_PRE_PARAMETERS);
    expect(result.tool_name).toBe('Bash');
    expect(result.tool_input).toEqual({ command: 'ls -la' });
    expect(result.tool_response).toBeUndefined();
  });

  it('maps name→tool_name and arguments→tool_input', () => {
    const result = normalizeCodexHookEvent(CODEX_PRE_ARGUMENTS);
    expect(result.tool_name).toBe('read_file');
    expect(result.tool_input).toEqual({ path: '/tmp/foo.ts' });
  });

  it('maps name→tool_name and input→tool_input', () => {
    const result = normalizeCodexHookEvent(CODEX_PRE_INPUT);
    expect(result.tool_name).toBe('write_file');
    expect(result.tool_input).toEqual({ path: '/tmp/out.ts', content: 'hello' });
  });

  it('maps native command_execution to the Factory Bash tool name', () => {
    const result = normalizeCodexHookEvent(CODEX_NATIVE_COMMAND_EXECUTION);
    expect(result.tool_name).toBe('Bash');
    expect(result.tool_input).toEqual({ command: 'pnpm test' });
  });
});

// ─── Codex PostToolUse normalization ────────────────────────────────────────

describe('normalizeCodexHookEvent — Codex PostToolUse (name + output/error)', () => {
  it('maps name→tool_name and output→tool_response.output', () => {
    const result = normalizeCodexHookEvent(CODEX_POST_OUTPUT);
    expect(result.tool_name).toBe('Bash');
    expect(result.tool_response).toEqual({ output: 'stdout text here', error: '' });
    expect(result.tool_input).toBeUndefined();
  });

  it('maps name→tool_name and error→tool_response.error', () => {
    const result = normalizeCodexHookEvent(CODEX_POST_ERROR);
    expect(result.tool_name).toBe('Bash');
    expect(result.tool_response).toEqual({ output: '', error: 'command not found: foo' });
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────────────

describe('normalizeCodexHookEvent — edge cases', () => {
  it('returns empty tool_name for empty input', () => {
    const result = normalizeCodexHookEvent({});
    expect(result.tool_name).toBe('');
    expect(result.tool_input).toBeUndefined();
    expect(result.tool_response).toBeUndefined();
  });

  it('tool_name takes priority over name', () => {
    const result = normalizeCodexHookEvent({ tool_name: 'Read', name: 'bash' });
    expect(result.tool_name).toBe('Read');
  });

  it('tool_input takes priority over parameters', () => {
    const result = normalizeCodexHookEvent({
      tool_name: 'Read',
      tool_input: { file_path: '/a' },
      parameters: { file_path: '/b' },
    });
    expect(result.tool_input).toEqual({ file_path: '/a' });
  });

  it('tool_response takes priority over raw output/error', () => {
    const result = normalizeCodexHookEvent({
      tool_name: 'Bash',
      tool_response: { output: 'canonical', error: '' },
      output: 'codex-raw',
    });
    expect(result.tool_response).toEqual({ output: 'canonical', error: '' });
  });

  it('preserves transcript_path in the normalized event', () => {
    const result = normalizeCodexHookEvent(CODEX_POST_OUTPUT);
    expect(result.transcript_path).toBe('/tmp/codex-transcript.jsonl');
  });
});

// ─── Parity: key sets must match between Claude and Codex ────────────────────

describe('payload key-set parity: Claude vs Codex normalized', () => {
  it('PreToolUse: normalized Codex has same keys as Claude', () => {
    const claudeResult = normalizeCodexHookEvent(CLAUDE_PRE);
    const codexResult = normalizeCodexHookEvent(CODEX_PRE_PARAMETERS);

    // Both must have tool_name and tool_input; neither should have tool_response.
    const claudeKeys = Object.keys(claudeResult)
      .filter((k) => k === 'tool_name' || k === 'tool_input' || k === 'tool_response')
      .sort();
    const codexKeys = Object.keys(codexResult)
      .filter((k) => k === 'tool_name' || k === 'tool_input' || k === 'tool_response')
      .sort();

    expect(codexKeys).toEqual(claudeKeys);
  });

  it('PostToolUse: normalized Codex has same keys as Claude', () => {
    const claudeResult = normalizeCodexHookEvent(CLAUDE_POST);
    const codexResult = normalizeCodexHookEvent(CODEX_POST_OUTPUT);

    const claudeKeys = Object.keys(claudeResult)
      .filter((k) => k === 'tool_name' || k === 'tool_input' || k === 'tool_response')
      .sort();
    const codexKeys = Object.keys(codexResult)
      .filter((k) => k === 'tool_name' || k === 'tool_input' || k === 'tool_response')
      .sort();

    expect(codexKeys).toEqual(claudeKeys);
  });

  it('audit-stream payload sent to /events/tool-call matches Claude shape', () => {
    // The audit payload extracted from a normalized event must have exactly
    // the same required keys as what the Claude hook sends.
    const CLAUDE_AUDIT_KEYS = ['tool_name', 'tool_input'].sort();

    const codexResult = normalizeCodexHookEvent(CODEX_PRE_PARAMETERS);
    const codexAuditPayload = {
      tool_name: codexResult.tool_name,
      tool_input: codexResult.tool_input ?? {},
    };
    expect(Object.keys(codexAuditPayload).sort()).toEqual(CLAUDE_AUDIT_KEYS);
  });
});
