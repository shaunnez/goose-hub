export interface DecisionMarker {
  kind: string;
  summary: string;
  start: number;
  end: number;
}

export const DECISION_MARKER_RE_SOURCE = '^\\[decision\\]\\s+(?:([A-Z_]+):\\s*(.+)|(.+))$';

export function parseDecisionMarkers(text: string): DecisionMarker[] {
  const re = new RegExp(DECISION_MARKER_RE_SOURCE, 'gm');
  const markers: DecisionMarker[] = [];
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex iteration
  while ((match = re.exec(text)) !== null) {
    const kind = match[1] != null ? match[1].trim() : 'UNKNOWN';
    const summary = (match[2] ?? match[3] ?? '').trim();
    if (summary.length === 0) continue;
    markers.push({
      kind,
      summary,
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return markers;
}

export function parseDecisionMarkersAfter(
  text: string,
  previousEndOffset: number,
): DecisionMarker[] {
  return parseDecisionMarkers(text).filter((marker) => marker.start >= previousEndOffset);
}
