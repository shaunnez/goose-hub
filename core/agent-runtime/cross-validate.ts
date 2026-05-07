import type { ScoutFinding, ScoutReport } from './swarm.js';

/**
 * Cross-validation step between Wave 1 and Wave 2 (M19.01, ADR 0030).
 *
 * Detects contradictions across scout reports: when two or more scouts
 * report differing facts at the *same* `file[:line]` location.
 *
 * Same `file:line` + identical `fact` text = agreement (no contradiction).
 * Same `file:line` + differing `fact` text = contradiction.
 *
 * Per Steve's planning protocol (Harness 101 slide 4 line 103), this gate
 * runs BEFORE Wave 2 dispatches, so Wave 2 deep agents see only
 * cross-validated facts.
 */

export interface ContradictionFact {
  scoutName: string;
  fact: string;
  confidence: ScoutFinding['confidence'];
}

export interface Contradiction {
  /** File the contradiction applies to. */
  file: string;
  /** Line number, when present in the underlying findings. */
  line?: number;
  /** Distinct facts reported at this location. */
  facts: ContradictionFact[];
  /** Distinct scout names that contributed to this contradiction. */
  scouts: string[];
}

export interface CrossValidationResult {
  contradictions: Contradiction[];
  hasContradictions: boolean;
}

/**
 * Cross-validate Wave-1 scout reports. Only `status: 'ok'` reports
 * contribute findings — failed/timeout reports are ignored to avoid
 * surfacing spurious contradictions on incomplete data.
 */
export function crossValidate(reports: ScoutReport[]): CrossValidationResult {
  // Group findings by `file::line` (line absent → "?").
  const groups = new Map<string, ContradictionFact[]>();
  for (const report of reports) {
    if (report.status !== 'ok') continue;
    for (const finding of report.findings) {
      const key = `${finding.file}::${finding.line ?? '?'}`;
      let arr = groups.get(key);
      if (arr == null) {
        arr = [];
        groups.set(key, arr);
      }
      arr.push({
        scoutName: report.scoutName,
        fact: finding.fact,
        confidence: finding.confidence,
      });
    }
  }

  const contradictions: Contradiction[] = [];
  for (const [key, facts] of groups) {
    // Agreement: every fact at the same key reports the same `fact` text.
    const distinctFacts = new Set(facts.map((f) => f.fact));
    if (distinctFacts.size <= 1) continue;
    const sep = key.lastIndexOf('::');
    const file = key.slice(0, sep);
    const lineRaw = key.slice(sep + 2);
    const line = lineRaw === '?' ? undefined : Number(lineRaw);

    contradictions.push({
      file,
      line,
      facts,
      scouts: Array.from(new Set(facts.map((f) => f.scoutName))),
    });
  }

  return { contradictions, hasContradictions: contradictions.length > 0 };
}
