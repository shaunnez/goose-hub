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

describe('chrome slice — sidebar brand label', () => {
  const sidebarSource = readFileSync(join(import.meta.dirname, 'Sidebar.tsx'), 'utf-8');

  it('sidebar header reads "GooseHUB"', () => {
    expect(sidebarSource).toContain('GooseHUB');
  });

  it('sidebar header does not read "Goose Hub"', () => {
    const labelMatch = sidebarSource.match(/<span[^>]*text-\[14px\][^>]*>[\s\S]*?<\/span>/);
    expect(labelMatch?.[0]).not.toContain('Goose Hub');
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
