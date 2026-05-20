import { describe, expect, it } from 'vitest';
import {
  GRILL_QUESTION_MARKER,
  GRILL_REPLY_MARKER,
  isGrillQuestion,
  isGrillReply,
  isGrillThreadComment,
  parseRecommendedAnswer,
  selectGrillThreadComments,
  stripGrillMarker,
  stripRecommendedAnswer,
} from './grill-comments';

describe('grill-comments', () => {
  it('classifies only strict grill thread markers', () => {
    expect(isGrillThreadComment(`${GRILL_QUESTION_MARKER}\nQ?`)).toBe(true);
    expect(isGrillThreadComment(`${GRILL_REPLY_MARKER}\nA.`)).toBe(true);
    expect(isGrillThreadComment('<!-- factory:system -->\nState changed.')).toBe(false);
    expect(isGrillThreadComment('<!-- factory:prd -->\n# PRD')).toBe(false);
    expect(isGrillThreadComment('[Investigate] Escalated')).toBe(false);
    expect(isGrillThreadComment(`text before ${GRILL_QUESTION_MARKER}`)).toBe(false);
  });

  it('classifies question and reply markers separately', () => {
    expect(isGrillQuestion(`${GRILL_QUESTION_MARKER}\nQ?`)).toBe(true);
    expect(isGrillQuestion(`${GRILL_REPLY_MARKER}\nA.`)).toBe(false);
    expect(isGrillReply(`${GRILL_REPLY_MARKER}\nA.`)).toBe(true);
    expect(isGrillReply(`${GRILL_QUESTION_MARKER}\nQ?`)).toBe(false);
  });

  it('strips grill markers for display', () => {
    expect(stripGrillMarker(`${GRILL_QUESTION_MARKER}\nQ?`)).toBe('Q?');
    expect(stripGrillMarker(`${GRILL_REPLY_MARKER}\nA.`)).toBe('A.');
    expect(stripGrillMarker('plain comment')).toBe('plain comment');
  });

  it('parses and strips recommended answers', () => {
    const body = `${GRILL_QUESTION_MARKER}\nQ?\n<!-- factory:recommended-answer -->\nSuggested.`;

    expect(parseRecommendedAnswer(body)).toBe('Suggested.');
    expect(stripRecommendedAnswer(stripGrillMarker(body))).toBe('Q?');
    expect(parseRecommendedAnswer(`${GRILL_QUESTION_MARKER}\nQ?`)).toBeNull();
  });

  it('selects legacy unmarked replies only after a marked grill question', () => {
    const selected = selectGrillThreadComments([
      { body: 'Plain comment before grill.' },
      { body: `${GRILL_QUESTION_MARKER}\nQ?` },
      { body: 'Legacy plain reply.' },
      { body: '<!-- factory:system -->\nSystem note.' },
      { body: '[Investigate] Escalated\nNeeds research.' },
      { body: `${GRILL_REPLY_MARKER}\nMarked reply.` },
    ]);

    expect(selected.map((comment) => comment.body)).toEqual([
      `${GRILL_QUESTION_MARKER}\nQ?`,
      'Legacy plain reply.',
      `${GRILL_REPLY_MARKER}\nMarked reply.`,
    ]);
  });
});
