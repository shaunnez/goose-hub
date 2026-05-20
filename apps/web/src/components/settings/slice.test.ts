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

  it('exports PipelinePanel', async () => {
    const mod = await import('./components/PipelinePanel');
    expect(typeof mod.PipelinePanel).toBe('function');
  });

  it('exports LearningLoopPanel', async () => {
    const mod = await import('./components/LearningLoopPanel');
    expect(typeof mod.LearningLoopPanel).toBe('function');
  });

  it('exports ProjectBudgetPanel', async () => {
    const mod = await import('./components/ProjectBudgetPanel');
    expect(typeof mod.ProjectBudgetPanel).toBe('function');
  });

  it('exports MilestonesPanel', async () => {
    const mod = await import('./components/MilestonesPanel');
    expect(typeof mod.MilestonesPanel).toBe('function');
  });

  it('exports DevReviewPanel', async () => {
    const mod = await import('./components/DevReviewPanel');
    expect(typeof mod.DevReviewPanel).toBe('function');
  });

  it('exports WorkflowMapPanel', async () => {
    const mod = await import('./components/WorkflowMapPanel');
    expect(typeof mod.WorkflowMapPanel).toBe('function');
  });
});
