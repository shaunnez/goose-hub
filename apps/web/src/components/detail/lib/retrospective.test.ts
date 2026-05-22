import { AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE_COLOR,
  getRetrospectiveSummary,
  latestRetrospectivePayload,
  outcomeMeta,
  scoreGrade,
} from './retrospective';

describe('scoreGrade', () => {
  it('returns "Excellent" for scores >= 0.9', () => {
    expect(scoreGrade(0.9)).toEqual({ label: 'Excellent', color: 'var(--success)' });
    expect(scoreGrade(1.0)).toEqual({ label: 'Excellent', color: 'var(--success)' });
  });

  it('returns "Strong" for scores in [0.8, 0.9)', () => {
    expect(scoreGrade(0.8)).toEqual({ label: 'Strong', color: 'var(--success)' });
    expect(scoreGrade(0.89)).toEqual({ label: 'Strong', color: 'var(--success)' });
  });

  it('returns "Solid" for scores in [0.7, 0.8)', () => {
    expect(scoreGrade(0.7)).toEqual({ label: 'Solid', color: 'var(--accent)' });
    expect(scoreGrade(0.79)).toEqual({ label: 'Solid', color: 'var(--accent)' });
  });

  it('returns "Mixed" for scores in [0.6, 0.7)', () => {
    expect(scoreGrade(0.6)).toEqual({ label: 'Mixed', color: 'var(--warning)' });
    expect(scoreGrade(0.69)).toEqual({ label: 'Mixed', color: 'var(--warning)' });
  });

  it('returns "Concerning" for scores below 0.6', () => {
    expect(scoreGrade(0.59)).toEqual({ label: 'Concerning', color: 'var(--danger)' });
    expect(scoreGrade(0)).toEqual({ label: 'Concerning', color: 'var(--danger)' });
  });
});

describe('outcomeMeta', () => {
  it('maps "success" to CheckCircle + success colour', () => {
    expect(outcomeMeta('success')).toEqual({
      icon: CheckCircle,
      color: 'var(--success)',
      label: 'Success',
    });
  });

  it('maps "failure" to XCircle + danger colour', () => {
    expect(outcomeMeta('failure')).toEqual({
      icon: XCircle,
      color: 'var(--danger)',
      label: 'Failure',
    });
  });

  it('maps "partial" to AlertCircle + warning colour', () => {
    expect(outcomeMeta('partial')).toEqual({
      icon: AlertCircle,
      color: 'var(--warning)',
      label: 'Partial',
    });
  });
});

describe('CONFIDENCE_COLOR', () => {
  it('exposes a colour class for every confidence level', () => {
    expect(CONFIDENCE_COLOR.high).toContain('green');
    expect(CONFIDENCE_COLOR.medium).toContain('yellow');
    expect(CONFIDENCE_COLOR.low).toContain('blue');
  });
});

describe('latestRetrospectivePayload', () => {
  it('prefers the latest retrospective completion payload', () => {
    const older = latestRetrospectivePayload([
      {
        id: 1,
        kind: 'retrospective.completed',
        payload: {
          retrospective: {
            tier: 'light',
            output: {
              outcome: 'partial',
              workItemNumber: 980,
              summary: { wentWell: '', didNotGoWell: '', architecturalTakeaway: '' },
              improvementCandidates: [],
              decisionSummaries: [],
            },
          },
        },
        projectId: 'proj',
        workItemId: 'wi-1',
        createdAt: '2026-05-18T01:00:00Z',
      },
      {
        id: 2,
        kind: 'retrospective.completed',
        payload: {
          retrospective: {
            tier: 'deep',
            output: {
              outcome: 'success',
              workItemNumber: 980,
              summary: { wentWell: '', didNotGoWell: '', architecturalTakeaway: '' },
              improvementCandidates: [],
              decisionSummaries: [],
              triggerReasons: [],
              personaQualityScores: [],
              learningEntries: [],
              decisionPatterns: [],
            },
          },
        },
        projectId: 'proj',
        workItemId: 'wi-1',
        createdAt: '2026-05-18T02:00:00Z',
      },
    ] as never);

    expect(older?.tier).toBe('deep');
  });
});

describe('getRetrospectiveSummary', () => {
  it('omits deep-only metrics for light retrospectives and counts high-confidence candidates', () => {
    const summary = getRetrospectiveSummary({
      tier: 'light',
      output: {
        outcome: 'partial',
        workItemNumber: 980,
        summary: { wentWell: 'a', didNotGoWell: 'b', architecturalTakeaway: 'c' },
        decisionSummaries: [],
        improvementCandidates: [
          {
            kind: 'workflow',
            targetPath: 'docs/a.md',
            suggestionText: 'a',
            confidence: 'high',
          },
          {
            kind: 'persona',
            targetPath: 'docs/b.md',
            suggestionText: 'b',
            confidence: 'medium',
          },
        ],
      },
    });

    expect(summary).toMatchObject({
      tier: 'light',
      outcome: 'partial',
      candidateCount: 2,
      highConfidenceCandidateCount: 1,
      qualityScoreCount: 0,
      patternCount: 0,
      learningCount: 0,
    });
  });

  it('includes deep-only metrics for deep retrospectives', () => {
    const summary = getRetrospectiveSummary({
      tier: 'deep',
      output: {
        outcome: 'success',
        workItemNumber: 980,
        summary: { wentWell: 'a', didNotGoWell: 'b', architecturalTakeaway: 'c' },
        decisionSummaries: [],
        improvementCandidates: [
          {
            kind: 'workflow',
            targetPath: 'docs/a.md',
            suggestionText: 'a',
            confidence: 'high',
          },
        ],
        triggerReasons: ['quality'],
        personaQualityScores: [
          {
            personaId: 'reviewer',
            score: 0.8,
            trend: 'improving',
            sampleCount: 3,
          },
        ],
        learningEntries: [
          {
            observation: 'o',
            rationale: 'r',
            improvementKind: 'workflow',
            confidence: 'medium',
          },
        ],
        decisionPatterns: [{ pattern: 'p', occurrences: 2, confidence: 'high' }],
      },
    });

    expect(summary).toMatchObject({
      tier: 'deep',
      outcome: 'success',
      candidateCount: 1,
      highConfidenceCandidateCount: 1,
      qualityScoreCount: 1,
      patternCount: 1,
      learningCount: 1,
      triggerReasonCount: 1,
    });
  });
});
