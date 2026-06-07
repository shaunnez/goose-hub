import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../event-stream/store.js';
import {
  analyzeGroundedOutputToolEvents,
  groundedOutputToolUseFailure,
} from './grounded-output-guard.js';

function toolEvent(toolName: string, payload: Record<string, unknown> = {}): AgentEvent {
  return {
    id: Math.floor(Math.random() * 10_000),
    projectId: 'goose-hub-self',
    workItemId: 'wi-1',
    kind: 'agent.tool-call',
    payload: {
      tool_name: toolName,
      status: 'ok',
      blocked: false,
      ...payload,
    },
    runId: 'run-1',
    personaId: null,
    createdAt: '2026-06-08T00:00:00.000Z',
  };
}

describe('grounded output tool guard', () => {
  it('counts successful Claude and Codex Factory tool calls', () => {
    const analysis = analyzeGroundedOutputToolEvents([
      toolEvent('mcp__factory-tools__read_file'),
      toolEvent('repo_intel.query'),
    ]);

    expect(analysis.successfulFactoryToolCallCount).toBe(2);
    expect(analysis.successfulRepoIntelCallCount).toBe(1);
  });

  it('treats failed resource probes as advisory noise, not Factory tool usage', () => {
    const analysis = analyzeGroundedOutputToolEvents([
      toolEvent('resources/list', { status: 'failed' }),
      toolEvent('resources/templates/list', { status: 'failed' }),
    ]);

    expect(analysis.advisoryResourceProbeFailureCount).toBe(2);
    expect(analysis.successfulFactoryToolCallCount).toBe(0);
    expect(groundedOutputToolUseFailure({ skill: 'spec-author', events: [] })?.reason).toBe(
      'factory-tools-not-used',
    );
  });

  it('does not fail non-grounded skills or explicit no-tool-safe runs', () => {
    expect(groundedOutputToolUseFailure({ skill: 'echo-test', events: [] })).toBeNull();
    expect(
      groundedOutputToolUseFailure({ skill: 'implement', events: [], noToolSafe: true }),
    ).toBeNull();
  });

  it('can skip audit-less unit-test stubs while still failing lifecycle-only runs', () => {
    expect(
      groundedOutputToolUseFailure({
        skill: 'implement-wp',
        events: [],
        allowMissingAudit: true,
      }),
    ).toBeNull();
    expect(
      groundedOutputToolUseFailure({
        skill: 'implement-wp',
        events: [
          {
            ...toolEvent('not-a-factory-tool'),
            kind: 'agent.run-completed',
            payload: { skill: 'implement-wp' },
          },
        ],
        allowMissingAudit: true,
      })?.reason,
    ).toBe('factory-tools-not-used');
  });
});
