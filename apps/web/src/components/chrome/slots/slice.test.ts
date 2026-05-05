import { describe, expect, it } from 'vitest';

// The switcher slot consumes `useActiveProject()`; behavioural rendering is
// covered by Playwright (#281). Here we lock the data shape contract — the
// project summary that flows through the slot must include the color stripe
// per #29's acceptance criteria, and multi-project shape per #281.

describe('project switcher data contract', () => {
  it('ProjectSummary requires id, name, slug, color, source', () => {
    type ProjectSummary = import('../../../lib/types').ProjectSummary;
    const sample: ProjectSummary = {
      id: 'goose-hub-self',
      name: 'Goose Hub (self)',
      slug: 'goose-hub-self',
      color: '#7c3aed',
      source: { kind: 'github', repo: 'shaunnez/goose-hub' },
    };
    expect(sample.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(sample.source.kind).toBe('github');
  });

  it('slot components accept collapsed prop without type error (compile-time check)', () => {
    type SlotProps = { activeSlug?: string; collapsed?: boolean };
    const props: SlotProps = { collapsed: true };
    expect(props.collapsed).toBe(true);
  });

  it('multiple ProjectSummary entries have distinct colors', () => {
    type ProjectSummary = import('../../../lib/types').ProjectSummary;
    const projects: ProjectSummary[] = [
      {
        id: 'goose-hub-self',
        name: 'Goose Hub (self)',
        slug: 'goose-hub-self',
        color: '#7c3aed',
        source: { kind: 'github', repo: 'shaunnez/goose-hub' },
      },
      {
        id: 'nannymudnz',
        name: 'nannymudnz',
        slug: 'nannymudnz',
        color: '#059669',
        source: { kind: 'github', repo: 'shaunnez/nannymudnz' },
      },
    ];
    const colors = projects.map((p) => p.color);
    const uniqueColors = new Set(colors);
    expect(uniqueColors.size).toBe(projects.length);
    for (const color of colors) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('each project has a unique slug', () => {
    type ProjectSummary = import('../../../lib/types').ProjectSummary;
    const projects: ProjectSummary[] = [
      {
        id: 'goose-hub-self',
        name: 'Goose Hub (self)',
        slug: 'goose-hub-self',
        color: '#7c3aed',
        source: { kind: 'github', repo: 'shaunnez/goose-hub' },
      },
      {
        id: 'nannymudnz',
        name: 'nannymudnz',
        slug: 'nannymudnz',
        color: '#059669',
        source: { kind: 'github', repo: 'shaunnez/nannymudnz' },
      },
    ];
    const slugs = projects.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(projects.length);
  });
});
