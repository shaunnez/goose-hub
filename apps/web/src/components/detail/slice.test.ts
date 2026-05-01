import { describe, expect, it } from 'vitest';
import { renderMarkdownToHtml } from '../../lib/markdown';
import { LEGAL_TARGETS } from '../../lib/transitions';
import { GATE_STATES } from './gate-states';
import { SECTIONS } from './sections';

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

  it('Overview and Timeline are the only available sections in M2', () => {
    const available = SECTIONS.filter((s) => s.available).map((s) => s.key);
    expect(available).toEqual(['overview', 'timeline']);
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
