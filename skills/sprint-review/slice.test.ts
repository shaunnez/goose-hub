import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import { SprintReviewOutputSchema } from './schema.js';
import config, { SprintReviewContextSchema } from './skill.config.js';

const baseValid = {
  milestoneTitle: 'M13: Subagents',
  shipped: [
    '#301: Add sprint-review skill scaffold',
    '#302: Wire retrospector role to milestone trigger',
  ],
  deferred: ['Persona quality score decay — moved to M14'],
  retroThemes: ['TDD discipline consistent', 'Scope creep risk on multi-file changes'],
  nextSprintSuggestions: [
    'Add e2eCommand to project config so regression checks run automatically.',
  ],
  decisionSummaries: [
    {
      kind: 'VERDICT' as const,
      summary: 'Sprint review complete for M13: 2 shipped, 1 deferred.',
    },
  ],
};

describe('SprintReviewOutputSchema', () => {
  it('accepts valid full output', () => {
    expect(SprintReviewOutputSchema.safeParse(baseValid).success).toBe(true);
  });

  it('rejects empty milestone (all arrays empty, no decisionSummaries)', () => {
    const result = SprintReviewOutputSchema.safeParse({
      milestoneTitle: 'M13: Subagents',
      shipped: [],
      deferred: [],
      retroThemes: [],
      nextSprintSuggestions: [],
      decisionSummaries: [],
    });
    expect(result.success).toBe(false);
  });

  it('accepts empty milestone with one decisionSummary', () => {
    const result = SprintReviewOutputSchema.safeParse({
      milestoneTitle: 'M13: Subagents',
      shipped: [],
      deferred: [],
      retroThemes: [],
      nextSprintSuggestions: [],
      decisionSummaries: [{ kind: 'VERDICT', summary: 'No issues shipped this milestone.' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts partial milestone (shipped only, other arrays empty)', () => {
    const result = SprintReviewOutputSchema.safeParse({
      milestoneTitle: 'M13: Subagents',
      shipped: ['#301: Add sprint-review skill scaffold'],
      deferred: [],
      retroThemes: [],
      nextSprintSuggestions: [],
      decisionSummaries: [{ kind: 'VERDICT', summary: 'Partial milestone: 1 shipped.' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing milestoneTitle', () => {
    const { milestoneTitle: _omit, ...withoutTitle } = baseValid;
    expect(SprintReviewOutputSchema.safeParse(withoutTitle).success).toBe(false);
  });

  it('rejects empty milestoneTitle string', () => {
    expect(
      SprintReviewOutputSchema.safeParse({ ...baseValid, milestoneTitle: '' }).success,
    ).toBe(false);
  });

  it('zod toJSONSchema roundtrip produces valid JSON Schema object', () => {
    const jsonSchema = toJSONSchema(SprintReviewOutputSchema);
    expect(typeof jsonSchema).toBe('object');
    expect(jsonSchema).not.toBeNull();
    expect(jsonSchema).toHaveProperty('properties');
  });
});

describe('sprint-review skill config', () => {
  it('has role retrospector', () => {
    expect(config.role).toBe('retrospector');
  });

  it('is pinned to sonnet model', () => {
    expect(config.modelPin).toBe('sonnet');
  });

  it('does not require fresh context', () => {
    expect(config.freshContext).toBe(false);
  });

  it('includes core toolBundle', () => {
    expect(config.toolBundles).toContain('core');
  });

  it('contextSchema validates valid context', () => {
    const valid = SprintReviewContextSchema.safeParse({
      milestone: { title: 'M13: Subagents', number: 13 },
      closedIssues: [{ number: 301, title: 'Add sprint-review skill', labels: ['feature'] }],
      retroOutputs: [
        {
          workItemNumber: 301,
          summary: {
            wentWell: 'Tests all pass',
            didNotGoWell: 'Clean run',
            architecturalTakeaway: 'Followed vertical slice pattern',
          },
        },
      ],
      improvementCandidates: [
        { kind: 'skill-prompt', suggestionText: 'Clarify instructions', confidence: 'high' },
      ],
    });
    expect(valid.success).toBe(true);
  });

  it('contextSchema accepts empty arrays for closedIssues, retroOutputs, improvementCandidates', () => {
    const valid = SprintReviewContextSchema.safeParse({
      milestone: { title: 'M13: Subagents', number: 13 },
      closedIssues: [],
      retroOutputs: [],
      improvementCandidates: [],
    });
    expect(valid.success).toBe(true);
  });

  it('contextSchema rejects missing milestone', () => {
    expect(
      SprintReviewContextSchema.safeParse({
        closedIssues: [],
        retroOutputs: [],
        improvementCandidates: [],
      }).success,
    ).toBe(false);
  });

  it('contextSchema rejects missing milestone.title', () => {
    expect(
      SprintReviewContextSchema.safeParse({
        milestone: { number: 13 },
        closedIssues: [],
        retroOutputs: [],
        improvementCandidates: [],
      }).success,
    ).toBe(false);
  });

  it('contextSchema accepts retroOutput with optional learningEntries', () => {
    const valid = SprintReviewContextSchema.safeParse({
      milestone: { title: 'M13', number: 13 },
      closedIssues: [],
      retroOutputs: [
        {
          workItemNumber: 42,
          summary: {
            wentWell: 'Good',
            didNotGoWell: 'None',
            architecturalTakeaway: 'N/A',
          },
          learningEntries: [{ observation: 'something', rationale: 'because', improvementKind: 'workflow', confidence: 'low' }],
        },
      ],
      improvementCandidates: [],
    });
    expect(valid.success).toBe(true);
  });
});
