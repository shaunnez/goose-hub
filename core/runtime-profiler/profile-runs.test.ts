import { describe, expect, it } from 'vitest';
import { profileRuntimeRows } from './profile-runs.js';

describe('profileRuntimeRows', () => {
  it('aggregates token/cost percentiles and tool patterns by skill', () => {
    const report = profileRuntimeRows({
      projectId: 'p1',
      days: 14,
      untilIso: '2026-05-20T00:00:00.000Z',
      runs: [
        run('r1', 'qa', 100, 20, 0.1),
        run('r2', 'qa', 300, 50, 0.4),
        run('r3', 'qa', 200, 40, 0.2),
      ],
      events: [
        tool('r1', 'Bash', 'pnpm test'),
        tool('r1', 'Bash', 'pnpm test'),
        tool('r2', 'Bash', 'pnpm test'),
        tool('r2', 'Read'),
        { runId: 'r2', kind: 'tool.timeout', payload: {}, createdAt: '2026-05-19T00:00:00Z' },
      ],
    });

    const qa = report.skills[0];
    expect(qa?.skill).toBe('qa');
    expect(qa?.metrics.runCount).toBe(3);
    expect(qa?.metrics.medianInputTokens).toBe(200);
    expect(qa?.metrics.p95CostUsd).toBe(0.4);
    expect(qa?.metrics.timeoutRate).toBeCloseTo(1 / 3);
    expect(qa?.metrics.repeatedBashCommands[0]).toEqual({ command: 'pnpm test', count: 3 });
    expect(qa?.recommendations.some((rec) => rec.kind === 'workflow-helper')).toBe(true);
  });

  it('filters to a requested skill before producing recommendations', () => {
    const report = profileRuntimeRows({
      projectId: 'p1',
      days: 7,
      untilIso: '2026-05-20T00:00:00.000Z',
      skill: 'triage',
      runs: [run('r1', 'qa', 100, 20, 0.1), run('r2', 'triage', 50, 10, 0.01)],
      events: [tool('r1', 'Bash', 'pnpm test'), tool('r2', 'Read')],
    });

    expect(report.skills.map((entry) => entry.skill)).toEqual(['triage']);
  });
});

function run(
  runId: string,
  skill: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
) {
  return {
    runId,
    projectId: 'p1',
    skill,
    inputTokens,
    outputTokens,
    costUsd,
    createdAt: '2026-05-19T00:00:00Z',
  };
}

function tool(runId: string, toolName: string, command?: string) {
  return {
    runId,
    kind: 'agent.tool-call',
    payload: { tool_name: toolName, tool_input: command == null ? {} : { command } },
    createdAt: '2026-05-19T00:00:00Z',
  };
}
