import { type SQL, and, eq, gte, lte } from 'drizzle-orm';
import { db } from '../db/db.js';
import { events, agentRunCosts, archivedLifecycles } from '../db/schema.js';

export interface GateThreshold {
  gate: 'qa' | 'review';
  mean: number;
  min: number;
  max: number;
  stdDev: number;
  sampleCount: number;
}

export interface CostBaseline {
  role: string;
  skill: string;
  mean: number;
  p50: number;
  p95: number;
  sampleCount: number;
}

export interface ArchivedLifecycleRow {
  id: number;
  projectId: string;
  workItemId: string;
  closedAt: string;
  decisionSummaries: string;
  learningEntries: string;
  qualityScores: string;
  costsUsd: number;
  runIds: string;
}

export interface WindowQuery {
  projectId: string;
  windowStartAt: string;
  windowEndAt: string;
}

export function computeStats(samples: number[]): {
  mean: number;
  min: number;
  max: number;
  stdDev: number;
  sampleCount: number;
} {
  if (samples.length === 0) {
    return { mean: 0, min: 0, max: 0, stdDev: 0, sampleCount: 0 };
  }
  const n = samples.length;
  const sum = samples.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  let min = samples[0] ?? 0;
  let max = samples[0] ?? 0;
  for (const s of samples) {
    if (s < min) min = s;
    if (s > max) max = s;
  }
  if (n === 1) {
    return { mean, min, max, stdDev: 0, sampleCount: 1 };
  }
  const variance = samples.reduce((acc, s) => acc + (s - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  return { mean, min, max, stdDev, sampleCount: n };
}

export function computePercentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = p * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo] ?? 0;
  const loVal = sorted[lo] ?? 0;
  const hiVal = sorted[hi] ?? 0;
  return loVal + (hiVal - loVal) * (rank - lo);
}

export interface PayloadEnvelope {
  overallScore?: number;
  confidence?: number;
  verdict?: string;
}

function parsePayload(raw: unknown): PayloadEnvelope {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as PayloadEnvelope;
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') {
    return raw as PayloadEnvelope;
  }
  return {};
}

function whereWindow(query: WindowQuery): SQL {
  return and(
    eq(events.projectId, query.projectId),
    gte(events.createdAt, query.windowStartAt),
    lte(events.createdAt, query.windowEndAt),
  ) as SQL;
}

/**
 * Per-gate `mean / min / max / stdDev` of scores within the window.
 *
 * QA score: `overallScore` (0–100) from `qa.completed` events.
 * Review score: `confidence` (0–1) from `review.completed` events. Confidence is
 * the only numeric proxy for review quality — verdict alone isn't comparable.
 */
export function computeGateThresholds(query: WindowQuery): GateThreshold[] {
  const rows = db.select().from(events).where(whereWindow(query)).all();

  const qaScores: number[] = [];
  const reviewScores: number[] = [];

  for (const row of rows) {
    const payload = parsePayload(row.payload);
    if (row.kind === 'qa.completed' && typeof payload.overallScore === 'number') {
      qaScores.push(payload.overallScore);
    } else if (row.kind === 'review.completed' && typeof payload.confidence === 'number') {
      reviewScores.push(payload.confidence);
    }
  }

  return [
    { gate: 'qa', ...computeStats(qaScores) },
    { gate: 'review', ...computeStats(reviewScores) },
  ];
}

/**
 * Per `(role, skill)` `mean / p50 / p95` cost in USD within the window.
 *
 * Reads from `agent_run_costs`. The `stage` column is the role (developer, qa,
 * reviewer, retrospector, …); the `skill` column is the skill key.
 */
export function computeCostBaselines(query: WindowQuery): CostBaseline[] {
  const rows = db
    .select({
      stage: agentRunCosts.stage,
      skill: agentRunCosts.skill,
      costUsd: agentRunCosts.costUsd,
    })
    .from(agentRunCosts)
    .where(
      and(
        eq(agentRunCosts.projectId, query.projectId),
        gte(agentRunCosts.createdAt, query.windowStartAt),
        lte(agentRunCosts.createdAt, query.windowEndAt),
      ),
    )
    .all();

  const groups = new Map<string, { role: string; skill: string; costs: number[] }>();
  for (const row of rows) {
    const key = `${row.stage}::${row.skill}`;
    const existing = groups.get(key);
    if (existing == null) {
      groups.set(key, { role: row.stage, skill: row.skill, costs: [row.costUsd] });
    } else {
      existing.costs.push(row.costUsd);
    }
  }

  const out: CostBaseline[] = [];
  for (const group of groups.values()) {
    const stats = computeStats(group.costs);
    out.push({
      role: group.role,
      skill: group.skill,
      mean: stats.mean,
      p50: computePercentile(group.costs, 0.5),
      p95: computePercentile(group.costs, 0.95),
      sampleCount: stats.sampleCount,
    });
  }

  // Stable sort for deterministic output
  out.sort((a, b) => (a.role + a.skill).localeCompare(b.role + b.skill));
  return out;
}

/**
 * Fetch archived lifecycles inside the window. Window bounds are inclusive on
 * `closedAt`. Used by the cross-run retro workflow as the input universe for
 * the skill, gate-threshold computation, and cost-baseline computation.
 */
export function fetchLifecyclesInWindow(query: WindowQuery): ArchivedLifecycleRow[] {
  return db
    .select()
    .from(archivedLifecycles)
    .where(
      and(
        eq(archivedLifecycles.projectId, query.projectId),
        gte(archivedLifecycles.closedAt, query.windowStartAt),
        lte(archivedLifecycles.closedAt, query.windowEndAt),
      ),
    )
    .all();
}
