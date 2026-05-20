import { GATE_STATES } from '@/lib/constants';
import { parseDependencies } from '@/lib/dependency-parser';
import { renderMarkdownToHtml } from '@/lib/markdown';
import { describe, expect, it } from 'vitest';
import { extractPlaywrightRepro } from './lib/playwright-capture';
import { SECTIONS } from './lib/sections';

describe('detail page — sections config', () => {
  it('lists the 11 design sections in order (chat removed post-M20)', () => {
    expect(SECTIONS.map((s) => s.key)).toEqual([
      'overview',
      'repo',
      'investigation',
      'grill',
      'prd',
      'code',
      'qa',
      'review',
      'retrospective',
      'timeline',
      'costs',
    ]);
  });

  it('overview, investigation, code, and timeline are the available sections in M6', () => {
    const available = SECTIONS.filter((s) => s.available).map((s) => s.key);
    expect(available).toContain('overview');
    expect(available).toContain('investigation');
    expect(available).toContain('code');
    expect(available).toContain('timeline');
  });

  it('every deferred section carries a milestone tag', () => {
    for (const s of SECTIONS) {
      if (s.available) continue;
      expect(s.milestone).toBeTruthy();
    }
  });
});

describe('detail page — markdown sanitization', () => {
  it('escapes raw HTML tags in the body', () => {
    const html = renderMarkdownToHtml('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders bold + inline code + links', () => {
    const html = renderMarkdownToHtml('**bold** `code` [link](https://example.com)');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code');
    expect(html).toContain('href="https://example.com"');
  });

  it('renders headings and lists', () => {
    const html = renderMarkdownToHtml('## Heading\n\n- one\n- two');
    expect(html).toContain('<h2');
    expect(html).toContain('<ul');
    expect(html).toContain('<li>one</li>');
  });
});

describe('GatePendingBanner — gate state map', () => {
  it('returns banner text for prd-review gate state', () => {
    expect(GATE_STATES['factory:prd-review']).toBe('PRD Review pending — human approval required');
  });

  it('does not include approved (approved shows no gate banner)', () => {
    expect(GATE_STATES['factory:approved']).toBeUndefined();
  });

  it('does not include needs-review because automated review is not a human gate', () => {
    expect(GATE_STATES['factory:needs-review']).toBeUndefined();
  });

  it('returns banner text for needs-human gate state', () => {
    expect(GATE_STATES['factory:needs-human']).toBe('Human intervention required');
  });

  it('returns banner text for gate-pending grill state', () => {
    expect(GATE_STATES['factory:gate-pending']).toBe('Question ready — grill');
  });

  it('does not include non-gate states', () => {
    expect(GATE_STATES['factory:in-progress']).toBeUndefined();
    expect(GATE_STATES['factory:triaging']).toBeUndefined();
    expect(GATE_STATES['factory:done']).toBeUndefined();
  });
});

// ─── M6.07: PlaywrightCaptureSection — extractPlaywrightRepro ────────────────

function makeInvestigationEvent(id: number, playwrightRepro?: unknown) {
  return {
    id,
    projectId: 'proj',
    workItemId: 'wi-1',
    kind: 'agent.investigation-complete',
    payload: { investigate: {}, ...(playwrightRepro != null ? { playwrightRepro } : {}) },
    createdAt: new Date().toISOString(),
  };
}

const FULL_REPRO = {
  screenshots: [{ path: 'evidence/issue-42/step-1.png', caption: 'Login page', step: 1 }],
  gifPath: 'evidence/issue-42/walkthrough.gif',
  consoleErrors: [{ message: 'TypeError: x is undefined', type: 'error' as const }],
  testErrors: ['REPRO_EXPECTED_BUG: error banner missing'],
  runnerErrors: ['Error: No tests found.'],
  reproSteps: ['Navigate to /login', 'Click submit'],
  reproduced: true,
};

describe('extractPlaywrightRepro', () => {
  it('returns null when no events are present', () => {
    expect(extractPlaywrightRepro([])).toBeNull();
  });

  it('returns null when no investigation-complete events are present', () => {
    const events = [
      { id: 1, projectId: 'p', workItemId: 'w', kind: 'agent.log', payload: {}, createdAt: '' },
    ];
    expect(extractPlaywrightRepro(events)).toBeNull();
  });

  it('returns null when investigation-complete has no playwrightRepro', () => {
    const events = [makeInvestigationEvent(1)];
    expect(extractPlaywrightRepro(events)).toBeNull();
  });

  it('returns the playwrightRepro payload when present', () => {
    const events = [makeInvestigationEvent(1, FULL_REPRO)];
    const result = extractPlaywrightRepro(events);
    expect(result).not.toBeNull();
    expect(result?.reproduced).toBe(true);
    expect(result?.reproSteps).toEqual(['Navigate to /login', 'Click submit']);
    expect(result?.screenshots).toHaveLength(1);
    expect(result?.consoleErrors).toHaveLength(1);
    expect(result?.testErrors).toEqual(['REPRO_EXPECTED_BUG: error banner missing']);
    expect(result?.runnerErrors).toEqual(['Error: No tests found.']);
    expect(result?.gifPath).toBe('evidence/issue-42/walkthrough.gif');
  });

  it('picks the latest investigation-complete event with a playwrightRepro', () => {
    const older = makeInvestigationEvent(1, { ...FULL_REPRO, reproduced: false, notes: 'old' });
    const newer = makeInvestigationEvent(2, { ...FULL_REPRO, reproduced: true, notes: 'new' });
    const result = extractPlaywrightRepro([older, newer]);
    expect(result?.reproduced).toBe(true);
    expect(result?.notes).toBe('new');
  });

  it('skips investigation events without playwrightRepro and returns the one that has it', () => {
    const noRepro = makeInvestigationEvent(1);
    const withRepro = makeInvestigationEvent(2, FULL_REPRO);
    const result = extractPlaywrightRepro([noRepro, withRepro]);
    expect(result?.reproduced).toBe(true);
  });

  it('returns reproduced: false payload without error', () => {
    const repro = { ...FULL_REPRO, reproduced: false, notes: 'Could not trigger the error' };
    const result = extractPlaywrightRepro([makeInvestigationEvent(1, repro)]);
    expect(result?.reproduced).toBe(false);
    expect(result?.notes).toBe('Could not trigger the error');
  });

  it('strips ANSI/control sequences from historical Playwright repro text', () => {
    const result = extractPlaywrightRepro([
      makeInvestigationEvent(1, {
        ...FULL_REPRO,
        testErrors: ['\u001b[31mREPRO_EXPECTED_BUG: error banner missing\u001b[0m'],
        runnerErrors: ['\u001b[2mError: No tests found.\u001b[0m\u0007'],
        notes: '\u001b[33mCould not trigger the error\u001b[0m',
      }),
    ]);

    expect(result?.testErrors).toEqual(['REPRO_EXPECTED_BUG: error banner missing']);
    expect(result?.runnerErrors).toEqual(['Error: No tests found.']);
    expect(result?.notes).toBe('Could not trigger the error');
  });
});

// ---------------------------------------------------------------------------
// dependency-parser (web lib)
// ---------------------------------------------------------------------------

describe('dependency-parser — web lib', () => {
  it('returns empty array for a body with no dep declarations', () => {
    expect(parseDependencies('See #42 for context')).toEqual([]);
  });

  it('parses "Depends on #N" as depends-on', () => {
    expect(parseDependencies('Depends on #286')).toEqual([
      { type: 'depends-on', repoRef: null, issueNumber: 286 },
    ]);
  });

  it('parses "Blocks #N" as blocks', () => {
    expect(parseDependencies('Blocks #291')).toEqual([
      { type: 'blocks', repoRef: null, issueNumber: 291 },
    ]);
  });

  it('parses cross-repo ref', () => {
    expect(parseDependencies('Depends on shaunnez/other-repo#12')).toEqual([
      { type: 'depends-on', repoRef: 'shaunnez/other-repo', issueNumber: 12 },
    ]);
  });

  it('rejects alphanumeric suffix — #123abc must not match', () => {
    expect(parseDependencies('Depends on #123abc')).toEqual([]);
  });

  it('handles multiple dep lines', () => {
    const body = 'Depends on #286\nDepends on #291\nBlocks #300';
    expect(parseDependencies(body)).toEqual([
      { type: 'depends-on', repoRef: null, issueNumber: 286 },
      { type: 'depends-on', repoRef: null, issueNumber: 291 },
      { type: 'blocks', repoRef: null, issueNumber: 300 },
    ]);
  });
});
