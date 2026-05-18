import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The search slice contract for PR-1: modal exists, TopBar wires it,
// and the disabled placeholder is gone. Behavioural coverage lives in
// SearchModal.test.tsx. Backend wiring lands in PR-2 (#834).

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
