import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadSkillDescription,
  loadTriggers,
  runDescriptionLoop,
  validateTriggers,
} from '@goose-hub/core/learning/description-loop.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// ─── helpers ─────────────────────────────────────────────────────────────────

let tmpRoot: string;

function makeSkill(
  name: string,
  description: string,
  triggers?: { shouldTrigger: string[]; shouldNotTrigger: string[] },
): void {
  const skillDir = join(tmpRoot, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'prompt.md'), `# ${name}\n\n${description}\n`);
  if (triggers) {
    writeFileSync(join(skillDir, 'triggers.json'), JSON.stringify(triggers, null, 2));
  }
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'description-loop-test-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ─── loadTriggers ────────────────────────────────────────────────────────────

describe('loadTriggers', () => {
  it('returns null when triggers.json does not exist', () => {
    mkdirSync(join(tmpRoot, 'no-triggers'), { recursive: true });
    expect(loadTriggers('no-triggers', tmpRoot)).toBeNull();
  });

  it('loads a valid triggers.json', () => {
    makeSkill('my-skill', 'A skill for doing things', {
      shouldTrigger: ['do this thing', 'do another thing', 'trigger me'],
      shouldNotTrigger: ['unrelated query', 'nothing here', 'different topic'],
    });
    const triggers = loadTriggers('my-skill', tmpRoot);
    expect(triggers).not.toBeNull();
    expect(triggers?.shouldTrigger).toHaveLength(3);
    expect(triggers?.shouldNotTrigger).toHaveLength(3);
  });
});

// ─── loadSkillDescription ────────────────────────────────────────────────────

describe('loadSkillDescription', () => {
  it('returns empty string when prompt.md does not exist', () => {
    mkdirSync(join(tmpRoot, 'ghost-skill'), { recursive: true });
    expect(loadSkillDescription('ghost-skill', tmpRoot)).toBe('');
  });

  it('returns first paragraph from prompt.md (heading stripped)', () => {
    makeSkill('my-skill', 'Triages incoming issues and assigns priority labels.');
    const desc = loadSkillDescription('my-skill', tmpRoot);
    expect(desc).toContain('Triages incoming issues');
    expect(desc).not.toContain('#');
  });
});

// ─── validateTriggers ────────────────────────────────────────────────────────

describe('validateTriggers', () => {
  it('passes with ≥3 in each category and no overlap', () => {
    const violations = validateTriggers({
      shouldTrigger: ['a', 'b', 'c'],
      shouldNotTrigger: ['x', 'y', 'z'],
    });
    expect(violations).toHaveLength(0);
  });

  it('fails with fewer than 3 shouldTrigger entries', () => {
    const violations = validateTriggers({
      shouldTrigger: ['a', 'b'],
      shouldNotTrigger: ['x', 'y', 'z'],
    });
    expect(violations.some((v) => v.includes('shouldTrigger'))).toBe(true);
  });

  it('fails with fewer than 3 shouldNotTrigger entries', () => {
    const violations = validateTriggers({
      shouldTrigger: ['a', 'b', 'c'],
      shouldNotTrigger: ['x'],
    });
    expect(violations.some((v) => v.includes('shouldNotTrigger'))).toBe(true);
  });

  it('fails when shouldTrigger and shouldNotTrigger overlap', () => {
    const violations = validateTriggers({
      shouldTrigger: ['shared', 'b', 'c'],
      shouldNotTrigger: ['shared', 'y', 'z'],
    });
    expect(violations.some((v) => v.includes('overlap'))).toBe(true);
  });
});

// ─── runDescriptionLoop ──────────────────────────────────────────────────────

describe('runDescriptionLoop', () => {
  it('returns error when no triggers.json exists', () => {
    mkdirSync(join(tmpRoot, 'no-triggers-skill'), { recursive: true });
    writeFileSync(join(tmpRoot, 'no-triggers-skill', 'prompt.md'), '# no triggers\n\nA skill.\n');
    const result = runDescriptionLoop('no-triggers-skill', { skillsRoot: tmpRoot });
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toContain('triggers.json');
  });

  it('returns error when triggers.json is invalid (too few entries)', () => {
    makeSkill('bad-triggers', 'Does stuff', {
      shouldTrigger: ['only one'],
      shouldNotTrigger: ['unrelated', 'other', 'thing'],
    });
    const result = runDescriptionLoop('bad-triggers', { skillsRoot: tmpRoot });
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toContain('invalid triggers.json');
  });

  it('achieves high accuracy when description terms match shouldTrigger prompts', () => {
    makeSkill('triage-skill', 'Triage incoming issues classify priority labels acceptance', {
      shouldTrigger: [
        'Triage this incoming issue and classify priority',
        'Label this issue with acceptance criteria priority',
        'Classify priority labels for the incoming issues',
        'Triage and accept or reject the issue',
        'Apply priority labels to triage incoming tasks',
      ],
      shouldNotTrigger: [
        'Implement the payment feature code',
        'Run QA checks verify tests',
        'Deploy build to production server',
        'Write code implementation feature',
        'Review code diff architectural quality',
      ],
    });

    const result = runDescriptionLoop('triage-skill', { skillsRoot: tmpRoot });
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.accuracy).toBeGreaterThanOrEqual(0.6);
      expect(typeof result.tpRate).toBe('number');
      expect(typeof result.tnRate).toBe('number');
      expect(Array.isArray(result.failures)).toBe(true);
    }
  });

  it('returns accuracy=1 and no failures for a perfect match', () => {
    // Description exactly matches trigger terms, non-trigger prompts share no terms
    makeSkill('perfect-skill', 'Zorp blorx flurp gribnax', {
      shouldTrigger: [
        'Zorp this thing with blorx',
        'Run flurp on the gribnax module',
        'Use zorp and blorx for this task',
      ],
      shouldNotTrigger: [
        'Implement payment feature',
        'Review code quality',
        'Deploy to production',
      ],
    });

    const result = runDescriptionLoop('perfect-skill', { skillsRoot: tmpRoot });
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      // All trigger prompts match (contain desc terms); no not-trigger prompt matches
      expect(result.tpRate).toBe(1);
      expect(result.tnRate).toBe(1);
      expect(result.accuracy).toBe(1);
      expect(result.failures).toHaveLength(0);
    }
  });

  it('failure entries have correct prompt/expected/actual fields', () => {
    makeSkill('failing-skill', 'Quantum entanglement protocols', {
      shouldTrigger: [
        'Run quantum protocols',
        'Entangle the data streams',
        'Quantum processing task',
      ],
      shouldNotTrigger: [
        // These share terms with description — should be classified as false positive
        'quantum: apply entanglement protocol',
        'unrelated deploy task',
        'code review nothing relevant',
      ],
    });

    const result = runDescriptionLoop('failing-skill', { skillsRoot: tmpRoot });
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      for (const f of result.failures) {
        expect(['trigger', 'not-trigger']).toContain(f.expected);
        expect(['trigger', 'not-trigger']).toContain(f.actual);
        expect(f.expected).not.toBe(f.actual);
        expect(typeof f.prompt).toBe('string');
      }
    }
  });
});

// ─── real skills have valid triggers.json ────────────────────────────────────

describe('shipped triggers.json files', () => {
  const SKILLS_ROOT = new URL('../../skills', import.meta.url).pathname;
  const SKILLS_WITH_TRIGGERS = [
    'triage',
    'qa',
    'review',
    'investigate',
    'implement',
    'spec-author',
  ];

  for (const skill of SKILLS_WITH_TRIGGERS) {
    it(`${skill}/triggers.json is valid`, () => {
      const triggers = loadTriggers(skill, SKILLS_ROOT);
      expect(triggers).not.toBeNull();
      if (triggers != null) {
        const violations = validateTriggers(triggers);
        expect(violations).toHaveLength(0);
      }
    });

    it(`${skill} description loop runs without error`, () => {
      const result = runDescriptionLoop(skill, { skillsRoot: SKILLS_ROOT });
      // No error — either a result or a soft warning about accuracy is fine
      expect('error' in result).toBe(false);
    });
  }
});
