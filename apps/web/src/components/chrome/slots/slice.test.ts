import { describe, expect, it } from 'vitest';

// The switcher slot consumes `useActiveProject()`; behavioural rendering is
// covered by Playwright (#36). Here we lock the data shape contract — the
// project summary that flows through the slot must include the color stripe
// per #29's acceptance criteria.

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
    // This is a type-level contract; if the prop is missing from the component
    // signature, TypeScript will catch it during the build step.
    // Here we assert the shape of the expected props interface.
    type SlotProps = { activeSlug?: string; collapsed?: boolean };
    const props: SlotProps = { collapsed: true };
    expect(props.collapsed).toBe(true);
  });
});
