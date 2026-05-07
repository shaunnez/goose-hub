import type { AgentResult, AgentSpec } from './interface.js';
import { getNextOutcome } from './mock-test-registry.js';

export function resolveMockOutput(spec: AgentSpec): AgentResult {
  const workItemId = spec.context.workItemId as string | undefined;
  const testOutcome =
    getNextOutcome(workItemId, spec.skill) ?? (spec.context.testOutcome as string | undefined);

  switch (spec.skill) {
    case 'triage': {
      if (testOutcome === 'reject') {
        return {
          output: {
            type: 'chore',
            priority: 'p3',
            labels: [],
            reasoning: 'e2e reject fixture',
            decisionSummaries: [{ kind: 'VERDICT', summary: 'Rejected for e2e test' }],
          },
          decisionSummaries: [{ kind: 'VERDICT', summary: 'Rejected for e2e test' }],
          events: [],
        };
      }
      const workItem = (spec.context?.workItem ?? {}) as { type?: string };
      const incoming = workItem.type;
      const type =
        incoming === 'bug' || incoming === 'research' || incoming === 'feature'
          ? incoming
          : 'chore';
      return {
        output: {
          type,
          priority: 'p3',
          labels: [],
          reasoning: 'e2e fixture',
          decisionSummaries: [{ kind: 'PLAN', summary: `Classified as ${type} for e2e` }],
        },
        decisionSummaries: [{ kind: 'PLAN', summary: `Classified as ${type} for e2e` }],
        events: [],
      };
    }

    case 'repo-match':
      return {
        output: {
          candidates: [
            { repo: 'shaunnez/goose-hub', confidence: 95, evidence: 'name match', tier: 1 },
          ],
          decisionSummaries: [],
        },
        decisionSummaries: [],
        events: [],
      };

    case 'implement':
      return {
        output: {
          plan: 'E2E mock plan',
          filesWritten: [{ path: 'e2e-mock.ts', reason: 'e2e fixture' }],
          testsWritten: [],
          testsRun: { command: 'pnpm test ', paths: [] },
          prUrl: 'https://github.com/shaunnez/goose-hub/pull/999',
          evidenceSpecPath: null,
          confidence: 'high',
          decisionSummaries: [{ kind: 'GREEN', summary: 'Mock implementation for e2e test' }],
        },
        decisionSummaries: [{ kind: 'GREEN', summary: 'Mock implementation for e2e test' }],
        events: [],
      };

    case 'investigate': {
      const confidence =
        testOutcome === 'low-confidence'
          ? 'low'
          : testOutcome === 'medium-confidence'
            ? 'medium'
            : 'high';
      return {
        output: {
          findings: 'E2E mock findings',
          keyFiles: [],
          confidence,
          openQuestions: [],
          decisionSummaries: [{ kind: 'INSIGHT', summary: 'Mock investigation for e2e test' }],
        },
        decisionSummaries: [{ kind: 'INSIGHT', summary: 'Mock investigation for e2e test' }],
        events: [],
      };
    }

    case 'qa': {
      if (testOutcome === 'fail') {
        const emptyTier = { passed: false, findings: [] };
        return {
          output: {
            verdict: 'fail',
            overallScore: 20,
            threshold: 70,
            tierResults: {
              structural: emptyTier,
              functional: {
                passed: false,
                findings: [
                  {
                    tier: 'functional',
                    severity: 'error',
                    description: 'mock qa failure',
                    disposition: 'register',
                    dispositionRef: 'e2e-test',
                  },
                ],
              },
              regression: emptyTier,
            },
            qualityScores: {
              openClosed: 5,
              conceptCount: 5,
              timeToCapability: 5,
              complecting: 5,
              loc: 0,
              coupling: 0,
              gallsLaw: 0,
              cyclomaticComplexity: 0,
            },
            findings: [],
            decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock QA fail for e2e test' }],
          },
          decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock QA fail for e2e test' }],
          events: [],
        };
      }
      const emptyTierPass = { passed: true, findings: [] };
      return {
        output: {
          verdict: 'pass',
          overallScore: 85,
          threshold: 70,
          tierResults: {
            structural: emptyTierPass,
            functional: emptyTierPass,
            regression: emptyTierPass,
          },
          qualityScores: {
            openClosed: 18,
            conceptCount: 12,
            timeToCapability: 12,
            complecting: 12,
            loc: 8,
            coupling: 8,
            gallsLaw: 8,
            cyclomaticComplexity: 5,
          },
          findings: [],
          decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock QA pass for e2e test' }],
        },
        decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock QA pass for e2e test' }],
        events: [],
      };
    }

    case 'review': {
      if (testOutcome === 'needs-fix') {
        return {
          output: {
            verdict: 'needs-fix',
            confidence: 0.4,
            criteriaChecks: [],
            findings: [],
            decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock review needs-fix for e2e test' }],
          },
          decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock review needs-fix for e2e test' }],
          events: [],
        };
      }
      return {
        output: {
          verdict: 'approved',
          confidence: 0.95,
          criteriaChecks: [],
          findings: [],
          decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock review approval for e2e test' }],
        },
        decisionSummaries: [{ kind: 'VERDICT', summary: 'Mock review approval for e2e test' }],
        events: [],
      };
    }

    case 'retrospective-light':
    case 'retrospective-deep': {
      const workItemCtx = (spec.context?.workItem ?? {}) as { number?: number };
      const workItemNumber = workItemCtx.number ?? 0;
      const base = {
        outcome: 'success' as const,
        workItemNumber,
        summary: {
          wentWell: 'E2E mock run completed successfully',
          didNotGoWell: 'Nothing — this is a mock',
          architecturalTakeaway: 'MOCK_AGENTS=true bypasses real model calls',
        },
        improvementCandidates: [],
        decisionSummaries: [{ kind: 'INSIGHT' as const, summary: 'Mock retro for e2e test' }],
      };
      if (spec.skill === 'retrospective-deep') {
        return {
          output: {
            ...base,
            triggerReasons: ['e2e-mock'],
            personaQualityScores: [],
            learningEntries: [],
            decisionPatterns: [],
          },
          decisionSummaries: base.decisionSummaries,
          events: [],
        };
      }
      return {
        output: base,
        decisionSummaries: base.decisionSummaries,
        events: [],
      };
    }

    case 'resolve-conflict': {
      if (testOutcome === 'unresolvable') {
        return {
          output: {
            resolved: [],
            unresolvable: ['mock-conflict.ts'],
            confidence: 'low',
            decisionSummaries: [
              { kind: 'VERDICT', summary: 'Mock resolve-conflict unresolvable for e2e test' },
            ],
          },
          decisionSummaries: [
            { kind: 'VERDICT', summary: 'Mock resolve-conflict unresolvable for e2e test' },
          ],
          events: [],
        };
      }
      return {
        output: {
          resolved: ['mock-conflict.ts'],
          unresolvable: [],
          confidence: 'high',
          decisionSummaries: [
            { kind: 'VERDICT', summary: 'Mock resolve-conflict resolved for e2e test' },
          ],
        },
        decisionSummaries: [
          { kind: 'VERDICT', summary: 'Mock resolve-conflict resolved for e2e test' },
        ],
        events: [],
      };
    }

    default:
      throw new Error(`resolveMockOutput: no preset for skill "${spec.skill}"`);
  }
}
