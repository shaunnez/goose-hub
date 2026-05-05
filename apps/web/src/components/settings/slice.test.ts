import { describe, expect, it } from 'vitest';

// The settings slice is a read-only view of registered project configs.
// Integration is covered by the component-level tests in components/*.test.tsx.
// This file verifies the public surface contract (no runtime dependencies).

describe('settings slice', () => {
  it('exports SettingsPage', async () => {
    const mod = await import('./components/SettingsPage');
    expect(typeof mod.SettingsPage).toBe('function');
  });

  it('exports ProjectConfigPanel', async () => {
    const mod = await import('./components/ProjectConfigPanel');
    expect(typeof mod.ProjectConfigPanel).toBe('function');
  });
});
