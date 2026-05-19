import { and, eq, gte } from 'drizzle-orm';
import { db } from '../db/db.js';
import { events, agentRunCosts } from '../db/schema.js';
import { recommendRuntimeProfile } from './recommendations.js';
import type {
  RuntimeProfilerEventRow,
  RuntimeProfilerMetrics,
  RuntimeProfilerReport,
  RuntimeProfilerRunRow,
  RuntimeSkillProfile,
} from './types.js';

export function profileRuntimeRows(input: {
  projectId: string;
  days: number;
  untilIso: string;
  runs: RuntimeProfilerRunRow[];
  events: RuntimeProfilerEventRow[];
  skill?: string;
}): RuntimeProfilerReport {
  const sinceIso = new Date(
    Date.parse(input.untilIso) - input.days * 24 * 60 * 60 * 1000,
  ).toISOString();
  const runs =
    input.skill == null ? input.runs : input.runs.filter((run) => run.skill === input.skill);
  const bySkill = new Map<string, RuntimeProfilerRunRow[]>();
  for (const run of runs) {
    const group = bySkill.get(run.skill) ?? [];
    group.push(run);
    bySkill.set(run.skill, group);
  }

  const skills: RuntimeSkillProfile[] = [...bySkill.entries()]
    .map(([skill, skillRuns]) => {
      const runIds = new Set(skillRuns.map((run) => run.runId));
      const skillEvents = input.events.filter(
        (event) => event.runId != null && runIds.has(event.runId),
      );
      const metrics = buildMetrics(skillRuns, skillEvents);
      return {
        skill,
        metrics,
        recommendations: recommendRuntimeProfile({ skill, metrics }),
      };
    })
    .sort((a, b) => b.metrics.p95CostUsd - a.metrics.p95CostUsd || a.skill.localeCompare(b.skill));

  return {
    projectId: input.projectId,
    window: { days: input.days, sinceIso, untilIso: input.untilIso },
    skills,
  };
}

export function profileRuntimeProject(input: {
  projectId: string;
  days?: number;
  skill?: string;
}): RuntimeProfilerReport {
  const days = clampDays(input.days);
  const untilIso = new Date().toISOString();
  const sinceIso = new Date(Date.parse(untilIso) - days * 24 * 60 * 60 * 1000).toISOString();
  const runs = db
    .select({
      runId: agentRunCosts.runId,
      projectId: agentRunCosts.projectId,
      skill: agentRunCosts.skill,
      inputTokens: agentRunCosts.inputTokens,
      outputTokens: agentRunCosts.outputTokens,
      costUsd: agentRunCosts.costUsd,
      createdAt: agentRunCosts.createdAt,
    })
    .from(agentRunCosts)
    .where(
      and(eq(agentRunCosts.projectId, input.projectId), gte(agentRunCosts.createdAt, sinceIso)),
    )
    .all();
  const eventRows = db
    .select({
      runId: events.runId,
      kind: events.kind,
      payload: events.payload,
      createdAt: events.createdAt,
    })
    .from(events)
    .where(and(eq(events.projectId, input.projectId), gte(events.createdAt, sinceIso)))
    .all()
    .map((event) => ({
      ...event,
      payload: parsePayload(event.payload),
    }));

  return profileRuntimeRows({
    projectId: input.projectId,
    days,
    untilIso,
    runs,
    events: eventRows,
    skill: input.skill,
  });
}

function buildMetrics(
  runs: RuntimeProfilerRunRow[],
  eventsForRuns: RuntimeProfilerEventRow[],
): RuntimeProfilerMetrics {
  const runCount = runs.length;
  const inputTokens = runs.map((run) => run.inputTokens);
  const outputTokens = runs.map((run) => run.outputTokens);
  const costs = runs.map((run) => run.costUsd);
  const maxRun = [...runs].sort((a, b) => b.costUsd - a.costUsd)[0] ?? null;
  const timeoutRuns = new Set<string>();
  const budgetRuns = new Set<string>();
  const schemaRuns = new Set<string>();
  const toolCounts = new Map<string, number>();
  const bashCommands = new Map<string, number>();
  const sequencesByRun = new Map<string, string[]>();

  for (const event of eventsForRuns) {
    if (event.runId == null) continue;
    const payload = payloadRecord(event.payload);
    if (event.kind === 'tool.timeout' || String(payload.reason ?? '').includes('timeout')) {
      timeoutRuns.add(event.runId);
    }
    if (event.kind === 'agent.budget-exceeded') {
      budgetRuns.add(event.runId);
    }
    if (
      event.kind === 'agent.retry-escalated' ||
      event.kind === 'agent.output-repaired' ||
      String(payload.reason ?? '')
        .toLowerCase()
        .includes('schema')
    ) {
      schemaRuns.add(event.runId);
    }
    if (event.kind === 'agent.tool-call') {
      const toolName = toolNameFromPayload(payload);
      toolCounts.set(toolName, (toolCounts.get(toolName) ?? 0) + 1);
      const sequence = sequencesByRun.get(event.runId) ?? [];
      sequence.push(toolName);
      sequencesByRun.set(event.runId, sequence);
      if (toolName === 'Bash') {
        const command = normalizeCommand(commandFromToolPayload(payload));
        if (command !== '') bashCommands.set(command, (bashCommands.get(command) ?? 0) + 1);
      }
    }
  }

  return {
    runCount,
    medianInputTokens: percentile(inputTokens, 0.5),
    p95InputTokens: percentile(inputTokens, 0.95),
    medianOutputTokens: percentile(outputTokens, 0.5),
    p95OutputTokens: percentile(outputTokens, 0.95),
    medianCostUsd: percentile(costs, 0.5),
    p95CostUsd: percentile(costs, 0.95),
    maxCostOutlier: maxRun == null ? null : { runId: maxRun.runId, costUsd: maxRun.costUsd },
    timeoutRate: rate(timeoutRuns.size, runCount),
    budgetExceededRate: rate(budgetRuns.size, runCount),
    schemaValidationRetryRate: rate(schemaRuns.size, runCount),
    toolCallCount: [...toolCounts.values()].reduce((sum, count) => sum + count, 0),
    topToolNames: topEntries(toolCounts, 5).map(([name, count]) => ({ name, count })),
    repeatedBashCommands: topEntries(bashCommands, 5)
      .filter(([, count]) => count > 1)
      .map(([command, count]) => ({ command, count })),
    commonCommandSequences: commonSequences(sequencesByRun),
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[index] ?? 0;
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

function topEntries(map: Map<string, number>, limit: number): Array<[string, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

function commonSequences(
  sequencesByRun: Map<string, string[]>,
): Array<{ sequence: string[]; count: number }> {
  const counts = new Map<string, { sequence: string[]; count: number }>();
  for (const sequence of sequencesByRun.values()) {
    if (sequence.length < 2) continue;
    const compact = sequence.slice(0, 6);
    const key = compact.join('\u001f');
    const current = counts.get(key) ?? { sequence: compact, count: 0 };
    current.count += 1;
    counts.set(key, current);
  }
  return [...counts.values()]
    .filter((entry) => entry.count > 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

function toolNameFromPayload(payload: Record<string, unknown>): string {
  const raw = payload.tool_name ?? payload.toolName ?? payload.name;
  return typeof raw === 'string' && raw !== '' ? raw : 'unknown';
}

function commandFromToolPayload(payload: Record<string, unknown>): unknown {
  const toolInput = payloadRecord(payload.tool_input ?? payload.toolInput);
  return (
    toolInput.command ??
    toolInput.cmd ??
    payload.command ??
    payload.redacted_tool_input ??
    payload.input
  );
}

function normalizeCommand(value: unknown): string {
  const raw = typeof value === 'string' ? value : value != null ? JSON.stringify(value) : '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  return payload != null && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function parsePayload(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return {};
  }
}

function clampDays(days: number | undefined): number {
  if (days == null || !Number.isFinite(days)) return 14;
  return Math.min(90, Math.max(1, Math.trunc(days)));
}
