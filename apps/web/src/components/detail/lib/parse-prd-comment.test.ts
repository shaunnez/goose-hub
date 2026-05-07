import { describe, expect, it } from 'vitest';
import { findLatestPRDCommentBody, isPRDMarkerComment, parsePRDComment } from './parse-prd-comment';

const PRD_FIXTURE = {
  title: 'Inline validation in onboarding',
  problem: 'Users drop off at the profile step.',
  proposedSolution: 'Add field-level validation on blur.',
  outOfScope: ['Refactor wizard nav'],
  successCriteria: ['Drop-off decreases ≥ 20%'],
  acceptanceCriteria: [
    { id: 'AC-1', statement: 'Each field validates on blur', journeyId: 'J-1' },
    { id: 'AC-2', statement: 'Events logged to analytics', crossCutting: true },
  ],
  journeys: [
    {
      id: 'J-1',
      persona: 'New user',
      trigger: 'Reaches profile',
      steps: [
        {
          userAction: 'Tabs out of email',
          systemResponse: 'Renders inline error',
          dataShown: 'Error',
          stateChange: 'invalid',
        },
      ],
      successState: 'All fields valid',
      errorStates: [{ error: 'Network drops', recovery: 'Show retry' }],
      edgeCases: ['Pasted multiline'],
    },
  ],
  functionalSpec: {
    behaviors: [
      {
        when: 'Field loses focus with invalid value',
        given: 'User typed at least one char',
        // biome-ignore lint/suspicious/noThenProperty: PRD FunctionalSpec.behaviors[*].then is the BDD "Then" clause, not Promise#then.
        then: 'Inline error rendered',
      },
    ],
  },
  verticalSlices: [
    {
      title: 'Slice 1',
      goal: 'Add validation',
      estimatedSize: 'M',
      journeyRefs: ['J-1'],
    },
  ],
  estimatedComplexity: 'medium',
};

function makeBody(prd: unknown, advisor?: string): string {
  let body = `<!-- factory:prd -->\n# PRD\n\n\`\`\`json\n${JSON.stringify(prd, null, 2)}\n\`\`\``;
  if (advisor != null) body += `\n\n## Advisor concerns\n${advisor}`;
  return body;
}

describe('isPRDMarkerComment', () => {
  it('returns true when the body starts with the marker', () => {
    expect(isPRDMarkerComment('<!-- factory:prd -->\n# PRD')).toBe(true);
  });

  it('returns false for non-PRD comments', () => {
    expect(isPRDMarkerComment('Round 1 — what does better mean?')).toBe(false);
    expect(isPRDMarkerComment('# PRD\n```json\n{}\n```')).toBe(false);
  });
});

describe('parsePRDComment', () => {
  it('returns null PRD when body is not a PRD marker comment', () => {
    expect(parsePRDComment('hello world')).toEqual({ prd: null, advisorConcerns: null });
  });

  it('extracts a JSON-fenced PRD block', () => {
    const body = makeBody(PRD_FIXTURE);
    const result = parsePRDComment(body);
    expect(result.prd?.title).toBe('Inline validation in onboarding');
    expect(result.prd?.verticalSlices?.[0].title).toBe('Slice 1');
    expect(result.advisorConcerns).toBeNull();
  });

  it('extracts the advisor concerns block when present', () => {
    const body = makeBody(
      PRD_FIXTURE,
      '- The metric should be quantified.\n- Define success window.',
    );
    const result = parsePRDComment(body);
    expect(result.prd?.title).toBe('Inline validation in onboarding');
    expect(result.advisorConcerns).toContain('quantified');
    expect(result.advisorConcerns).toContain('success window');
  });

  it('returns prd=null when JSON is malformed but marker is present', () => {
    const body = '<!-- factory:prd -->\n# PRD\n\n```json\nnot-json\n```';
    expect(parsePRDComment(body).prd).toBeNull();
  });

  it('returns prd=null when no JSON fence is present', () => {
    const body = '<!-- factory:prd -->\n# PRD\n\nNo fence here.';
    expect(parsePRDComment(body).prd).toBeNull();
  });
});

describe('findLatestPRDCommentBody', () => {
  it('returns null when no comments are PRD markers', () => {
    expect(findLatestPRDCommentBody([{ body: 'hi', createdAt: '2026-01-01' }])).toBeNull();
  });

  it('returns the most recent PRD comment body by createdAt', () => {
    const older = makeBody({ ...PRD_FIXTURE, title: 'old' });
    const newer = makeBody({ ...PRD_FIXTURE, title: 'new' });
    const result = findLatestPRDCommentBody([
      { body: 'reply', createdAt: '2026-01-02' },
      { body: older, createdAt: '2026-01-01' },
      { body: newer, createdAt: '2026-01-03' },
    ]);
    expect(result).toContain('"title": "new"');
  });
});
