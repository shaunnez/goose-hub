import { GATE_STATES } from '@/lib/constants';
import { renderMarkdownToHtml } from '@/lib/markdown';
import { LEGAL_TARGETS } from '@/lib/transitions';
import { describe, expect, it } from 'vitest';
import { GATE_ACTIONS } from './components/GatePendingBanner';
import { extractPlaywrightRepro } from './lib/playwright-capture';
import { SECTIONS } from './lib/sections';

describe('detail page — sections config', () => {
  it('lists the 11 design sections in order (retrospective added in M9)', () => {
    expect(SECTIONS.map((s) => s.key)).toEqual([
      'overview',
      'repo',
      'investigation',
      'prd',
      'code',
      'qa',
      'review',
      'retrospective',
      'timeline',
      'chat',
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

  it('returns banner text for needs-review gate state', () => {
    expect(GATE_STATES['factory:needs-review']).toBe(
      'Code Review pending — human approval required',
    );
  });

  it('returns banner text for needs-human gate state', () => {
    expect(GATE_STATES['factory:needs-human']).toBe('Human intervention required');
  });

  it('does not include non-gate states', () => {
    expect(GATE_STATES['factory:in-progress']).toBeUndefined();
    expect(GATE_STATES['factory:triaging']).toBeUndefined();
    expect(GATE_STATES['factory:done']).toBeUndefined();
  });
});

describe('gate actions — GATE_ACTIONS mapping', () => {
  it('prd-review has only approve → decomposing', () => {
    const actions = GATE_ACTIONS['factory:prd-review'];
    expect(actions.approve).toBe('factory:decomposing');
    expect(actions.reject).toBeUndefined();
    expect(actions.requestChanges).toBeUndefined();
  });

  it('needs-review has all three actions', () => {
    const actions = GATE_ACTIONS['factory:needs-review'];
    expect(actions.approve).toBe('factory:approved');
    expect(actions.reject).toBe('factory:rejected');
    expect(actions.requestChanges).toBe('factory:needs-fix');
  });

  it('approved has only approve → retrospecting', () => {
    const actions = GATE_ACTIONS['factory:approved'];
    expect(actions.approve).toBe('factory:retrospecting');
    expect(actions.reject).toBeUndefined();
    expect(actions.requestChanges).toBeUndefined();
  });

  it('needs-human has 4 recovery actions', () => {
    const actions = GATE_ACTIONS['factory:needs-human'];
    expect(actions.approve).toBeUndefined();
    expect(actions.requestChanges).toBeUndefined();
    expect(actions.sendToTriage).toBe('factory:triaging');
    expect(actions.sendToDev).toBe('factory:dev-ready');
    expect(actions.sendToQA).toBe('factory:needs-qa');
    expect(actions.reject).toBe('factory:rejected');
  });

  it('reject and requestChanges are absent for non-needs-review, non-needs-human gate states', () => {
    const gates = ['factory:prd-review', 'factory:approved'];
    for (const gate of gates) {
      const actions = GATE_ACTIONS[gate];
      expect(actions.reject).toBeUndefined();
      expect(actions.requestChanges).toBeUndefined();
    }
  });
});

describe('detail page — legal-target table mirrors core', () => {
  it('triaging accepts to-accepted, to-rejected, and to-archived', () => {
    expect(LEGAL_TARGETS['factory:triaging']).toEqual(['factory:accepted', 'factory:rejected', 'factory:archived']);
  });
  it('done is terminal-ish: only goes to archived', () => {
    expect(LEGAL_TARGETS['factory:done']).toEqual(['factory:archived']);
  });
  it('needs-human has 5 recovery targets in the UI table', () => {
    expect(LEGAL_TARGETS['factory:needs-human']).toEqual([
      'factory:dev-ready',
      'factory:needs-qa',
      'factory:triaging',
      'factory:rejected',
      'factory:archived',
    ]);
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
});
