import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const topBarSource = readFileSync(join(import.meta.dirname, 'TopBar.tsx'), 'utf-8');

describe('TopBar — capture keyboard shortcut', () => {
  it('binds the ⌘J / Ctrl+J shortcut for Capture', () => {
    expect(topBarSource).toContain('metaKey');
    expect(topBarSource).toContain('ctrlKey');
    // The shortcut handler must check for the 'j' key
    expect(topBarSource).toMatch(/key.*lower.*j|j.*lower.*key|===\s*'j'/i);
  });

  it('Capture button displays ⌘J keyboard hint', () => {
    expect(topBarSource).toContain('⌘J');
  });
});

describe('TopBar — search keyboard shortcut (existing)', () => {
  it('still binds ⌘K / Ctrl+K for Search', () => {
    expect(topBarSource).toContain('⌘K');
  });
});
