import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface TriggerSet {
  shouldTrigger: string[];
  shouldNotTrigger: string[];
}

export interface FailureEntry {
  prompt: string;
  expected: 'trigger' | 'not-trigger';
  actual: 'trigger' | 'not-trigger';
}

export interface DescriptionLoopResult {
  tpRate: number;
  tnRate: number;
  accuracy: number;
  failures: FailureEntry[];
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'shall',
  'can',
  'need',
  'dare',
  'ought',
  'used',
  'for',
  'of',
  'to',
  'in',
  'on',
  'at',
  'by',
  'from',
  'with',
  'about',
  'into',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'you',
  'your',
  'we',
  'our',
  'they',
  'their',
  'he',
  'she',
  'i',
  'my',
  'me',
  'when',
  'how',
  'what',
  'if',
  'so',
  'as',
  'not',
  'no',
  'any',
  'all',
  'each',
  'every',
  'both',
  'other',
  'which',
  'who',
  'whom',
  'than',
  'then',
  'up',
  'out',
  'only',
  'also',
  'just',
]);

/** Tokenises text into lowercase significant terms (stop words removed). */
function tokenise(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
  return new Set(tokens);
}

/**
 * Returns true if the prompt shares enough keyword overlap with the description
 * to be considered a trigger match. Threshold: ≥ 1 shared significant term OR
 * description terms that appear in the prompt cover ≥ 20% of desc vocab.
 */
function classifyTrigger(descTerms: Set<string>, promptText: string): boolean {
  if (descTerms.size === 0) return false;
  const promptTerms = tokenise(promptText);
  let overlap = 0;
  for (const t of descTerms) {
    if (promptTerms.has(t)) overlap++;
  }
  // Fire if ≥1 shared term AND overlap covers at least 20% of description vocab
  return overlap >= 1 && overlap / descTerms.size >= 0.2;
}

/**
 * Loads triggers.json for a skill. Returns null when the file does not exist
 * (skill has not opted in).
 */
export function loadTriggers(skillName: string, skillsRoot?: string): TriggerSet | null {
  const root = skillsRoot ?? resolve(import.meta.dirname ?? '', '..', '..', 'skills');
  const triggersPath = join(root, skillName, 'triggers.json');
  if (!existsSync(triggersPath)) return null;
  try {
    return JSON.parse(readFileSync(triggersPath, 'utf8')) as TriggerSet;
  } catch {
    return null;
  }
}

/**
 * Loads a skill's description from its `prompt.md` (first non-empty paragraph).
 * Falls back to an empty string when the file does not exist.
 */
export function loadSkillDescription(skillName: string, skillsRoot?: string): string {
  const root = skillsRoot ?? resolve(import.meta.dirname ?? '', '..', '..', 'skills');
  const promptPath = join(root, skillName, 'prompt.md');
  if (!existsSync(promptPath)) return '';
  try {
    const content = readFileSync(promptPath, 'utf8');
    // First non-heading, non-empty paragraph is the canonical description
    const firstParagraph =
      content.split(/\n\n+/).find((p) => {
        const t = p.trim();
        return t.length > 0 && !t.startsWith('#');
      }) ?? '';
    return firstParagraph.trim();
  } catch {
    return '';
  }
}

/**
 * Validates that a `TriggerSet` meets the minimum requirements.
 * Returns a list of violation strings (empty = valid).
 */
export function validateTriggers(triggers: TriggerSet): string[] {
  const violations: string[] = [];
  if (triggers.shouldTrigger.length < 3) {
    violations.push(
      `shouldTrigger must have at least 3 entries (got ${triggers.shouldTrigger.length})`,
    );
  }
  if (triggers.shouldNotTrigger.length < 3) {
    violations.push(
      `shouldNotTrigger must have at least 3 entries (got ${triggers.shouldNotTrigger.length})`,
    );
  }
  const triggerSet = new Set(triggers.shouldTrigger);
  const overlap = triggers.shouldNotTrigger.filter((p) => triggerSet.has(p));
  if (overlap.length > 0) {
    violations.push(
      `shouldTrigger and shouldNotTrigger must not overlap (found ${overlap.length} shared entries)`,
    );
  }
  return violations;
}

/**
 * Runs the Layer-1 description loop for a skill.
 *
 * Checks each prompt in `triggers.shouldTrigger` and `triggers.shouldNotTrigger`
 * against the skill's description via keyword-overlap classification.
 * Cost: O(n) string operations, no LLM tokens.
 */
export function runDescriptionLoop(
  skillName: string,
  options: { skillsRoot?: string } = {},
): DescriptionLoopResult | { error: string } {
  const triggers = loadTriggers(skillName, options.skillsRoot);
  if (triggers === null) {
    return { error: `no triggers.json found for skill "${skillName}"` };
  }

  const violations = validateTriggers(triggers);
  if (violations.length > 0) {
    return { error: `invalid triggers.json: ${violations.join('; ')}` };
  }

  const description = loadSkillDescription(skillName, options.skillsRoot);
  const descTerms = tokenise(description);

  const failures: FailureEntry[] = [];
  let tp = 0;
  let tn = 0;

  for (const prompt of triggers.shouldTrigger) {
    const triggered = classifyTrigger(descTerms, prompt);
    if (triggered) {
      tp++;
    } else {
      failures.push({ prompt, expected: 'trigger', actual: 'not-trigger' });
    }
  }

  for (const prompt of triggers.shouldNotTrigger) {
    const triggered = classifyTrigger(descTerms, prompt);
    if (!triggered) {
      tn++;
    } else {
      failures.push({ prompt, expected: 'not-trigger', actual: 'trigger' });
    }
  }

  const tpRate = triggers.shouldTrigger.length > 0 ? tp / triggers.shouldTrigger.length : 1;
  const tnRate = triggers.shouldNotTrigger.length > 0 ? tn / triggers.shouldNotTrigger.length : 1;
  const totalChecks = triggers.shouldTrigger.length + triggers.shouldNotTrigger.length;
  const accuracy = totalChecks > 0 ? (tp + tn) / totalChecks : 1;

  return { tpRate, tnRate, accuracy, failures };
}
