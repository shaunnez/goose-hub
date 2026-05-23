import { z } from 'zod';
import type { ArtifactRef } from '../agent-artifacts/types.js';
import type { ScoutReport } from './types.js';

export const ScoutDigestFindingSchema = z.object({
  file: z.string().optional(),
  line: z.number().optional(),
  fact: z.string(),
  confidence: z.string().optional(),
});

export const ScoutReportDigestSchema = z.object({
  scoutName: z.string(),
  status: z.string(),
  summary: z.string().optional(),
  findingCount: z.number(),
  decisionSummaryCount: z.number(),
  topFindings: z.array(ScoutDigestFindingSchema),
  highConfidenceFacts: z.array(ScoutDigestFindingSchema),
  filesReferenced: z.array(z.string()),
  risks: z.array(z.string()),
  contradictions: z.array(z.string()),
  artifactKeys: z.array(z.string()),
});

export const ScoutReportDigestBundleSchema = z.object({
  reports: z.array(ScoutReportDigestSchema),
  contradictions: z.array(z.string()),
  artifactKeys: z.array(z.string()),
  rawBytes: z.number(),
  digestBytes: z.number(),
  bytesSaved: z.number(),
});

export type ScoutDigestFinding = {
  file?: string;
  line?: number;
  fact: string;
  confidence?: string;
};

export type ScoutReportDigest = {
  scoutName: string;
  status: string;
  summary?: string;
  findingCount: number;
  decisionSummaryCount: number;
  topFindings: ScoutDigestFinding[];
  highConfidenceFacts: ScoutDigestFinding[];
  filesReferenced: string[];
  risks: string[];
  contradictions: string[];
  artifactKeys: string[];
};

export type ScoutReportDigestBundle = {
  reports: ScoutReportDigest[];
  contradictions: string[];
  artifactKeys: string[];
  rawBytes: number;
  digestBytes: number;
  bytesSaved: number;
};

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function truncate(value: string, max = 500): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function extractArtifactKeys(value: unknown, keys = new Set<string>()): Set<string> {
  const record = asRecord(value);
  if (record != null) {
    if (typeof record.artifactKey === 'string') keys.add(record.artifactKey);
    for (const child of Object.values(record)) extractArtifactKeys(child, keys);
    return keys;
  }

  if (Array.isArray(value)) {
    for (const child of value) extractArtifactKeys(child, keys);
  }

  return keys;
}

function extractArtifactRef(value: unknown): ArtifactRef | null {
  const record = asRecord(value);
  const ref = asRecord(record?.artifactRef);
  if (ref == null) return null;
  if (
    ref.stored === true &&
    typeof ref.artifactKey === 'string' &&
    typeof ref.kind === 'string' &&
    typeof ref.summary === 'string' &&
    typeof ref.bytes === 'number'
  ) {
    return ref as ArtifactRef;
  }
  return null;
}

function extractFindings(report: unknown): ScoutDigestFinding[] {
  const record = asRecord(report);
  const candidates = Array.isArray(record?.findings)
    ? record?.findings
    : Array.isArray(record?.findingsPreview)
      ? record?.findingsPreview
      : [];

  return candidates.flatMap((candidate) => {
    const finding = asRecord(candidate);
    if (finding == null || typeof finding.fact !== 'string') return [];
    return [
      {
        ...(typeof finding.file === 'string' ? { file: finding.file } : {}),
        ...(typeof finding.line === 'number' ? { line: finding.line } : {}),
        fact: truncate(finding.fact),
        ...(typeof finding.confidence === 'string' ? { confidence: finding.confidence } : {}),
      },
    ];
  });
}

function extractDecisionSummaryCount(report: unknown): number {
  const record = asRecord(report);
  if (typeof record?.decisionSummaryCount === 'number') return record.decisionSummaryCount;
  return Array.isArray(record?.decisionSummaries) ? record.decisionSummaries.length : 0;
}

function extractFindingCount(report: unknown, findings: ScoutDigestFinding[]): number {
  const record = asRecord(report);
  return typeof record?.findingCount === 'number' ? record.findingCount : findings.length;
}

function extractStatus(report: unknown): string {
  const record = asRecord(report);
  return typeof record?.status === 'string' ? record.status : 'ok';
}

function extractSummary(report: unknown): string | undefined {
  const record = asRecord(report);
  return typeof record?.summary === 'string' ? record.summary : undefined;
}

function extractFiles(report: unknown, findings: ScoutDigestFinding[]): string[] {
  const record = asRecord(report);
  return [
    ...new Set([
      ...findings.flatMap((finding) => (finding.file != null ? [finding.file] : [])),
      ...asStringArray(record?.filesReferenced),
      ...asStringArray(record?.keyFiles),
    ]),
  ].sort();
}

function extractTextList(report: unknown, fieldNames: string[]): string[] {
  const record = asRecord(report);
  if (record == null) return [];

  const values: string[] = [];
  for (const fieldName of fieldNames) {
    const value = record[fieldName];
    if (typeof value === 'string') values.push(value);
    for (const item of asStringArray(value)) values.push(item);
    if (Array.isArray(value)) {
      for (const item of value) {
        const itemRecord = asRecord(item);
        if (typeof itemRecord?.risk === 'string') values.push(itemRecord.risk);
        if (typeof itemRecord?.summary === 'string') values.push(itemRecord.summary);
        if (typeof itemRecord?.description === 'string') values.push(itemRecord.description);
      }
    }
  }
  return [...new Set(values.map((value) => truncate(value, 300)))].sort();
}

function extractContradictionText(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return truncate(value, 300);
  const record = asRecord(value);
  if (record == null) return null;

  const location =
    typeof record.file === 'string'
      ? `${record.file}${typeof record.line === 'number' ? `:${record.line}` : ''}`
      : '';
  const facts = Array.isArray(record.facts)
    ? record.facts.flatMap((fact) => {
        if (typeof fact === 'string') return [fact];
        const factRecord = asRecord(fact);
        if (typeof factRecord?.fact !== 'string') return [];
        return [
          typeof factRecord.scoutName === 'string'
            ? `${factRecord.scoutName}: ${factRecord.fact}`
            : factRecord.fact,
        ];
      })
    : [];

  if (location.length > 0 && facts.length > 0) return truncate(`${location}: ${facts.join(' | ')}`);
  if (location.length > 0) return truncate(location);
  if (facts.length > 0) return truncate(facts.join(' | '));
  return truncate(JSON.stringify(value), 300);
}

export function buildScoutReportDigest(report: ScoutReport): ScoutReportDigest {
  const findings = extractFindings(report.report);
  const artifactKeys = [...extractArtifactKeys(report.report)].sort();
  const artifactRef = extractArtifactRef(report.report);

  return {
    scoutName: report.scoutSkill,
    status: extractStatus(report.report),
    ...(extractSummary(report.report) != null ? { summary: extractSummary(report.report) } : {}),
    findingCount: extractFindingCount(report.report, findings),
    decisionSummaryCount: extractDecisionSummaryCount(report.report),
    topFindings: findings.slice(0, 5),
    highConfidenceFacts: findings.filter((finding) => finding.confidence === 'high').slice(0, 5),
    filesReferenced: extractFiles(report.report, findings),
    risks: extractTextList(report.report, ['risks', 'riskRegister']).slice(0, 5),
    contradictions: extractTextList(report.report, ['contradictions']).slice(0, 5),
    artifactKeys:
      artifactRef != null ? [...new Set([artifactRef.artifactKey, ...artifactKeys])] : artifactKeys,
  };
}

export function buildScoutReportDigestBundle(
  reports: ScoutReport[],
  opts: { contradictions?: unknown[] } = {},
): ScoutReportDigestBundle {
  const orderedReports = [...reports].sort((a, b) => {
    const skillOrder = a.scoutSkill.localeCompare(b.scoutSkill);
    return skillOrder !== 0 ? skillOrder : a.id - b.id;
  });
  const digests = orderedReports.map(buildScoutReportDigest);
  const contradictions = [
    ...new Set([
      ...digests.flatMap((digest) => digest.contradictions),
      ...(opts.contradictions ?? []).flatMap((contradiction) => {
        const text = extractContradictionText(contradiction);
        return text == null ? [] : [text];
      }),
    ]),
  ].slice(0, 10);
  const artifactKeys = [...new Set(digests.flatMap((digest) => digest.artifactKeys))].sort();
  const rawBytes = byteLength(orderedReports);
  const digestBytes = byteLength(digests);

  return {
    reports: digests,
    contradictions,
    artifactKeys,
    rawBytes,
    digestBytes,
    bytesSaved: Math.max(0, rawBytes - digestBytes),
  };
}
