import { and, eq } from 'drizzle-orm';
import { deterministicArtifactKey, maybeStoreLargePayload } from '../agent-artifacts/repository.js';
import type { ArtifactRef } from '../agent-artifacts/types.js';
import { db } from '../db/db.js';
import { scoutReports } from '../db/schema.js';
import type { ScoutReport } from './types.js';

export type CompactScoutReport = {
  summary: string;
  findingCount: number;
  decisionSummaryCount: number;
  findingsPreview: Array<{ file?: string; line?: number; fact: string; confidence?: string }>;
  artifactRef: ArtifactRef;
};

function summarizeScoutReport(scoutSkill: string, report: unknown): string {
  const candidate = report as { findings?: unknown[]; decisionSummaries?: unknown[] };
  const findingCount = Array.isArray(candidate.findings) ? candidate.findings.length : 0;
  const decisionSummaryCount = Array.isArray(candidate.decisionSummaries)
    ? candidate.decisionSummaries.length
    : 0;
  return `${scoutSkill}: ${findingCount} findings, ${decisionSummaryCount} decision summaries`;
}

function compactScoutReport(
  scoutSkill: string,
  report: unknown,
  artifactRef: ArtifactRef,
): CompactScoutReport {
  const candidate = report as { findings?: unknown[]; decisionSummaries?: unknown[] };
  const findings = Array.isArray(candidate.findings) ? candidate.findings : [];
  const decisionSummaries = Array.isArray(candidate.decisionSummaries)
    ? candidate.decisionSummaries
    : [];
  return {
    summary: summarizeScoutReport(scoutSkill, report),
    findingCount: findings.length,
    decisionSummaryCount: decisionSummaries.length,
    findingsPreview: findings.slice(0, 5).flatMap((finding) => {
      if (finding == null || typeof finding !== 'object') return [];
      const f = finding as {
        file?: unknown;
        line?: unknown;
        fact?: unknown;
        confidence?: unknown;
      };
      if (typeof f.fact !== 'string') return [];
      return [
        {
          ...(typeof f.file === 'string' ? { file: f.file } : {}),
          ...(typeof f.line === 'number' ? { line: f.line } : {}),
          fact: f.fact.length > 500 ? `${f.fact.slice(0, 500)}...` : f.fact,
          ...(typeof f.confidence === 'string' ? { confidence: f.confidence } : {}),
        },
      ];
    }),
    artifactRef,
  };
}

export function persistScoutReport(
  projectId: string,
  workItemId: string,
  investigationRunId: string,
  scoutSkill: string,
  report: unknown,
): unknown {
  const maybeStored = maybeStoreLargePayload({
    projectId,
    workItemId,
    runId: investigationRunId,
    kind: 'scout-report',
    payload: report,
    summary: summarizeScoutReport(scoutSkill, report),
    artifactKey: deterministicArtifactKey({
      projectId,
      workItemId,
      runId: investigationRunId,
      kind: 'scout-report',
      discriminator: scoutSkill,
    }),
  });
  const storedReport =
    maybeStored.stored === false
      ? maybeStored.payload
      : compactScoutReport(scoutSkill, report, maybeStored);

  db.insert(scoutReports)
    .values({
      projectId,
      workItemId,
      investigationRunId,
      scoutSkill,
      report: JSON.stringify(storedReport),
    })
    .onConflictDoUpdate({
      target: [
        scoutReports.projectId,
        scoutReports.workItemId,
        scoutReports.investigationRunId,
        scoutReports.scoutSkill,
      ],
      set: { report: JSON.stringify(storedReport) },
    })
    .run();

  return storedReport;
}

export function listScoutReportsForInvestigation(
  projectId: string,
  workItemId: string,
  investigationRunId: string,
): ScoutReport[] {
  const rows = db
    .select()
    .from(scoutReports)
    .where(
      and(
        eq(scoutReports.projectId, projectId),
        eq(scoutReports.workItemId, workItemId),
        eq(scoutReports.investigationRunId, investigationRunId),
      ),
    )
    .all();

  return rows.map((r) => ({
    ...r,
    report: JSON.parse(r.report) as unknown,
  }));
}
