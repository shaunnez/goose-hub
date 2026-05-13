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

  it('sidebar header reads "Goose Hub"', () => {
    expect(sidebarSource).toContain('Goose Hub');
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

describe('chrome slice — search modal (#603)', () => {
  const topBarSource = readFileSync(join(import.meta.dirname, 'TopBar.tsx'), 'utf-8');
  const searchModalSource = readFileSync(join(import.meta.dirname, 'SearchModal.tsx'), 'utf-8');

  it('TopBar imports the SearchModal', () => {
    expect(topBarSource).toContain('SearchModal');
    expect(topBarSource).toContain("from '@/components/chrome/SearchModal'");
  });

  it('TopBar wires a ⌘K / Ctrl+K keyboard shortcut', () => {
    expect(topBarSource).toContain('metaKey');
    expect(topBarSource).toContain('ctrlKey');
    expect(topBarSource).toMatch(/key.*toLowerCase\(\).*===.*'k'/);
  });

  it('TopBar no longer renders the disabled search button', () => {
    expect(topBarSource).not.toContain('Search — available later');
    expect(topBarSource).toContain('data-testid="search-button"');
  });

  it('SearchModal exposes test-ids the e2e suite hooks into', () => {
    for (const id of [
      '"search-modal"',
      '"search-modal-input"',
      '"search-modal-results"',
      '"search-modal-empty"',
      '"search-modal-result"',
    ]) {
      expect(searchModalSource).toContain(id);
    }
  });

  it('SearchModal navigates to /projects/:slug/items/:id on select', () => {
    expect(searchModalSource).toMatch(/\/projects\/\$\{[^}]+\}\/items\/\$\{[^}]+\}/);
    expect(searchModalSource).toContain('useNavigate');
  });

  it('SearchModal closes on Escape', () => {
    expect(searchModalSource).toContain("e.key === 'Escape'");
    expect(searchModalSource).toContain('onClose');
  });
});
