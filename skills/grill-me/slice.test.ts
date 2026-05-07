import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import { GrillMeOutputSchema } from './schema.js';
import config, { GrillMeContextSchema } from './skill.config.js';

describe('grill-me schema', () => {
  it('accepts valid output with all required fields', () => {
    const result = GrillMeOutputSchema.safeParse({
      questions: ['Is this feature intended for admin users only, or all users?'],
      refinedIntent: 'Add a role-scoped notification preference panel to the settings page.',
      readyForPRD: false,
      decisionSummaries: [
        {
          kind: 'PLAN',
          summary: 'Asked about user scope to narrow the implementation surface.',
          evidence: 'work item body mentions "notification settings" without specifying audience',
        },
        {
          kind: 'UNCERTAINTY',
          summary: 'Role scoping is still unknown after round 1.',
          evidence: 'No prior replies yet',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty questions array when readyForPRD is true', () => {
    const result = GrillMeOutputSchema.safeParse({
      questions: [],
      refinedIntent:
        'Implement an admin-only CSV export of the audit log with date-range filtering.',
      readyForPRD: true,
      decisionSummaries: [
        {
          kind: 'VERDICT',
          summary: 'Intent is sufficiently precise to write a PRD.',
          evidence: 'All scope, audience, and success conditions resolved in prior rounds',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts questions array with one entry', () => {
    const result = GrillMeOutputSchema.safeParse({
      questions: ['What does success look like for this feature after one month?'],
      refinedIntent: 'Improve user onboarding flow to reduce drop-off at the profile step.',
      readyForPRD: false,
      decisionSummaries: [{ kind: 'UNCERTAINTY', summary: 'Success criteria are undefined.' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing decisionSummaries', () => {
    const result = GrillMeOutputSchema.safeParse({
      questions: ['What is the scope?'],
      refinedIntent: 'Something.',
      readyForPRD: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty decisionSummaries array', () => {
    const result = GrillMeOutputSchema.safeParse({
      questions: [],
      refinedIntent: 'Something.',
      readyForPRD: true,
      decisionSummaries: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing refinedIntent', () => {
    const result = GrillMeOutputSchema.safeParse({
      questions: ['What is the scope?'],
      readyForPRD: false,
      decisionSummaries: [{ kind: 'PLAN', summary: 'ok' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing readyForPRD', () => {
    const result = GrillMeOutputSchema.safeParse({
      questions: [],
      refinedIntent: 'Something.',
      decisionSummaries: [{ kind: 'PLAN', summary: 'ok' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts evidence as optional on DecisionSummary', () => {
    const result = GrillMeOutputSchema.safeParse({
      questions: ['Who are the primary users?'],
      refinedIntent: 'Build a dashboard for tracking deployment frequency.',
      readyForPRD: false,
      decisionSummaries: [{ kind: 'PLAN', summary: 'Asked about audience.' }],
    });
    expect(result.success).toBe(true);
  });

  it('zod toJSONSchema roundtrip produces valid JSON Schema object', () => {
    const jsonSchema = toJSONSchema(GrillMeOutputSchema);
    expect(typeof jsonSchema).toBe('object');
    expect(jsonSchema).not.toBeNull();
    expect(jsonSchema).toHaveProperty('properties');
  });
});

describe('grill-me skill config', () => {
  it('has role griller', () => {
    expect(config.role).toBe('griller');
  });

  it('has toolBundles containing core', () => {
    expect(config.toolBundles).toContain('core');
  });

  it('is pinned to sonnet model', () => {
    expect(config.modelPin).toBe('sonnet');
  });

  it('does not require fresh context', () => {
    expect(config.freshContext).toBe(false);
  });

  it('contextAllowlist includes expected fields', () => {
    expect(config.contextAllowlist).toContain('workItem');
    expect(config.contextAllowlist).toContain('priorReplies');
    expect(config.contextAllowlist).toContain('roundNumber');
  });

  it('contextSchema validates full valid input', () => {
    const result = GrillMeContextSchema.safeParse({
      workItem: {
        title: 'Add dark mode toggle',
        body: 'Users want a dark mode option in the settings page.',
        number: 42,
      },
      priorReplies: [
        { role: 'agent', content: 'Is this for all users or a specific tier?' },
        { role: 'user', content: 'All users.' },
      ],
      roundNumber: 2,
    });
    expect(result.success).toBe(true);
  });

  it('contextSchema allows empty priorReplies for round 1', () => {
    const result = GrillMeContextSchema.safeParse({
      workItem: {
        title: 'Add dark mode toggle',
        body: 'Users want a dark mode option in the settings page.',
        number: 42,
      },
      priorReplies: [],
      roundNumber: 1,
    });
    expect(result.success).toBe(true);
  });

  it('contextSchema rejects missing workItem', () => {
    const result = GrillMeContextSchema.safeParse({
      priorReplies: [],
      roundNumber: 1,
    });
    expect(result.success).toBe(false);
  });

  it('contextSchema rejects missing workItem.number', () => {
    const result = GrillMeContextSchema.safeParse({
      workItem: { title: 'Add dark mode toggle', body: 'Body text.' },
      priorReplies: [],
      roundNumber: 1,
    });
    expect(result.success).toBe(false);
  });

  it('contextSchema rejects missing roundNumber', () => {
    const result = GrillMeContextSchema.safeParse({
      workItem: { title: 'Title', body: 'Body.', number: 1 },
      priorReplies: [],
    });
    expect(result.success).toBe(false);
  });

  it('contextSchema rejects invalid priorReplies role value', () => {
    const result = GrillMeContextSchema.safeParse({
      workItem: { title: 'Title', body: 'Body.', number: 1 },
      priorReplies: [{ role: 'system', content: 'something' }],
      roundNumber: 1,
    });
    expect(result.success).toBe(false);
  });
});
