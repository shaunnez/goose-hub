import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The search slice contract: modal exists, TopBar wires it, the disabled
// placeholder is gone, and the modal consumes /api/search via React Query.
// Behavioural coverage lives in SearchModal.test.tsx and
// SearchResults.test.tsx; backend coverage lives in
// apps/server/src/domains/search/*.test.ts.

describe('search slice — public surface', () => {
  it('SearchModal is exported from components/SearchModal.tsx', () => {
    const source = readFileSync(join(import.meta.dirname, 'components/SearchModal.tsx'), 'utf-8');
    expect(source).toContain('export function SearchModal');
  });

  it('SearchModal uses a full-bleed backdrop with blur', () => {
    const source = readFileSync(join(import.meta.dirname, 'components/SearchModal.tsx'), 'utf-8');
    expect(source).toContain('fixed inset-0');
    expect(source).toContain('backdrop-blur');
  });
});

describe('search slice — TopBar integration', () => {
  const topBarSource = readFileSync(join(import.meta.dirname, '../chrome/TopBar.tsx'), 'utf-8');

  it('TopBar imports SearchModal', () => {
    expect(topBarSource).toContain('SearchModal');
  });

  it('TopBar Search button is no longer disabled with "available later" copy', () => {
    expect(topBarSource).not.toContain('Search — available later');
    expect(topBarSource).toContain('search-button');
  });

  it('TopBar binds the ⌘K / Ctrl+K keyboard shortcut', () => {
    expect(topBarSource).toContain('metaKey');
    expect(topBarSource).toContain('ctrlKey');
  });
});

describe('search slice — client wiring', () => {
  it('fetchSearch is exported from lib/api', () => {
    const source = readFileSync(join(import.meta.dirname, '../../lib/api/search.ts'), 'utf-8');
    expect(source).toContain('export async function fetchSearch');
  });

  it('SearchResults uses React Query with a 30s staleTime', () => {
    const source = readFileSync(join(import.meta.dirname, 'components/SearchResults.tsx'), 'utf-8');
    expect(source).toContain('useQuery');
    expect(source).toContain('30_000');
  });

  it('SearchResults binds ArrowDown / ArrowUp / Enter for keyboard nav', () => {
    const source = readFileSync(join(import.meta.dirname, 'components/SearchResults.tsx'), 'utf-8');
    expect(source).toContain('ArrowDown');
    expect(source).toContain('ArrowUp');
    expect(source).toContain("'Enter'");
  });

  it('SearchResults highlights matched tokens in the title', () => {
    const source = readFileSync(join(import.meta.dirname, 'components/SearchResults.tsx'), 'utf-8');
    expect(source).toContain('highlight(hit.title, tokens)');
  });
});
