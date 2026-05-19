import { describe, expect, it } from 'vitest';
import {
  buildCodexArgv,
  extractResultJson,
  parseCodexEnvelope,
  pickCodexAgentMessageText,
  pickCodexAssistantMessage,
} from './codex-cli.js';

const RUN_ID = 'test-run-id';

// ─── buildCodexArgv ──────────────────────────────────────────────────────────

describe('buildCodexArgv', () => {
  it('places global approval policy before exec and sandbox mode after exec', () => {
    const argv = buildCodexArgv({
      model: 'gpt-5.4',
      workspaceDir: '/tmp/worktree',
      prompt: '<task></task>',
      commandSandbox: 'danger-full-access',
      approvalPolicy: 'never',
    });

    expect(argv).toEqual([
      '--ask-for-approval',
      'never',
      'exec',
      '--json',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--skip-git-repo-check',
      '--cd',
      '/tmp/worktree',
      '--model',
      'gpt-5.4',
      '--sandbox',
      'danger-full-access',
      '<task></task>',
    ]);
  });
});

// ─── parseCodexEnvelope ───────────────────────────────────────────────────────

describe('parseCodexEnvelope', () => {
  it('parses bare item.completed agent_message NDJSON', () => {
    const stdout = [
      JSON.stringify({ type: 'thread.started', thread_id: 'abc' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'item_0', type: 'agent_message', text: '{"type":"feature","priority":"p2"}' },
      }),
    ].join('\n');

    const envelope = parseCodexEnvelope(stdout);
    expect(envelope).not.toBeNull();
    expect(envelope?.result).toBe('{"type":"feature","priority":"p2"}');
  });

  it('still extracts agent_message text when a later usage-only event follows', () => {
    const stdout = [
      JSON.stringify({ type: 'thread.started', thread_id: 'abc' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'item_0', type: 'agent_message', text: '{"type":"bug","priority":"p1"}' },
      }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 50 } }),
    ].join('\n');

    const envelope = parseCodexEnvelope(stdout);
    expect(envelope).not.toBeNull();
    expect(envelope?.result).toBe('{"type":"bug","priority":"p1"}');
  });

  it('merges usage from terminal event into synthesized envelope', () => {
    const stdout = [
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: '{"x":1}' },
      }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 200, output_tokens: 80 } }),
    ].join('\n');

    const envelope = parseCodexEnvelope(stdout);
    expect(envelope?.result).toBe('{"x":1}');
    const usage = envelope?.usage as Record<string, unknown> | undefined;
    expect(usage).toBeDefined();
  });

  it('returns null when stdout is empty', () => {
    expect(parseCodexEnvelope('')).toBeNull();
  });

  it('falls back to conventional terminal event when no agent_message present', () => {
    const stdout = JSON.stringify({ result: '{"ok":true}', usage: {} });
    const envelope = parseCodexEnvelope(stdout);
    expect(envelope?.result).toBe('{"ok":true}');
  });

  it('single-object item.completed is unwrapped, not treated as skill result', () => {
    // Exact shape: Codex emits one event only (no NDJSON stream).
    const stdout = JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_0', type: 'agent_message', text: '{"type":"feature","priority":"p2"}' },
    });
    const envelope = parseCodexEnvelope(stdout);
    expect(envelope?.result).toBe('{"type":"feature","priority":"p2"}');
  });

  it('single-object non-transport event is accepted as conventional envelope', () => {
    const stdout = JSON.stringify({ result: '{"ok":true}' });
    const envelope = parseCodexEnvelope(stdout);
    expect(envelope?.result).toBe('{"ok":true}');
  });

  it('single-object transport event without agent_message does not synthesize a skill result', () => {
    const stdout = JSON.stringify({ type: 'thread.started', thread_id: 'abc' });
    const envelope = parseCodexEnvelope(stdout);
    expect(envelope).not.toBeNull();
    expect(envelope?.result).toBeNull();
  });

  it('does not synthesize final output from non-terminal assistant updates', () => {
    const stdout = JSON.stringify({
      type: 'item.updated',
      item: { id: 'item_0', type: 'agent_message', text: '{"partial":true}' },
    });
    const envelope = parseCodexEnvelope(stdout);
    expect(envelope).not.toBeNull();
    expect(envelope?.result).toBeNull();
  });

  it('leaves costUsd as null when no cost field is present in the envelope', () => {
    const stdout = [
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: '{"ok":true}' },
      }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 300, output_tokens: 120 } }),
    ].join('\n');

    const envelope = parseCodexEnvelope(stdout);
    expect(envelope).not.toBeNull();
    expect(envelope?.usage.inputTokens).toBe(300);
    expect(envelope?.usage.outputTokens).toBe(120);
    expect(envelope?.usage.costUsd).toBeNull();
  });
});

// ─── pickCodexAgentMessageText ────────────────────────────────────────────────

describe('pickCodexAgentMessageText', () => {
  it('extracts text from item.completed / agent_message', () => {
    const obj = {
      type: 'item.completed',
      item: { type: 'agent_message', text: '{"x":1}' },
    };
    expect(pickCodexAgentMessageText(obj)).toBe('{"x":1}');
  });

  it('returns null for thread.started transport event', () => {
    expect(pickCodexAgentMessageText({ type: 'thread.started', thread_id: 'abc' })).toBeNull();
  });

  it('returns null for non-terminal item.updated assistant text', () => {
    expect(
      pickCodexAgentMessageText({
        type: 'item.updated',
        item: { type: 'agent_message', text: '{"partial":true}' },
      }),
    ).toBeNull();
  });

  it('returns null for item.completed with non-agent_message item type', () => {
    const obj = { type: 'item.completed', item: { type: 'tool_call', text: '...' } };
    expect(pickCodexAgentMessageText(obj)).toBeNull();
  });

  it('returns null for arbitrary skill result object', () => {
    const obj = {
      type: 'feature',
      priority: 'p2',
      labels: [],
      reasoning: 'x',
      decisionSummaries: [],
    };
    expect(pickCodexAgentMessageText(obj)).toBeNull();
  });
});

// ─── pickCodexAssistantMessage ───────────────────────────────────────────────

describe('pickCodexAssistantMessage', () => {
  it('extracts reconstructed assistant text from item.updated for live parsing', () => {
    expect(
      pickCodexAssistantMessage({
        type: 'item.updated',
        item: { id: 'item_0', type: 'agent_message', text: '[decision] READ: Searching files' },
      }),
    ).toEqual({
      id: 'item_0',
      text: '[decision] READ: Searching files',
      terminal: false,
    });
  });

  it('ignores raw item.delta chunks', () => {
    expect(
      pickCodexAssistantMessage({
        type: 'item.delta',
        item: { id: 'item_0', type: 'agent_message', delta: '[decision] READ: partial' },
      }),
    ).toBeNull();
  });

  it('marks item.completed assistant text as terminal', () => {
    expect(
      pickCodexAssistantMessage({
        type: 'item.completed',
        item: { id: 'item_0', type: 'agent_message', text: '{"ok":true}' },
      }),
    ).toEqual({ id: 'item_0', text: '{"ok":true}', terminal: true });
  });
});

// ─── extractResultJson ────────────────────────────────────────────────────────

describe('extractResultJson', () => {
  it('parses bare JSON string', () => {
    const result = extractResultJson('{"type":"feature","priority":"p2"}', RUN_ID);
    expect(result).toEqual({ type: 'feature', priority: 'p2' });
  });

  it('parses single-line JSON after [decision] marker', () => {
    const text =
      '[decision] VERDICT: normal feature\n{"type":"feature","priority":"p2","labels":["ux"]}';
    const result = extractResultJson(text, RUN_ID);
    expect(result).toEqual({ type: 'feature', priority: 'p2', labels: ['ux'] });
  });

  it('parses pretty-printed JSON after [decision] marker', () => {
    const text = [
      '[decision] PLAN: classified as feature',
      '{',
      '  "type": "feature",',
      '  "priority": "p2",',
      '  "labels": ["api"]',
      '}',
    ].join('\n');
    const result = extractResultJson(text, RUN_ID);
    expect(result).toEqual({ type: 'feature', priority: 'p2', labels: ['api'] });
  });

  it('falls back to outermost brace extraction when JSON has leading noise', () => {
    const text = 'Some preamble text {"type":"chore","priority":"p3"} trailing';
    const result = extractResultJson(text, RUN_ID);
    expect(result).toEqual({ type: 'chore', priority: 'p3' });
  });

  it('returns raw string when text cannot be parsed as JSON', () => {
    const result = extractResultJson('not json at all', RUN_ID);
    expect(typeof result).toBe('string');
  });
});
