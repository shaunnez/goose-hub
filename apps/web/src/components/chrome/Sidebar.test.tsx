import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Sidebar', () => {
  const sidebarSource = readFileSync(join(import.meta.dirname, 'Sidebar.tsx'), 'utf-8');

  it('includes the Agentic OS brand label in the expanded header branch', () => {
    expect(sidebarSource).toContain('Agentic OS');
  });

  it('does not keep the old Goose Hub brand label in the expanded header branch', () => {
    const labelMatch = sidebarSource.match(/<span[^>]*text-\[14px\][^>]*>[\s\S]*?<\/span>/);
    expect(labelMatch?.[0]).not.toContain('Goose Hub');
  });
});
