import { eq } from 'drizzle-orm';
import {
  type CrossRunRetroOutput,
  CrossRunRetroOutputSchema,
} from '../../skills/retrospective-cross-run/schema.js';
import { resolveBudgets } from '../agent-runtime/budgets.js';
import { ClaudeCliRuntime } from '../agent-runtime/claude-cli.js';
import type { AgentRuntime } from '../agent-runtime/interface.js';
import { readPromptWithContext } from '../agent-runtime/read-prompt.js';
import { toJsonSchema } from '../agent-runtime/schema-bridge.js';
import { selectPersona } from '../agent-runtime/select-persona.js';
import { db } from '../db/db.js';
import { archivedLifecycles, decisionPatterns, playbooks } from '../db/schema.js';
import { eventStore } from '../event-stream/store.js';
import {
  computeCostBaselines,
  computeGateThresholds,
  fetchLifecyclesInWindow,
} from '../learning/playbook-stats.js';
import { getProjectBySlug } from '../projects/loader.js';

export interface DateRange {
  startAt: string;
  endAt: string;
}

export interface CrossRunRetroInput {
  projectId: string;
  /** Most recent N lifecycles (closedAt-ordered desc). Mutually exclusive with `dateRange`. */
  windowSize?: number;
  /** Inclusive ISO8601 bounds. Mutually exclusive with `windowSize`. */
  dateRange?: DateRange;
  deps?: { runtime?: AgentRuntime; now?: () => Date };
}

export interface CrossRunRetroResult {
  ok: true;
  playbookId: number;
  windowStartAt: string;
  windowEndAt: string;
  lifecycleCount: number;
  manifest: CrossRunRetroOutput;
}

export interface CrossRunRetroFailure {
  ok: false;
  error: string;
}

export type CrossRunRetroOutcome = CrossRunRetroResult | CrossRunRetroFailure;

export class CrossRunRetroInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrossRunRetroInputError';
  }
}

/**
 * Resolve the inclusive `(startAt, endAt)` window. Behaviour:
 *   - dateRange  → echoed verbatim
 *   - windowSize → endAt = now; startAt = closedAt of the Nth most recent
 *                  lifecycle. If fewer than N exist, startAt = oldest closedAt.
 *                  If zero lifecycles exist, the window collapses to (now, now)
 *                  (empty window — the workflow still runs and produces an
 *                  empty-window playbook).
 */
export function resolveWindow(input: CrossRunRetroInput): { startAt: string; endAt: string } {
  const hasWindowSize = input.windowSize != null;
  const hasDateRange = input.dateRange != null;
  if (hasWindowSize === hasDateRange) {
    throw new CrossRunRetroInputError('exactly one of windowSize or dateRange must be supplied');
  }

  if (hasDateRange) {
    const range = input.dateRange as DateRange;
    if (!range.startAt || !range.endAt) {
      throw new CrossRunRetroInputError('dateRange.startAt and dateRange.endAt are required');
    }
    if (range.startAt > range.endAt) {
      throw new CrossRunRetroInputError('dateRange.startAt must be <= dateRange.endAt');
    }
    return { startAt: range.startAt, endAt: range.endAt };
  }

  const size = input.windowSize as number;
  if (!Number.isInteger(size) || size <= 0) {
    throw new CrossRunRetroInputError('windowSize must be a positive integer');
  }

  const now = (input.deps?.now ?? (() => new Date()))();
  const endAt = now.toISOString();

  const rows = db
    .select({ closedAt: archivedLifecycles.closedAt })
    .from(archivedLifecycles)
    .where(eq(archivedLifecycles.projectId, input.projectId))
    .all();

  if (rows.length === 0) {
    return { startAt: endAt, endAt };
  }

  const closedAts = rows.map((r) => r.closedAt).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const startAt = closedAts[Math.min(size, closedAts.length) - 1] ?? endAt;
  return { startAt, endAt };
}

function loadMinedPatterns(projectId: string) {
  return db
    .select()
    .from(decisionPatterns)
    .where(eq(decisionPatterns.projectId, projectId))
    .all()
    .map((p) => ({
      patternId: `${p.kind}::${p.role}`,
      pattern: p.actionSummary,
      occurrenceCount: p.occurrenceCount,
      consistencyScore: p.consistencyScore,
      role: p.role,
      kind: p.kind,
      exampleWorkItemIds: safeParseJsonStringArray(p.exampleWorkItemIds),
    }));
}

function safeParseJsonStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function safeParseJsonUnknownArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Cross-run retrospective workflow (M11.12). Fetches archived lifecycles +
 * mined patterns + computed gate thresholds and cost baselines, dispatches the
 * `retrospective-cross-run` skill, and persists the validated output as a new
 * `playbooks` row. The per-merge `retrospective-deep` skill is unaffected.
 */
export async function runCrossRunRetroWorkflow(
  input: CrossRunRetroInput,
): Promise<CrossRunRetroOutcome> {
  const window = resolveWindow(input);
  const projectId = input.projectId;
  const runId = crypto.randomUUID();
  const runtime = input.deps?.runtime ?? new ClaudeCliRuntime();

  const lifecycles = fetchLifecyclesInWindow({
    projectId,
    windowStartAt: window.startAt,
    windowEndAt: window.endAt,
  });

  const minedPatterns = loadMinedPatterns(projectId);
  const gateThresholds = computeGateThresholds({
    projectId,
    windowStartAt: window.startAt,
    windowEndAt: window.endAt,
  });
  const costBaselines = computeCostBaselines({
    projectId,
    windowStartAt: window.startAt,
    windowEndAt: window.endAt,
  });

  const skillName = 'retrospective-cross-run';
  const prompt = readPromptWithContext(skillName, projectId);
  const projectConfig = await getProjectBySlug(projectId);
  const jsonSchema = toJsonSchema(CrossRunRetroOutputSchema);
  const { personaId } = selectPersona(projectId, 'retrospector');

  eventStore.appendEvent({
    kind: 'agent.run-started',
    projectId,
    runId,
    payload: {
      skill: skillName,
      tier: 'cross-run',
      personaId,
      windowStartAt: window.startAt,
      windowEndAt: window.endAt,
      lifecycleCount: lifecycles.length,
    },
  });

  const archivedForSkill = lifecycles.map((row) => ({
    workItemId: row.workItemId,
    closedAt: row.closedAt,
    decisionSummaries: safeParseJsonUnknownArray(row.decisionSummaries),
    learningEntries: safeParseJsonUnknownArray(row.learningEntries),
    qualityScores: safeParseJsonUnknownArray(row.qualityScores),
    costsUsd: row.costsUsd,
  }));

  try {
    const result = await runtime.run({
      runId,
      role: 'retrospector',
      skill: skillName,
      context: {
        projectId,
        windowStartAt: window.startAt,
        windowEndAt: window.endAt,
        lifecycleCount: lifecycles.length,
        archivedLifecycles: archivedForSkill,
        minedPatterns,
        precomputedGateThresholds: gateThresholds,
        precomputedCostBaselines: costBaselines,
        priorAggregatedLearnings: [],
      },
      contextAllowlist: [
        'projectId',
        'windowStartAt',
        'windowEndAt',
        'lifecycleCount',
        'archivedLifecycles',
        'minedPatterns',
        'precomputedGateThresholds',
        'precomputedCostBaselines',
        'priorAggregatedLearnings',
      ],
      freshContext: false,
      toolBundles: ['core'],
      toolExtras: [],
      ...resolveBudgets(skillName, projectConfig?.budgets),
      personaId,
      appendSystemPrompt: prompt,
      outputJsonSchema: jsonSchema,
    });

    const parsed = CrossRunRetroOutputSchema.safeParse(result.output);
    if (!parsed.success) {
      eventStore.appendEvent({
        kind: 'agent.run-failed',
        projectId,
        runId,
        payload: { skill: skillName, error: parsed.error.message },
      });
      return { ok: false, error: parsed.error.message };
    }

    const manifest = parsed.data;

    const inserted = db
      .insert(playbooks)
      .values({
        projectId,
        windowStartAt: window.startAt,
        windowEndAt: window.endAt,
        lifecycleCount: lifecycles.length,
        manifest: JSON.stringify(manifest),
      })
      .returning({ id: playbooks.id })
      .all();

    const playbookId = inserted[0]?.id ?? -1;

    for (const ds of manifest.decisionSummaries) {
      eventStore.appendEvent({
        kind: 'agent.decision-summary',
        projectId,
        runId,
        payload: { skill: skillName, ...ds },
      });
    }

    eventStore.appendEvent({
      kind: 'retrospective.completed',
      projectId,
      runId,
      payload: { tier: 'cross-run', playbookId, manifest },
    });

    return {
      ok: true,
      playbookId,
      windowStartAt: window.startAt,
      windowEndAt: window.endAt,
      lifecycleCount: lifecycles.length,
      manifest,
    };
  } catch (err) {
    eventStore.appendEvent({
      kind: 'agent.run-failed',
      projectId,
      runId,
      payload: { skill: skillName, error: String(err) },
    });
    return { ok: false, error: String(err) };
  }
}
