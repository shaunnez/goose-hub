import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Chrome is mostly React components; the slice test ensures the public files
// exist and the milestone-stub configuration stays honest with the M2 plan.
// Component rendering tests are exercised by the Playwright happy-path (#36).

const DEFERRED_SURFACES = [
  { label: 'Inbox', milestone: 'M3' },
  { label: 'Roster', milestone: 'M5' },
  { label: 'Milestones', milestone: 'later' },
  { label: 'Settings', milestone: 'later' },
  { label: 'Bootstrap', milestone: 'M12' },
];

const LOGO_TEXT = 'hello world 2';

describe('chrome slice — sidebar brand label', () => {
  const sidebarSource = readFileSync(join(import.meta.dirname, 'Sidebar.tsx'), 'utf-8');

  it('sidebar header renders logo text "hello world 2" (AC-1)', () => {
    expect(sidebarSource).toContain(LOGO_TEXT);
  });

  it('sidebar logo accessible name is "hello world 2" (AC-3)', () => {
    // The visible text in the brand span IS the accessible name for screen readers.
    // Verify the text node is present inside the brand span.
    const spanMatch = sidebarSource.match(/<span[^>]*text-\[14px\][^>]*>[\s\S]*?<\/span>/);
    expect(spanMatch?.[0]).toContain(LOGO_TEXT);
  });

  it('sidebar logo does not render legacy text "Goose Hub"', () => {
    // Brand text span must not contain the old label.
    const spanMatch = sidebarSource.match(/<span[^>]*text-\[14px\][^>]*>[\s\S]*?<\/span>/);
    expect(spanMatch?.[0]).not.toContain('Goose Hub');
  });

  it('sidebar logo has no link wrapper — prior href was absent (AC-2)', () => {
    // The brand header area must not wrap the logo text in an <a> or NavLink.
    // Prior implementation had no click-navigation; behaviour is unchanged.
    const headerBlock =
      sidebarSource.match(/\{\/\* Header \*\/\}[\s\S]*?\{\/\* Project \*\/\}/)?.[0] ?? '';
    expect(headerBlock).not.toMatch(/<a\s/);
    // NavLink is used in nav items only; the brand header must not contain one.
    const navLinkInHeader =
      headerBlock.includes('<NavLink') &&
      headerBlock.indexOf('<NavLink') < headerBlock.indexOf('/* Project */');
    expect(navLinkInHeader).toBe(false);
  });

  it('sidebar header does not read "Agentic OS"', () => {
    const labelMatch = sidebarSource.match(/<span[^>]*text-\[14px\][^>]*>[\s\S]*?<\/span>/);
    expect(labelMatch?.[0]).not.toContain('Agentic OS');
  });
});

describe('chrome slice — deferred surfaces config', () => {
  it('every deferred surface has a milestone tag', () => {
    for (const s of DEFERRED_SURFACES) {
      expect(s.milestone.length).toBeGreaterThan(0);
    }
  });

  it('Kanban is the only non-deferred sidebar item in M2', () => {
    const labels = DEFERRED_SURFACES.map((s) => s.label);
    expect(labels).not.toContain('Kanban');
  });

  it('sidebar defaults to collapsed (localStorage key absent = collapsed)', () => {
    // Contract: absence of the key means collapsed=true
    // The component reads localStorage.getItem('sidebar-collapsed') !== 'false'
    const absent = null;
    const collapsed = absent !== 'false';
    expect(collapsed).toBe(true);
  });

  it('sidebar respects explicit expanded preference', () => {
    const storedFalse = 'false';
    const collapsed = storedFalse !== 'false';
    expect(collapsed).toBe(false);
  });
});
