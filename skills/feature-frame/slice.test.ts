import { describe, expect, it } from 'vitest';
import { FeatureFrameOutputSchema } from './schema.js';
import config from './skill.config.js';

describe('FeatureFrameOutputSchema', () => {
  const validOutput = {
    framedContent:
      '## Framed feature intent\nClarify saved reports for operators.\n\n## Proposed acceptance criteria\n- Users can save a filtered report.',
    refinedIntent: 'Add saved filtered reports for operators.',
    proposedAcceptanceCriteria: [
      'Users can save the current report filters with a readable name.',
      'Saved reports can be reopened from the reports page.',
    ],
    groundedHints: {
      candidateFiles: [
        {
          path: 'apps/web/src/components/reports/ReportsPage.tsx',
          confidence: 'medium',
          source: 'component-fuzzy',
          reason: 'Likely owner of report filters.',
        },
      ],
      candidateComponents: [
        { name: 'ReportsPage', file: 'apps/web/src/components/reports/ReportsPage.tsx' },
      ],
      candidateRoutes: [{ pattern: '/reports', component: 'ReportsPage' }],
    },
    stillNeedsGrilling: false,
    decisionSummaries: [
      {
        kind: 'PLAN',
        summary: 'Framed the saved reports feature and found enough criteria for PRD drafting.',
        evidence: 'Original work item named reports and filters.',
      },
    ],
  };

  it('accepts the append-only feature framing output shape', () => {
    const result = FeatureFrameOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  it('requires refinedIntent for the skip-grill PRD path', () => {
    const { refinedIntent: _refinedIntent, ...withoutIntent } = validOutput;
    const result = FeatureFrameOutputSchema.safeParse(withoutIntent);
    expect(result.success).toBe(false);
  });

  it('requires populated decision summaries', () => {
    const result = FeatureFrameOutputSchema.safeParse({
      ...validOutput,
      decisionSummaries: [],
    });
    expect(result.success).toBe(false);
  });

  it('reuses the bug-enhance grounded hints shape', () => {
    const result = FeatureFrameOutputSchema.safeParse({
      ...validOutput,
      groundedHints: {
        candidateFiles: [{ path: 'apps/web/src/x.tsx', confidence: 'maybe' }],
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('feature-frame skill config', () => {
  it('is a read-only triager skill with narrow work-item context', () => {
    expect(config.role).toBe('triager');
    expect(config.freshContext).toBe(false);
    expect(config.toolBundles).toEqual(['read']);
    expect(config.contextAllowlist).toEqual(['workItem']);
  });

  it('defaults to sonnet for the first shipping version', () => {
    expect(config.modelPin).toBe('sonnet');
  });

  it('validates only the work item context', () => {
    const result = config.contextSchema.safeParse({
      workItem: {
        title: 'Saved reports',
        body: 'Let people save report filters somehow.',
        number: 1046,
      },
    });
    expect(result.success).toBe(true);

    const extraContext = config.contextSchema.safeParse({
      workItem: { title: 'Saved reports', body: 'x' },
      projectContext: 'should not be accepted',
    });
    expect(extraContext.success).toBe(false);
  });
});
