import { describe, expect, it } from 'vitest';
import { selectModel } from '../../core/agent-runtime/model-router.js';
import type { WorkItem } from '../../core/state-source/interface.js';

const baseWorkItem: WorkItem = {
  id: 'github:owner/repo#1',
  externalId: '1',
  repoRef: 'owner/repo',
  title: 'Test issue',
  body: '- [ ] AC1',
  type: 'feature',
  priority: 'medium',
  mode: 'supervised',
  state: 'factory:accepted',
  authorIsOwner: true,
  schedule: 'current',
  exec: 'serial',
  dependsOn: [],
  blocks: [],
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

// ─── selectModel (complexity-based) ────────────────────────────────────────────

describe('selectModel', () => {
  it('returns null for holdout roles', () => {
    expect(selectModel({ workItem: baseWorkItem, role: 'qa', projectId: 'p1' })).toBeNull();
    expect(selectModel({ workItem: baseWorkItem, role: 'reviewer', projectId: 'p1' })).toBeNull();
  });

  it('config override wins over static policy', () => {
    const result = selectModel({
      workItem: { ...baseWorkItem, type: 'bug' },
      role: 'developer',
      projectId: 'p1',
      modelRouterConfig: { overrides: { 'developer+type:bug': 'sonnet' } },
    });
    expect(result?.tier).toBe('sonnet');
    expect(result?.reason).toBe('project-override');
  });

  it('role-level config override applies when no type/priority key matches', () => {
    const result = selectModel({
      workItem: { ...baseWorkItem, type: 'feature', priority: 'low' },
      role: 'developer',
      projectId: 'p1',
      modelRouterConfig: { overrides: { developer: 'opus' } },
    });
    expect(result?.tier).toBe('opus');
    expect(result?.reason).toBe('project-override');
  });

  it('falls through to static policy when no overrides match', () => {
    const result = selectModel({
      workItem: { ...baseWorkItem, type: 'bug', priority: 'low' },
      role: 'developer',
      projectId: 'p1',
    });
    expect(result?.tier).toBe('haiku');
    expect(result?.reason).toBe('type-bug');
  });
});
