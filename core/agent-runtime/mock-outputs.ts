import type { AgentResult, AgentSpec } from './interface.js';

export function resolveMockOutput(spec: AgentSpec): AgentResult {
  switch (spec.skill) {
    case 'triage': {
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
          decisionSummaries: [{ step: 'classify', summary: `Classified as ${type} for e2e` }],
        },
        decisionSummaries: [{ step: 'classify', summary: `Classified as ${type} for e2e` }],
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
          prUrl: 'https://github.com/shaunnez/goose-hub/pull/999',
          evidenceSpecPath: null,
          confidence: 'high',
          decisionSummaries: [{ step: 'implement', summary: 'Mock implementation for e2e test' }],
        },
        decisionSummaries: [{ step: 'implement', summary: 'Mock implementation for e2e test' }],
        events: [],
      };

    case 'investigate':
      return {
        output: {
          findings: 'E2E mock findings',
          keyFiles: [],
          confidence: 'high',
          openQuestions: [],
          decisionSummaries: [{ step: 'investigate', summary: 'Mock investigation for e2e test' }],
        },
        decisionSummaries: [{ step: 'investigate', summary: 'Mock investigation for e2e test' }],
        events: [],
      };

    case 'qa':
      return {
        output: {
          verdict: 'pass',
          tier: 'functional',
          criteriaResults: [],
          decisionSummaries: [{ step: 'qa', summary: 'Mock QA pass for e2e test' }],
        },
        decisionSummaries: [{ step: 'qa', summary: 'Mock QA pass for e2e test' }],
        events: [],
      };

    case 'review':
      return {
        output: {
          verdict: 'approved',
          feedback: null,
          decisionSummaries: [{ step: 'review', summary: 'Mock review approval for e2e test' }],
        },
        decisionSummaries: [{ step: 'review', summary: 'Mock review approval for e2e test' }],
        events: [],
      };

    default:
      throw new Error(`resolveMockOutput: no preset for skill "${spec.skill}"`);
  }
}
