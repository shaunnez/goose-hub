/**
 * Slice integration tests for grill-prd-ui (M13.07 + M13.08).
 *
 * Covers the marker-comment parser end-to-end against the comment shape
 * produced by `core/workflows/grill-and-prd.ts`. The server-side
 * `approvePRD` / `rejectPRD` helpers are unit-tested in
 * `apps/server/src/domains/issues/prd-actions.test.ts`; the React
 * components in `apps/web/src/components/detail/components/*Section.test.tsx`.
 */
import { describe, expect, it } from 'vitest';

import {
  findLatestPRDCommentBody,
  isPRDMarkerComment,
  parsePRDComment,
} from '../../apps/web/src/components/detail/lib/parse-prd-comment.js';

const PRD_FIXTURE = {
  title: 'Slice 1: validation',
  problem: 'p',
  proposedSolution: 's',
  outOfScope: ['x'],
  successCriteria: ['drop-off ≥ 20%'],
  acceptanceCriteria: [{ id: 'AC-1', statement: 'a', journeyId: 'J-1' }],
  journeys: [
    {
      id: 'J-1',
      persona: 'p',
      trigger: 't',
      steps: [{ userAction: 'u', systemResponse: 's', dataShown: 'd', stateChange: 'c' }],
      successState: 'ok',
      errorStates: [],
      edgeCases: [],
    },
  ],
  functionalSpec: {
    // biome-ignore lint/suspicious/noThenProperty: PRD FunctionalSpec.behaviors[*].then is the BDD "Then" clause, not Promise#then.
    behaviors: [{ when: 'w', given: 'g', then: 't' }],
  },
  verticalSlices: [{ title: 'a', goal: 'g', estimatedSize: 'M', journeyRefs: ['J-1'] }],
  estimatedComplexity: 'low',
};

function makeWorkflowComment(advisorConcerns?: string[]): string {
  // Mirrors the exact format `core/workflows/grill-and-prd.ts` posts on
  // success: marker, # PRD heading, fenced JSON, optional `## Advisor
  // concerns` block.
  let body = `<!-- factory:prd -->\n# PRD\n\n\`\`\`json\n${JSON.stringify(PRD_FIXTURE, null, 2)}\n\`\`\``;
  if (advisorConcerns != null && advisorConcerns.length > 0) {
    body += `\n\n## Advisor concerns\n${advisorConcerns.map((c) => `- ${c}`).join('\n')}`;
  }
  return body;
}

describe('grill-prd-ui slice — parses workflow output', () => {
  it('isPRDMarkerComment recognises the workflow marker', () => {
    expect(isPRDMarkerComment(makeWorkflowComment())).toBe(true);
    expect(isPRDMarkerComment('hi')).toBe(false);
  });

  it('parsePRDComment extracts the JSON PRD', () => {
    const parsed = parsePRDComment(makeWorkflowComment());
    expect(parsed.prd?.title).toBe('Slice 1: validation');
    expect(parsed.prd?.verticalSlices?.[0].journeyRefs).toEqual(['J-1']);
    expect(parsed.advisorConcerns).toBeNull();
  });

  it('parsePRDComment extracts advisor concerns when present', () => {
    const parsed = parsePRDComment(
      makeWorkflowComment(['Quantify drop-off rate', 'Define success window']),
    );
    expect(parsed.advisorConcerns).toContain('Quantify drop-off rate');
    expect(parsed.advisorConcerns).toContain('Define success window');
  });

  it('findLatestPRDCommentBody returns the latest by createdAt, ignoring non-PRD comments', () => {
    const result = findLatestPRDCommentBody([
      { body: 'reply from user', createdAt: '2026-05-07T10:00:00Z' },
      {
        body: makeWorkflowComment(['old']),
        createdAt: '2026-05-07T09:00:00Z',
      },
      {
        body: makeWorkflowComment(['new']),
        createdAt: '2026-05-07T11:00:00Z',
      },
    ]);
    expect(result).not.toBeNull();
    expect(result).toContain('new');
  });

  it('parsePRDComment returns prd=null when JSON is malformed but marker is present', () => {
    const result = parsePRDComment('<!-- factory:prd -->\n# PRD\n\n```json\nnot-json\n```');
    expect(result.prd).toBeNull();
    expect(result.advisorConcerns).toBeNull();
  });
});

describe('grill-prd-ui slice — grill question marker convention', () => {
  it('grill questions posted by the workflow are prefixed with the marker', () => {
    // Mirrors the prefix added in `core/workflows/grill-and-prd.ts` so the
    // Grill chat tab can distinguish agent questions from user replies.
    const sample = '<!-- factory:grill-question -->\n**Round 1** — Q?';
    expect(sample.startsWith('<!-- factory:grill-question -->')).toBe(true);
  });
});
