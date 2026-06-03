import type { ScoutFinding, ScoutReport } from './swarm.js';

/**
 * Cross-validation step between Wave 1 and Wave 2 (M19.01, ADR 0030).
 *
 * Detects contradictions across scout reports: when two or more scouts
 * report differing facts at the *same* `file[:line]` location.
 *
 * Same `file:line` + compatible fact text = agreement (no contradiction).
 * Same `file:line` + explicit incompatible fact text = contradiction.
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
  /** Only blocking contradictions should influence routing escalation. */
  isBlocking: boolean;
  severity: 'semantic' | 'wording';
}

export interface CrossValidationResult {
  contradictions: Contradiction[];
  hasContradictions: boolean;
}

function normalizeFact(fact: string): string {
  return fact
    .toLowerCase()
    .replace(/[`"'.,:;()[\]{}]/g, ' ')
    .replace(
      /\b(the|a|an|this|that|there|is|are|was|were|be|being|been|it|to|of|in|on|at|for|with|from|by|as|and|or)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function hasExplicitNegation(fact: string): boolean {
  return /\b(no|not|never|without|missing|absent|false|disabled|cannot|can't|doesn't|does not|isn't|is not|aren't|are not|won't|will not|instead of|rather than)\b/i.test(
    fact,
  );
}

function factTokens(fact: string): string[] {
  return normalizeFact(fact)
    .split(' ')
    .filter((token) => token.length >= 3)
    .map((token) => (token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token));
}

function contradictsExplicitly(a: string, b: string): boolean {
  const na = normalizeFact(a);
  const nb = normalizeFact(b);
  if (na === nb) return false;
  const aNeg = hasExplicitNegation(a);
  const bNeg = hasExplicitNegation(b);
  if (aNeg === bNeg) return false;

  const positive = aNeg ? nb : na;
  const negative = aNeg ? na : nb;
  const positiveTokens = new Set(factTokens(positive));
  const negativeTokens = factTokens(negative);
  const overlap = negativeTokens.filter((token) => positiveTokens.has(token)).length;
  return overlap >= Math.min(2, positiveTokens.size);
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
    if (report.status !== 'ok' || report.outcome === 'skipped') continue;
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
    // Agreement: every fact at the same key reports compatible text. Different
    // scouts often describe the same location with different wording; do not
    // escalate unless the facts contain an explicit semantic incompatibility.
    const distinctFacts = new Set(facts.map((f) => normalizeFact(f.fact)));
    if (distinctFacts.size <= 1) continue;
    // Cross-scout discipline: a single scout reporting multiple distinct
    // facts at the same file:line is a *catalog*, not a contradiction. Wave
    // 1 contradictions are about scouts disagreeing — not about one scout
    // listing several adjacent observations. Require at least two distinct
    // scout names to flag.
    const distinctScouts = new Set(facts.map((f) => f.scoutName));
    if (distinctScouts.size < 2) continue;
    let isBlocking = false;
    for (let i = 0; i < facts.length && !isBlocking; i++) {
      for (let j = i + 1; j < facts.length; j++) {
        if (
          facts[i].scoutName !== facts[j].scoutName &&
          contradictsExplicitly(facts[i].fact, facts[j].fact)
        ) {
          isBlocking = true;
          break;
        }
      }
    }
    if (!isBlocking) continue;
    const sep = key.lastIndexOf('::');
    const file = key.slice(0, sep);
    const lineRaw = key.slice(sep + 2);
    const line = lineRaw === '?' ? undefined : Number(lineRaw);

    contradictions.push({
      file,
      line,
      facts,
      scouts: Array.from(distinctScouts),
      isBlocking,
      severity: isBlocking ? 'semantic' : 'wording',
    });
  }

  return { contradictions, hasContradictions: contradictions.length > 0 };
}
