import { describe, expect, it } from 'vitest';
import { buildScoutReportDigest, buildScoutReportDigestBundle } from './digest.js';
import type { ScoutReport } from './types.js';

function makeReport(overrides: Partial<ScoutReport>): ScoutReport {
  return {
    id: 1,
    projectId: 'proj',
    workItemId: 'item-1',
    investigationRunId: 'inv-1',
    scoutSkill: 'scout-code-path',
    report: {},
    createdAt: '2026-05-14T00:00:00Z',
    ...overrides,
  };
}

describe('buildScoutReportDigest', () => {
  it('extracts deterministic scout evidence without preserving the full report body', () => {
    const digest = buildScoutReportDigest(
      makeReport({
        report: {
          status: 'ok',
          findings: [
            {
              file: 'core/a.ts',
              line: 12,
              fact: 'a'.repeat(900),
              confidence: 'high',
            },
            {
              file: 'core/b.ts',
              fact: 'medium fact',
              confidence: 'medium',
            },
          ],
          decisionSummaries: [{ kind: 'READ', summary: 'read core files' }],
          risks: [{ risk: 'shared workflow boundary' }],
          contradictions: ['issue asks for A but code does B'],
        },
      }),
    );

    expect(digest).toMatchObject({
      scoutName: 'scout-code-path',
      status: 'ok',
      findingCount: 2,
      decisionSummaryCount: 1,
      filesReferenced: ['core/a.ts', 'core/b.ts'],
      risks: ['shared workflow boundary'],
      contradictions: ['issue asks for A but code does B'],
    });
    expect(digest.topFindings[0]?.fact.length).toBeLessThan(520);
    expect(digest.highConfidenceFacts).toHaveLength(1);
  });

  it('carries artifact keys from compact stored reports', () => {
    const digest = buildScoutReportDigest(
      makeReport({
        report: {
          summary: 'scout-code-path: 1 findings, 1 decision summaries',
          findingCount: 1,
          decisionSummaryCount: 1,
          findingsPreview: [{ file: 'core/a.ts', fact: 'preview', confidence: 'high' }],
          artifactRef: {
            artifactKey: 'scout-report:abc',
            kind: 'scout-report',
            summary: 'full scout report',
            bytes: 4096,
            stored: true,
          },
        },
      }),
    );

    expect(digest.summary).toBe('scout-code-path: 1 findings, 1 decision summaries');
    expect(digest.artifactKeys).toEqual(['scout-report:abc']);
    expect(digest.topFindings).toEqual([
      { file: 'core/a.ts', fact: 'preview', confidence: 'high' },
    ]);
  });
});

describe('buildScoutReportDigestBundle', () => {
  it('sorts reports and reports bytes saved', () => {
    const bundle = buildScoutReportDigestBundle([
      makeReport({ id: 2, scoutSkill: 'scout-z', report: { findings: [], status: 'ok' } }),
      makeReport({
        id: 1,
        scoutSkill: 'scout-a',
        report: {
          status: 'ok',
          findings: [{ file: 'core/a.ts', fact: 'x'.repeat(2000), confidence: 'high' }],
          decisionSummaries: [{ kind: 'READ', summary: 'read a' }],
        },
      }),
    ]);

    expect(bundle.reports.map((report) => report.scoutName)).toEqual(['scout-a', 'scout-z']);
    expect(bundle.rawBytes).toBeGreaterThan(bundle.digestBytes);
    expect(bundle.bytesSaved).toBeGreaterThan(0);
  });
});
