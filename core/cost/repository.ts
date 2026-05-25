import { and, asc, desc, eq, gte, ne, sql } from 'drizzle-orm';
import { db } from '../db/db.js';
import { agentRunCosts, agentRunToolStats } from '../db/schema.js';
import { eventStore } from '../event-stream/store.js';
import { canonicalPathStringFromAuditPayload } from '../tool-layer/tool-call-audit.js';
import type { CostLabel, CostRecord, Stage } from './types.js';

export interface CostRow extends CostRecord {
  id: number;
  createdAt: string;
}

export interface AgentRunToolStatsRow {
  runId: string;
  readCount: number;
  grepCount: number;
  writeCount: number;
  editCount: number;
  bytesRead: number;
  uniquePathsRead: number;
  redundantReads: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkItemToolStatsRow extends AgentRunToolStatsRow {
  workItemId: string | null;
  stage: Stage;
  skill: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
  costUsd: number;
  costLabel: CostLabel;
  personaId: string | null;
}

/**
 * Persists a cost record for an agent run. Idempotent on `runId` — duplicate
 * inserts are silently ignored so retry loops don't double-count.
 */
export function recordCost(record: CostRecord): void {
  db.insert(agentRunCosts)
    .values({
      runId: record.runId,
      projectId: record.projectId,
      workItemId: record.workItemId,
      stage: record.stage,
      skill: record.skill,
      modelId: record.modelId,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      cachedInputTokens: record.cachedInputTokens,
      reasoningOutputTokens: record.reasoningOutputTokens,
      costUsd: record.costUsd,
      costLabel: record.costLabel,
      personaId: record.personaId,
    })
    .onConflictDoNothing({ target: agentRunCosts.runId })
    .run();
}

export function listCostsForWorkItem(workItemId: string): CostRow[] {
  const rows = db
    .select()
    .from(agentRunCosts)
    .where(eq(agentRunCosts.workItemId, workItemId))
    .orderBy(asc(agentRunCosts.createdAt))
    .all();
  return rows.map(toRow);
}

export function recordToolStatsForRun(runId: string): AgentRunToolStatsRow {
  const stats = aggregateToolStatsForRun(runId);
  const [row] = db
    .insert(agentRunToolStats)
    .values(stats)
    .onConflictDoUpdate({
      target: agentRunToolStats.runId,
      set: {
        readCount: stats.readCount,
        grepCount: stats.grepCount,
        writeCount: stats.writeCount,
        editCount: stats.editCount,
        bytesRead: stats.bytesRead,
        uniquePathsRead: stats.uniquePathsRead,
        redundantReads: stats.redundantReads,
        updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`,
      },
    })
    .returning()
    .all();
  const saved = toToolStatsRow(row);
  emitToolIntensityAnomalyIfNeeded(saved);
  return saved;
}

export function listToolStatsForWorkItem(workItemId: string): WorkItemToolStatsRow[] {
  const rows = db
    .select({
      runId: agentRunToolStats.runId,
      readCount: agentRunToolStats.readCount,
      grepCount: agentRunToolStats.grepCount,
      writeCount: agentRunToolStats.writeCount,
      editCount: agentRunToolStats.editCount,
      bytesRead: agentRunToolStats.bytesRead,
      uniquePathsRead: agentRunToolStats.uniquePathsRead,
      redundantReads: agentRunToolStats.redundantReads,
      createdAt: agentRunToolStats.createdAt,
      updatedAt: agentRunToolStats.updatedAt,
      workItemId: agentRunCosts.workItemId,
      stage: agentRunCosts.stage,
      skill: agentRunCosts.skill,
      modelId: agentRunCosts.modelId,
      inputTokens: agentRunCosts.inputTokens,
      outputTokens: agentRunCosts.outputTokens,
      cachedInputTokens: agentRunCosts.cachedInputTokens,
      reasoningOutputTokens: agentRunCosts.reasoningOutputTokens,
      costUsd: agentRunCosts.costUsd,
      costLabel: agentRunCosts.costLabel,
      personaId: agentRunCosts.personaId,
    })
    .from(agentRunToolStats)
    .innerJoin(agentRunCosts, eq(agentRunToolStats.runId, agentRunCosts.runId))
    .where(eq(agentRunCosts.workItemId, workItemId))
    .orderBy(asc(agentRunCosts.createdAt))
    .all();

  return rows.map((row) => ({
    ...toToolStatsRow(row),
    workItemId: row.workItemId,
    stage: row.stage as Stage,
    skill: row.skill,
    modelId: row.modelId,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cachedInputTokens: row.cachedInputTokens,
    reasoningOutputTokens: row.reasoningOutputTokens,
    costUsd: row.costUsd,
    costLabel: row.costLabel as CostLabel,
    personaId: row.personaId,
  }));
}

export function listCostsForProjectSince(projectId: string, sinceIso: string): CostRow[] {
  const rows = db
    .select()
    .from(agentRunCosts)
    .where(and(eq(agentRunCosts.projectId, projectId), gte(agentRunCosts.createdAt, sinceIso)))
    .orderBy(asc(agentRunCosts.createdAt))
    .all();
  return rows.map(toRow);
}

export interface ProjectTotals {
  totalUsd: number;
  totalRuns: number;
  inputTokens: number;
  cachedInputTokens: number;
  /** True when any contributing row was 'estimated'. UI uses this to qualify the figure. */
  hasEstimated: boolean;
}

export interface StageTotal extends ProjectTotals {
  stage: Stage;
}

export function totalsForProjectSince(projectId: string, sinceIso: string): ProjectTotals {
  const [row] = db
    .select({
      totalUsd: sql<number>`coalesce(sum(${agentRunCosts.costUsd}), 0)`,
      totalRuns: sql<number>`count(*)`,
      inputTokens: sql<number>`coalesce(sum(${agentRunCosts.inputTokens}), 0)`,
      cachedInputTokens: sql<number>`coalesce(sum(${agentRunCosts.cachedInputTokens}), 0)`,
      hasEstimated: sql<number>`max(case when ${agentRunCosts.costLabel} = 'estimated' then 1 else 0 end)`,
    })
    .from(agentRunCosts)
    .where(and(eq(agentRunCosts.projectId, projectId), gte(agentRunCosts.createdAt, sinceIso)))
    .all();
  return {
    totalUsd: row?.totalUsd ?? 0,
    totalRuns: row?.totalRuns ?? 0,
    inputTokens: row?.inputTokens ?? 0,
    cachedInputTokens: row?.cachedInputTokens ?? 0,
    hasEstimated: (row?.hasEstimated ?? 0) === 1,
  };
}

export function totalsByStageForProjectSince(projectId: string, sinceIso: string): StageTotal[] {
  const rows = db
    .select({
      stage: agentRunCosts.stage,
      totalUsd: sql<number>`coalesce(sum(${agentRunCosts.costUsd}), 0)`,
      totalRuns: sql<number>`count(*)`,
      inputTokens: sql<number>`coalesce(sum(${agentRunCosts.inputTokens}), 0)`,
      cachedInputTokens: sql<number>`coalesce(sum(${agentRunCosts.cachedInputTokens}), 0)`,
      hasEstimated: sql<number>`max(case when ${agentRunCosts.costLabel} = 'estimated' then 1 else 0 end)`,
    })
    .from(agentRunCosts)
    .where(and(eq(agentRunCosts.projectId, projectId), gte(agentRunCosts.createdAt, sinceIso)))
    .groupBy(agentRunCosts.stage)
    .orderBy(desc(sql`sum(${agentRunCosts.costUsd})`))
    .all();
  return rows.map((r) => ({
    stage: r.stage as Stage,
    totalUsd: r.totalUsd ?? 0,
    totalRuns: r.totalRuns ?? 0,
    inputTokens: r.inputTokens ?? 0,
    cachedInputTokens: r.cachedInputTokens ?? 0,
    hasEstimated: (r.hasEstimated ?? 0) === 1,
  }));
}

/**
 * Returns the total USD spend for a specific skill within a project across all
 * time. Used by workflows to enforce per-advisor budget caps.
 */
export function totalSpendForSkill(projectId: string, skill: string): number {
  const [row] = db
    .select({
      totalUsd: sql<number>`coalesce(sum(${agentRunCosts.costUsd}), 0)`,
    })
    .from(agentRunCosts)
    .where(and(eq(agentRunCosts.projectId, projectId), eq(agentRunCosts.skill, skill)))
    .all();
  return row?.totalUsd ?? 0;
}

function toRow(r: typeof agentRunCosts.$inferSelect): CostRow {
  return {
    id: r.id,
    runId: r.runId,
    projectId: r.projectId,
    workItemId: r.workItemId,
    stage: r.stage as Stage,
    skill: r.skill,
    modelId: r.modelId,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cachedInputTokens: r.cachedInputTokens,
    reasoningOutputTokens: r.reasoningOutputTokens,
    costUsd: r.costUsd,
    costLabel: r.costLabel as CostLabel,
    personaId: r.personaId,
    createdAt: r.createdAt,
  };
}

function aggregateToolStatsForRun(
  runId: string,
): Omit<AgentRunToolStatsRow, 'createdAt' | 'updatedAt'> {
  const readPaths = new Set<string>();
  let readCount = 0;
  let grepCount = 0;
  let writeCount = 0;
  let editCount = 0;
  let bytesRead = 0;
  let redundantReads = 0;

  for (const event of eventStore.replay({ runId, kind: 'agent.tool-call' })) {
    const payload = payloadRecord(event.payload);
    const toolName = normalizeToolName(payload.tool_name ?? payload.toolName ?? payload.name);
    if (isReadTool(toolName)) {
      readCount += 1;
      bytesRead += bytesReadFromPayload(payload);
      const path = canonicalPathStringFromAuditPayload(payload) ?? pathFromPayload(payload);
      if (path != null) {
        if (readPaths.has(path)) redundantReads += 1;
        readPaths.add(path);
      }
    } else if (isSearchTool(toolName)) {
      grepCount += 1;
    } else if (isWriteTool(toolName)) {
      writeCount += 1;
    } else if (isEditTool(toolName)) {
      editCount += 1;
    }
  }

  return {
    runId,
    readCount,
    grepCount,
    writeCount,
    editCount,
    bytesRead,
    uniquePathsRead: readPaths.size,
    redundantReads,
  };
}

function toToolStatsRow(row: typeof agentRunToolStats.$inferSelect): AgentRunToolStatsRow {
  return {
    runId: row.runId,
    readCount: row.readCount,
    grepCount: row.grepCount,
    writeCount: row.writeCount,
    editCount: row.editCount,
    bytesRead: row.bytesRead,
    uniquePathsRead: row.uniquePathsRead,
    redundantReads: row.redundantReads,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeToolName(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isReadTool(name: string): boolean {
  return name === 'read' || name === 'read_file' || name === 'read_many_files';
}

function isSearchTool(name: string): boolean {
  return name === 'grep' || name === 'glob' || name === 'search_text';
}

function isWriteTool(name: string): boolean {
  return name === 'write' || name === 'write_file';
}

function isEditTool(name: string): boolean {
  return name === 'edit' || name === 'edit_file' || name === 'apply_patch';
}

function bytesReadFromPayload(payload: Record<string, unknown>): number {
  const value = payload.bytesRead ?? payload.bytes_read ?? payload.bytes ?? payload.contentBytes;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function pathFromPayload(payload: Record<string, unknown>): string | null {
  const toolInput = payloadRecord(payload.tool_input ?? payload.toolInput);
  const value = toolInput.path ?? toolInput.file_path ?? payload.path ?? payload.file_path;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function payloadRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function emitToolIntensityAnomalyIfNeeded(stats: AgentRunToolStatsRow): void {
  const [run] = db
    .select()
    .from(agentRunCosts)
    .where(eq(agentRunCosts.runId, stats.runId))
    .limit(1)
    .all();
  if (run == null) return;

  const baseline = db
    .select({ readCount: agentRunToolStats.readCount })
    .from(agentRunToolStats)
    .innerJoin(agentRunCosts, eq(agentRunToolStats.runId, agentRunCosts.runId))
    .where(
      and(
        eq(agentRunCosts.projectId, run.projectId),
        eq(agentRunCosts.skill, run.skill),
        ne(agentRunCosts.runId, stats.runId),
      ),
    )
    .all()
    .map((row) => row.readCount);

  const p95ReadCount = percentile(baseline, 0.95);
  const thresholdReadCount = p95ReadCount * 2;
  if (p95ReadCount <= 0 || stats.readCount <= thresholdReadCount) return;

  eventStore.appendEvent({
    projectId: run.projectId,
    workItemId: run.workItemId,
    runId: stats.runId,
    personaId: run.personaId,
    kind: 'agent.tool-intensity-anomaly',
    payload: {
      runId: stats.runId,
      skill: run.skill,
      readCount: stats.readCount,
      p95ReadCount,
      thresholdReadCount,
      bytesRead: stats.bytesRead,
      redundantReads: stats.redundantReads,
    },
  });
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[index] ?? 0;
}
