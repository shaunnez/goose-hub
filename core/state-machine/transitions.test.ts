import { describe, expect, it } from 'vitest';
import { isLegalTransition, legalTargets } from './transitions.js';

describe('isLegalTransition — section 9.1 happy paths', () => {
  // triaging
  it('triaging → accepted', () =>
    expect(isLegalTransition('factory:triaging', 'factory:accepted')).toBe(true));
  it('triaging → rejected', () =>
    expect(isLegalTransition('factory:triaging', 'factory:rejected')).toBe(true));
  it('rejected → archived', () =>
    expect(isLegalTransition('factory:rejected', 'factory:archived')).toBe(true));

  // feature path
  it('accepted → grilling', () =>
    expect(isLegalTransition('factory:accepted', 'factory:grilling')).toBe(true));
  it('grilling → prd-drafting', () =>
    expect(isLegalTransition('factory:grilling', 'factory:prd-drafting')).toBe(true));
  it('prd-drafting → prd-review', () =>
    expect(isLegalTransition('factory:prd-drafting', 'factory:prd-review')).toBe(true));
  it('prd-review → decomposing', () =>
    expect(isLegalTransition('factory:prd-review', 'factory:decomposing')).toBe(true));
  it('decomposing → issues-created', () =>
    expect(isLegalTransition('factory:decomposing', 'factory:issues-created')).toBe(true));
  it('issues-created → dev-ready', () =>
    expect(isLegalTransition('factory:issues-created', 'factory:dev-ready')).toBe(true));

  // bug path
  it('accepted → investigating', () =>
    expect(isLegalTransition('factory:accepted', 'factory:investigating')).toBe(true));
  it('investigating → investigation-complete', () =>
    expect(isLegalTransition('factory:investigating', 'factory:investigation-complete')).toBe(
      true,
    ));
  it('investigation-complete → dev-ready', () =>
    expect(isLegalTransition('factory:investigation-complete', 'factory:dev-ready')).toBe(true));

  // chore path
  it('accepted → dev-ready', () =>
    expect(isLegalTransition('factory:accepted', 'factory:dev-ready')).toBe(true));

  // research path
  it('accepted → research-pending', () =>
    expect(isLegalTransition('factory:accepted', 'factory:research-pending')).toBe(true));
  it('research-pending → research-complete', () =>
    expect(isLegalTransition('factory:research-pending', 'factory:research-complete')).toBe(true));
  it('research-complete → dev-ready', () =>
    expect(isLegalTransition('factory:research-complete', 'factory:dev-ready')).toBe(true));

  // dev loop
  it('dev-ready → in-progress', () =>
    expect(isLegalTransition('factory:dev-ready', 'factory:in-progress')).toBe(true));
  it('in-progress → needs-qa', () =>
    expect(isLegalTransition('factory:in-progress', 'factory:needs-qa')).toBe(true));
  it('needs-qa → qa-failed', () =>
    expect(isLegalTransition('factory:needs-qa', 'factory:qa-failed')).toBe(true));
  it('needs-qa → needs-review', () =>
    expect(isLegalTransition('factory:needs-qa', 'factory:needs-review')).toBe(true));
  it('qa-failed → needs-fix', () =>
    expect(isLegalTransition('factory:qa-failed', 'factory:needs-fix')).toBe(true));
  it('needs-review → needs-fix', () =>
    expect(isLegalTransition('factory:needs-review', 'factory:needs-fix')).toBe(true));
  it('needs-review → approved', () =>
    expect(isLegalTransition('factory:needs-review', 'factory:approved')).toBe(true));
  it('needs-review → needs-human (retries exhausted)', () =>
    expect(isLegalTransition('factory:needs-review', 'factory:needs-human')).toBe(true));
  it('needs-fix → needs-human (retries exhausted)', () =>
    expect(isLegalTransition('factory:needs-fix', 'factory:needs-human')).toBe(true));
  it('approved → retrospecting', () =>
    expect(isLegalTransition('factory:approved', 'factory:retrospecting')).toBe(true));
  // merge-conflict path
  it('approved → merge-conflict', () =>
    expect(isLegalTransition('factory:approved', 'factory:merge-conflict')).toBe(true));
  it('merge-conflict → retrospecting (agent resolved)', () =>
    expect(isLegalTransition('factory:merge-conflict', 'factory:retrospecting')).toBe(true));
  it('merge-conflict → needs-human', () =>
    expect(isLegalTransition('factory:merge-conflict', 'factory:needs-human')).toBe(true));
  it('merge-conflict → done is illegal (must go through retrospecting)', () =>
    expect(isLegalTransition('factory:merge-conflict', 'factory:done')).toBe(false));
  it('retrospecting → done', () =>
    expect(isLegalTransition('factory:retrospecting', 'factory:done')).toBe(true));
  it('done → archived', () =>
    expect(isLegalTransition('factory:done', 'factory:archived')).toBe(true));
});

describe('isLegalTransition — section 9.2 PR-close paths', () => {
  it('needs-review → rejected (human explicitly cancelled)', () =>
    expect(isLegalTransition('factory:needs-review', 'factory:rejected')).toBe(true));
});

describe('isLegalTransition — re-entry loop (needs-fix → in-progress → needs-qa)', () => {
  it('needs-fix → in-progress', () =>
    expect(isLegalTransition('factory:needs-fix', 'factory:in-progress')).toBe(true));
  it('in-progress → needs-qa (second pass)', () =>
    expect(isLegalTransition('factory:in-progress', 'factory:needs-qa')).toBe(true));
  it('needs-qa → needs-review (second pass)', () =>
    expect(isLegalTransition('factory:needs-qa', 'factory:needs-review')).toBe(true));
});

describe('isLegalTransition — illegal jumps', () => {
  it('triaging → done', () =>
    expect(isLegalTransition('factory:triaging', 'factory:done')).toBe(false));
  it('triaging → archived', () =>
    expect(isLegalTransition('factory:triaging', 'factory:archived')).toBe(false));
  it('in-progress → approved (skips qa/review)', () =>
    expect(isLegalTransition('factory:in-progress', 'factory:approved')).toBe(false));
  it('dev-ready → needs-qa (skips in-progress)', () =>
    expect(isLegalTransition('factory:dev-ready', 'factory:needs-qa')).toBe(false));
  it('approved → done (skips retrospecting)', () =>
    expect(isLegalTransition('factory:approved', 'factory:done')).toBe(false));
  it('merge-conflict → in-progress is illegal', () =>
    expect(isLegalTransition('factory:merge-conflict', 'factory:in-progress')).toBe(false));
  it('accepted → triaging (backwards)', () =>
    expect(isLegalTransition('factory:accepted', 'factory:triaging')).toBe(false));
});

describe('terminal states', () => {
  it('archived has no exits', () => expect(legalTargets('factory:archived')).toHaveLength(0));
  it('archived → done is illegal', () =>
    expect(isLegalTransition('factory:archived', 'factory:done')).toBe(false));
  it('archived → triaging is illegal', () =>
    expect(isLegalTransition('factory:archived', 'factory:triaging')).toBe(false));
});

describe('needs-human recovery transitions', () => {
  it('needs-human → dev-ready', () =>
    expect(isLegalTransition('factory:needs-human', 'factory:dev-ready')).toBe(true));
  it('needs-human → needs-qa', () =>
    expect(isLegalTransition('factory:needs-human', 'factory:needs-qa')).toBe(true));
  it('needs-human → triaging', () =>
    expect(isLegalTransition('factory:needs-human', 'factory:triaging')).toBe(true));
  it('needs-human → rejected', () =>
    expect(isLegalTransition('factory:needs-human', 'factory:rejected')).toBe(true));
  it('needs-human → done is still illegal', () =>
    expect(isLegalTransition('factory:needs-human', 'factory:done')).toBe(false));
  it('needs-human yields exactly 4 targets', () =>
    expect(legalTargets('factory:needs-human')).toHaveLength(4));
});

describe('legalTargets', () => {
  it('triaging yields accepted and rejected', () =>
    expect(legalTargets('factory:triaging')).toStrictEqual([
      'factory:accepted',
      'factory:rejected',
    ]));

  it('accepted yields four targets', () =>
    expect(legalTargets('factory:accepted')).toHaveLength(4));

  it('dev-ready yields only in-progress', () =>
    expect(legalTargets('factory:dev-ready')).toStrictEqual(['factory:in-progress']));
});
