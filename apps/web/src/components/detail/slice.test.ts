import { describe, expect, it } from 'vitest';
import { GATE_STATES } from '../../lib/constants';
import { renderMarkdownToHtml } from '../../lib/markdown';
import { LEGAL_TARGETS } from '../../lib/transitions';
import { GATE_ACTIONS } from './components/GatePendingBanner';
import { SECTIONS } from './lib/sections';

describe('detail page — sections config', () => {
  it('lists the 10 design sections in order', () => {
    expect(SECTIONS.map((s) => s.key)).toEqual([
      'overview',
      'repo',
      'investigation',
      'prd',
      'code',
      'qa',
      'review',
      'timeline',
      'chat',
      'costs',
    ]);
  });

  it('Overview, Investigation, and Timeline are available sections', () => {
    const available = SECTIONS.filter((s) => s.available).map((s) => s.key);
    expect(available).toContain('overview');
    expect(available).toContain('investigation');
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

  it('returns banner text for approved gate state', () => {
    expect(GATE_STATES['factory:approved']).toBe('Approved — ready for retrospecting');
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

  it('needs-human has no actions', () => {
    const actions = GATE_ACTIONS['factory:needs-human'];
    expect(actions.approve).toBeUndefined();
    expect(actions.reject).toBeUndefined();
    expect(actions.requestChanges).toBeUndefined();
  });

  it('reject and requestChanges are absent for non-needs-review gate states', () => {
    const nonNeedsReviewGates = ['factory:prd-review', 'factory:approved', 'factory:needs-human'];
    for (const gate of nonNeedsReviewGates) {
      const actions = GATE_ACTIONS[gate];
      expect(actions.reject).toBeUndefined();
      expect(actions.requestChanges).toBeUndefined();
    }
  });
});

describe('detail page — legal-target table mirrors core', () => {
  it('triaging accepts to-accepted and to-rejected', () => {
    expect(LEGAL_TARGETS['factory:triaging']).toEqual(['factory:accepted', 'factory:rejected']);
  });
  it('done is terminal-ish: only goes to archived', () => {
    expect(LEGAL_TARGETS['factory:done']).toEqual(['factory:archived']);
  });
  it('needs-human is fully terminal in the UI table', () => {
    expect(LEGAL_TARGETS['factory:needs-human']).toEqual([]);
  });
});
