import { describe, expect, it } from 'vitest';
import { selectModel } from '../../core/agent-runtime/model-router.js';
import { selectModelForRole } from '../../core/agent-runtime/select-model-for-role.js';
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

// ─── selectModelForRole ────────────────────────────────────────────────────────

describe('selectModelForRole', () => {
  it('returns skill default when no config or DB override', () => {
    const result = selectModelForRole('developer', undefined, { modelPin: 'haiku' });
    expect(result.primary).toBe('haiku');
    expect(result.source).toBe('skill-default');
  });

  it('project config rolesModels wins over skill default', () => {
    const result = selectModelForRole(
      'developer',
      {
        rolesModels: { developer: { primary: 'sonnet', fallback: 'haiku', advisor: null } },
        allowHoldoutOverride: false,
      },
      { modelPin: 'haiku' },
    );
    expect(result.primary).toBe('sonnet');
    expect(result.fallback).toBe('haiku');
    expect(result.source).toBe('project-config');
  });

  it('DB override wins over project config', () => {
    const result = selectModelForRole(
      'developer',
      {
        rolesModels: { developer: { primary: 'sonnet', fallback: null, advisor: null } },
        allowHoldoutOverride: false,
      },
      { modelPin: 'haiku' },
      { primaryModel: 'opus', fallbackModel: null, advisorModel: null },
    );
    expect(result.primary).toBe('opus');
    expect(result.source).toBe('db');
  });

  it('holdout override silently dropped without allowHoldoutOverride', () => {
    const result = selectModelForRole(
      'qa',
      {
        rolesModels: { qa: { primary: 'haiku', fallback: null, advisor: null } },
        allowHoldoutOverride: false,
      },
      { modelPin: 'sonnet' },
      { primaryModel: 'haiku', fallbackModel: null, advisorModel: null },
    );
    // Both DB and config override dropped; falls through to skill default
    expect(result.primary).toBe('sonnet');
    expect(result.source).toBe('skill-default');
  });

  it('holdout override applied with allowHoldoutOverride: true', () => {
    const result = selectModelForRole(
      'qa',
      {
        rolesModels: { qa: { primary: 'haiku', fallback: null, advisor: null } },
        allowHoldoutOverride: true,
      },
      { modelPin: 'sonnet' },
      { primaryModel: 'haiku', fallbackModel: null, advisorModel: null },
    );
    expect(result.primary).toBe('haiku');
    expect(result.source).toBe('db');
  });

  it('reviewer holdout override also gated', () => {
    const result = selectModelForRole(
      'reviewer',
      { rolesModels: {}, allowHoldoutOverride: false },
      { modelPin: 'sonnet' },
      { primaryModel: 'haiku', fallbackModel: null, advisorModel: null },
    );
    expect(result.primary).toBe('sonnet');
    expect(result.source).toBe('skill-default');
  });

  it('falls back to role default when no skill config', () => {
    const result = selectModelForRole('triager', undefined, undefined);
    expect(result.primary).toBe('haiku');
    expect(result.source).toBe('role-default');
  });

  it('DB override with invalid tier is ignored (no valid primaryModel)', () => {
    const result = selectModelForRole(
      'developer',
      undefined,
      { modelPin: 'haiku' },
      { primaryModel: null, fallbackModel: null, advisorModel: null },
    );
    // null primaryModel → not valid → falls through to skill default
    expect(result.primary).toBe('haiku');
    expect(result.source).toBe('skill-default');
  });

  it('DB fallback/advisor survive when primaryModel is null', () => {
    const result = selectModelForRole(
      'developer',
      {
        rolesModels: { developer: { primary: 'sonnet', fallback: null, advisor: null } },
        allowHoldoutOverride: false,
      },
      { modelPin: 'haiku' },
      { primaryModel: null, fallbackModel: 'haiku', advisorModel: null },
    );
    // Primary comes from project config (DB primary is null), but fallback from DB wins
    expect(result.primary).toBe('sonnet');
    expect(result.fallback).toBe('haiku');
    expect(result.source).toBe('project-config');
  });
});

// ─── selectModel (complexity-based) ────────────────────────────────────────────

describe('selectModel', () => {
  it('returns null for holdout roles', () => {
    expect(selectModel({ workItem: baseWorkItem, role: 'qa', projectId: 'p1' })).toBeNull();
    expect(selectModel({ workItem: baseWorkItem, role: 'reviewer', projectId: 'p1' })).toBeNull();
  });

  it('DB complexity override wins over config override', () => {
    const result = selectModel({
      workItem: { ...baseWorkItem, type: 'bug' },
      role: 'developer',
      projectId: 'p1',
      modelRouterConfig: { overrides: { 'developer+type:bug': 'sonnet' } },
      dbComplexityOverrides: { 'type:bug': 'haiku' },
    });
    expect(result?.tier).toBe('haiku');
    expect(result?.reason).toBe('db-complexity-override');
  });

  it('config override used when no DB override matches', () => {
    const result = selectModel({
      workItem: { ...baseWorkItem, type: 'bug' },
      role: 'developer',
      projectId: 'p1',
      modelRouterConfig: { overrides: { 'developer+type:bug': 'sonnet' } },
      dbComplexityOverrides: { 'type:chore': 'haiku' },
    });
    expect(result?.tier).toBe('sonnet');
    expect(result?.reason).toBe('project-override');
  });

  it('DB default key applies when no type/priority key matches', () => {
    const result = selectModel({
      workItem: { ...baseWorkItem, type: 'feature', priority: 'low' },
      role: 'developer',
      projectId: 'p1',
      dbComplexityOverrides: { default: 'opus' },
    });
    expect(result?.tier).toBe('opus');
    expect(result?.reason).toBe('db-complexity-override');
  });

  it('DB priority override wins over static policy', () => {
    const result = selectModel({
      workItem: { ...baseWorkItem, priority: 'high' },
      role: 'developer',
      projectId: 'p1',
      dbComplexityOverrides: { 'priority:high': 'haiku' },
    });
    expect(result?.tier).toBe('haiku');
    expect(result?.reason).toBe('db-complexity-override');
  });

  it('falls through to static policy when no overrides match', () => {
    const result = selectModel({
      workItem: { ...baseWorkItem, type: 'bug', priority: 'low' },
      role: 'developer',
      projectId: 'p1',
      dbComplexityOverrides: {},
    });
    expect(result?.tier).toBe('haiku');
    expect(result?.reason).toBe('type-bug');
  });
});
