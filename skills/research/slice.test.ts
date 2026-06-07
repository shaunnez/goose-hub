import { describe, expect, it } from 'vitest';
import { ResearchSchema } from './schema.js';
import config from './skill.config.js';

const validResearchOutput = {
  summary: 'Settings currently exposes registered skills from SKILL_BUDGETS.',
  answer: 'Research should be added as a distinct read-only skill and routed by the server.',
  evidence: [
    {
      file: 'core/agent-runtime/budgets.ts',
      line: 50,
      claim: 'SKILL_BUDGETS controls registered skill runtime defaults.',
      confidence: 'high',
    },
  ],
  options: [
    {
      title: 'Add research as a first-class workflow',
      tradeoffs: ['More wiring, but clearer lifecycle boundaries.'],
      files: ['slices/research/workflow.ts'],
      confidence: 'high',
    },
  ],
  followUpWork: [
    {
      type: 'feature',
      title: 'Implement research workflow dispatch',
      rationale: 'Research-pending currently lacks executable dispatch.',
      actionable: true,
    },
  ],
  actionability: 'directly-actionable',
  openQuestions: [],
  decisionSummaries: [
    {
      kind: 'PLAN',
      summary: 'Research found one directly actionable follow-up for the workflow.',
      evidence: 'The workflow catalog already declares research-pending.',
    },
  ],
};

describe('ResearchSchema', () => {
  it('accepts a complete research artifact', () => {
    expect(ResearchSchema.safeParse(validResearchOutput).success).toBe(true);
  });

  it('requires populated decision summaries', () => {
    const result = ResearchSchema.safeParse({
      ...validResearchOutput,
      decisionSummaries: [],
    });
    expect(result.success).toBe(false);
  });

  it('does not accept final routing recommendations from the agent', () => {
    const result = ResearchSchema.safeParse({
      ...validResearchOutput,
      recommendedNextState: 'factory:dev-ready',
    });
    expect(result.success).toBe(false);
  });

  it('does not contain bug-only investigation fields', () => {
    const result = ResearchSchema.safeParse({
      ...validResearchOutput,
      fixHint: {
        file: 'core/example.ts',
        line: 1,
        currentCode: 'old',
        suggestedApproach: 'new',
      },
      requiresBrowserRepro: false,
    });
    expect(result.success).toBe(false);
  });
});

describe('research skill config', () => {
  it('is a read-only researcher skill with work item and scout digest context', () => {
    expect(config.role).toBe('researcher');
    expect(config.toolBundles).toEqual(['read']);
    expect(config.contextAllowlist).toEqual(['workItem', 'scoutDigest']);
  });

  it('does not pin a model separate from SKILL_BUDGETS', () => {
    expect(config.modelPin).toBeUndefined();
  });

  it('validates research context and rejects unrelated context', () => {
    expect(
      config.contextSchema.safeParse({
        workItem: { title: 'Research workflow', body: 'What should happen?', number: 12 },
      }).success,
    ).toBe(true);

    expect(
      config.contextSchema.safeParse({
        workItem: { title: 'Research workflow', body: 'What should happen?', number: 12 },
        implementationPlan: 'not allowed',
      }).success,
    ).toBe(false);
  });
});
