/**
 * Parse a `<!-- factory:prd -->` marker comment posted by the
 * grill-and-prd workflow. The body is markdown of the form:
 *
 *   <!-- factory:prd -->
 *   # PRD
 *
 *   ```json
 *   { ...PRDOutput... }
 *   ```
 *
 *   ## Advisor concerns        (optional)
 *   - concern 1
 *   - concern 2
 *
 * The PRD is rendered as a permissive `ParsedPRDView` view-model
 * (a structural subset of `PRDOutput` from skills/write-prd) so the UI
 * can render even slightly future-divergent shapes without throwing.
 */

export interface ParsedPRDView {
  title?: string;
  problem?: string;
  proposedSolution?: string;
  outOfScope?: string[];
  successCriteria?: string[];
  acceptanceCriteria?: Array<{
    id: string;
    statement: string;
    journeyId?: string;
    crossCutting?: boolean;
  }>;
  journeys?: Array<{
    id: string;
    persona: string;
    trigger: string;
    steps: Array<{
      userAction: string;
      systemResponse: string;
      dataShown: string;
      stateChange: string;
    }>;
    successState: string;
    errorStates: Array<{ error: string; recovery: string }>;
    edgeCases: string[];
  }>;
  functionalSpec?: {
    behaviors: Array<{ when: string; given: string; then: string }>;
  };
  verticalSlices?: Array<{
    title: string;
    goal: string;
    estimatedSize: 'S' | 'M' | 'L';
    journeyRefs: string[];
  }>;
  estimatedComplexity?: 'low' | 'medium' | 'high';
}

export interface ParsedPRDComment {
  prd: ParsedPRDView | null;
  advisorConcerns: string | null;
}

const MARKER = '<!-- factory:prd -->';
const JSON_FENCE = /```json\s*\n([\s\S]*?)\n```/;
const ADVISOR_HEADING = /\n##\s+Advisor concerns\s*\n/;

export function isPRDMarkerComment(body: string): boolean {
  return body.startsWith(MARKER);
}

/**
 * Find the most recent PRD marker comment from a list. Returns the body
 * string of the matching comment or `null` if none found.
 */
export function findLatestPRDCommentBody(
  comments: ReadonlyArray<{ body: string; createdAt: string }>,
): string | null {
  const matches = comments.filter((c) => isPRDMarkerComment(c.body));
  if (matches.length === 0) return null;
  // Iterate by createdAt — fall back to source order if dates collide.
  const sorted = [...matches].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return sorted[sorted.length - 1].body;
}

export function parsePRDComment(body: string): ParsedPRDComment {
  const empty: ParsedPRDComment = { prd: null, advisorConcerns: null };
  if (!isPRDMarkerComment(body)) return empty;

  const fenceMatch = body.match(JSON_FENCE);
  let prd: ParsedPRDView | null = null;
  if (fenceMatch != null) {
    try {
      prd = JSON.parse(fenceMatch[1]) as ParsedPRDView;
    } catch {
      prd = null;
    }
  }

  const advisorIdx = body.search(ADVISOR_HEADING);
  let advisorConcerns: string | null = null;
  if (advisorIdx >= 0) {
    advisorConcerns = body.slice(advisorIdx).replace(ADVISOR_HEADING, '').trimEnd();
  }

  return { prd, advisorConcerns };
}
