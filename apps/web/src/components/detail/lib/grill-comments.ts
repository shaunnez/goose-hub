export const GRILL_QUESTION_MARKER = '<!-- factory:grill-question -->';
export const GRILL_REPLY_MARKER = '<!-- factory:grill-reply -->';

const RECOMMENDED_ANSWER_MARKER = '<!-- factory:recommended-answer -->';
const NON_GRILL_THREAD_PREFIXES = [
  '<!-- factory:prd -->',
  '<!-- factory:system -->',
  '## Child issues',
  '[Investigate] Escalated',
] as const;

export function isGrillQuestion(body: string): boolean {
  return body.startsWith(GRILL_QUESTION_MARKER);
}

export function isGrillReply(body: string): boolean {
  return body.startsWith(GRILL_REPLY_MARKER);
}

export function isGrillThreadComment(body: string): boolean {
  return isGrillQuestion(body) || isGrillReply(body);
}

function isKnownNonGrillThreadComment(body: string): boolean {
  return NON_GRILL_THREAD_PREFIXES.some((prefix) => body.startsWith(prefix));
}

export function selectGrillThreadComments<T extends { body: string }>(comments: readonly T[]): T[] {
  let hasSeenGrillQuestion = false;

  return comments.filter((comment) => {
    if (isGrillQuestion(comment.body)) {
      hasSeenGrillQuestion = true;
      return true;
    }

    if (isGrillReply(comment.body)) {
      return true;
    }

    return hasSeenGrillQuestion && !isKnownNonGrillThreadComment(comment.body);
  });
}

export function stripGrillMarker(body: string): string {
  if (isGrillQuestion(body)) {
    return body.slice(GRILL_QUESTION_MARKER.length).trimStart();
  }
  if (isGrillReply(body)) {
    return body.slice(GRILL_REPLY_MARKER.length).trimStart();
  }
  return body;
}

export function parseRecommendedAnswer(body: string): string | null {
  const idx = body.indexOf(RECOMMENDED_ANSWER_MARKER);
  if (idx === -1) return null;
  return body.slice(idx + RECOMMENDED_ANSWER_MARKER.length).trimStart() || null;
}

export function stripRecommendedAnswer(body: string): string {
  const idx = body.indexOf(RECOMMENDED_ANSWER_MARKER);
  if (idx === -1) return body;
  return body.slice(0, idx).trimEnd();
}
