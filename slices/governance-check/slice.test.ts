import {
  checkGovernance,
  expandPrFileChanges,
  isGovernancePath,
} from '@goose-hub/core/bootstrap/governance-check.js';
import type { ChangedFile, PrFileChange } from '@goose-hub/core/bootstrap/governance-check.js';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// isGovernancePath — unit tests
// ---------------------------------------------------------------------------

describe('isGovernancePath', () => {
  it.each([
    'MISSION.md',
    'FACTORY_RULES.md',
    'CLAUDE.md',
    'target-projects/my-slug/project.config.ts',
    'target-projects/my-slug/personas/reviewer.md',
    'target-projects/my-slug/personas/nested/deep.md',
    'target-projects/my-slug/MISSION.md',
    'target-projects/my-slug/FACTORY_RULES.md',
  ])('recognises governance path: %s', (path) => {
    expect(isGovernancePath(path)).toBe(true);
  });

  it.each([
    'core/bootstrap/governance-check.ts',
    'slices/governance-check/slice.test.ts',
    '.github/workflows/governance-check.yml',
    'scripts/governance-check-pr.ts',
    'target-projects/my-slug/project.config.ts.bak', // extension mismatch
    'target-projects/my-slug/agent-context/dev.md', // not in perimeter
    'docs/PLAN.md',
    'CLAUDE.md.backup', // not exact root CLAUDE.md
    'some/nested/MISSION.md', // not root
  ])('does NOT flag non-governance path: %s', (path) => {
    expect(isGovernancePath(path)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkGovernance — PR without bootstrap label
// ---------------------------------------------------------------------------

describe('checkGovernance — regular PR (no bootstrap label)', () => {
  it('passes when no governance files are touched', () => {
    const changes: ChangedFile[] = [
      { path: 'src/index.ts', status: 'modified' },
      { path: 'core/bootstrap/governance-check.ts', status: 'added' },
    ];
    const result = checkGovernance(changes, false);
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('fails when MISSION.md is modified', () => {
    const changes: ChangedFile[] = [{ path: 'MISSION.md', status: 'modified' }];
    const result = checkGovernance(changes, false);
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].path).toBe('MISSION.md');
    expect(result.violations[0].reason).toMatch(/Modification of governance file/);
    expect(result.violations[0].reason).toMatch(/`MISSION\.md`/);
  });

  it('fails when FACTORY_RULES.md is modified', () => {
    const changes: ChangedFile[] = [{ path: 'FACTORY_RULES.md', status: 'modified' }];
    const result = checkGovernance(changes, false);
    expect(result.ok).toBe(false);
    expect(result.violations[0].reason).toMatch(/FACTORY_RULES\.md/);
  });

  it('fails when CLAUDE.md is modified', () => {
    const changes: ChangedFile[] = [{ path: 'CLAUDE.md', status: 'modified' }];
    const result = checkGovernance(changes, false);
    expect(result.ok).toBe(false);
  });

  it('fails when a project.config.ts is modified', () => {
    const changes: ChangedFile[] = [
      { path: 'target-projects/my-proj/project.config.ts', status: 'modified' },
    ];
    const result = checkGovernance(changes, false);
    expect(result.ok).toBe(false);
    expect(result.violations[0].reason).toMatch(/Modification of governance file/);
  });

  it('fails when a personas file is modified', () => {
    const changes: ChangedFile[] = [
      { path: 'target-projects/my-proj/personas/reviewer.md', status: 'modified' },
    ];
    const result = checkGovernance(changes, false);
    expect(result.ok).toBe(false);
  });

  it('fails when a governance file is ADDED on a regular PR', () => {
    const changes: ChangedFile[] = [
      { path: 'target-projects/new-slug/project.config.ts', status: 'added' },
    ];
    const result = checkGovernance(changes, false);
    expect(result.ok).toBe(false);
    expect(result.violations[0].reason).toMatch(/only factory:bootstrap-pr PRs may add/);
  });

  it('fails when a governance file is REMOVED', () => {
    const changes: ChangedFile[] = [{ path: 'MISSION.md', status: 'removed' }];
    const result = checkGovernance(changes, false);
    expect(result.ok).toBe(false);
    expect(result.violations[0].reason).toMatch(/Deletion of governance file/);
  });

  it('reports all violations in a single pass', () => {
    const changes: ChangedFile[] = [
      { path: 'MISSION.md', status: 'modified' },
      { path: 'FACTORY_RULES.md', status: 'modified' },
      { path: 'src/util.ts', status: 'added' },
    ];
    const result = checkGovernance(changes, false);
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// checkGovernance — bootstrap PR (factory:bootstrap-pr label present)
// ---------------------------------------------------------------------------

describe('checkGovernance — bootstrap PR (factory:bootstrap-pr label)', () => {
  it('passes when new target-projects/<slug>/project.config.ts is ADDED', () => {
    const changes: ChangedFile[] = [
      { path: 'target-projects/test-slug/project.config.ts', status: 'added' },
    ];
    const result = checkGovernance(changes, true);
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('passes when new personas file is ADDED under target-projects/<slug>/', () => {
    const changes: ChangedFile[] = [
      { path: 'target-projects/test-slug/personas/reviewer.md', status: 'added' },
    ];
    const result = checkGovernance(changes, true);
    expect(result.ok).toBe(true);
  });

  it('passes when CLAUDE.md is ADDED (initial creation)', () => {
    const changes: ChangedFile[] = [{ path: 'CLAUDE.md', status: 'added' }];
    const result = checkGovernance(changes, true);
    expect(result.ok).toBe(true);
  });

  it('passes when both new project governance files and CLAUDE.md are added', () => {
    const changes: ChangedFile[] = [
      { path: 'CLAUDE.md', status: 'added' },
      { path: 'target-projects/test-slug/project.config.ts', status: 'added' },
      { path: 'target-projects/test-slug/personas/dev.md', status: 'added' },
      { path: 'target-projects/test-slug/MISSION.md', status: 'added' },
      { path: 'target-projects/test-slug/FACTORY_RULES.md', status: 'added' },
    ];
    const result = checkGovernance(changes, true);
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('FAILS when MISSION.md (root) is MODIFIED even on bootstrap PR', () => {
    const changes: ChangedFile[] = [{ path: 'MISSION.md', status: 'modified' }];
    const result = checkGovernance(changes, true);
    expect(result.ok).toBe(false);
    expect(result.violations[0].reason).toMatch(/bootstrap PRs may only ADD/);
  });

  it('FAILS when FACTORY_RULES.md is MODIFIED on bootstrap PR', () => {
    const changes: ChangedFile[] = [{ path: 'FACTORY_RULES.md', status: 'modified' }];
    const result = checkGovernance(changes, true);
    expect(result.ok).toBe(false);
  });

  it('FAILS when an existing project.config.ts is MODIFIED on bootstrap PR', () => {
    const changes: ChangedFile[] = [
      { path: 'target-projects/existing-slug/project.config.ts', status: 'modified' },
    ];
    const result = checkGovernance(changes, true);
    expect(result.ok).toBe(false);
    expect(result.violations[0].reason).toMatch(/bootstrap PRs may only ADD/);
  });

  it('FAILS when a governance file is REMOVED on bootstrap PR', () => {
    const changes: ChangedFile[] = [
      { path: 'target-projects/some-slug/personas/dev.md', status: 'removed' },
    ];
    const result = checkGovernance(changes, true);
    expect(result.ok).toBe(false);
  });

  it('FAILS when CLAUDE.md is MODIFIED (not added) on bootstrap PR', () => {
    const changes: ChangedFile[] = [{ path: 'CLAUDE.md', status: 'modified' }];
    const result = checkGovernance(changes, true);
    expect(result.ok).toBe(false);
    expect(result.violations[0].reason).toMatch(/bootstrap PRs may only ADD/);
  });

  it('passes for non-governance files alongside bootstrap additions', () => {
    const changes: ChangedFile[] = [
      { path: 'target-projects/test-slug/project.config.ts', status: 'added' },
      { path: 'core/orchestrator/index.ts', status: 'modified' },
      { path: 'scripts/setup.sh', status: 'added' },
    ];
    const result = checkGovernance(changes, true);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Acceptance criteria scenario: the issue specifies this exact test case
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// expandPrFileChanges — rename bypass guard
// ---------------------------------------------------------------------------

describe('expandPrFileChanges', () => {
  it('passes added/modified/removed entries through unchanged', () => {
    const prFiles: PrFileChange[] = [
      { filename: 'src/a.ts', status: 'added' },
      { filename: 'src/b.ts', status: 'modified' },
      { filename: 'src/c.ts', status: 'removed' },
    ];
    expect(expandPrFileChanges(prFiles)).toEqual([
      { path: 'src/a.ts', status: 'added' },
      { path: 'src/b.ts', status: 'modified' },
      { path: 'src/c.ts', status: 'removed' },
    ]);
  });

  it('splits a renamed entry into a removed of the previous path plus the renamed new path', () => {
    const prFiles: PrFileChange[] = [
      { filename: 'docs/MISSION.md', status: 'renamed', previous_filename: 'MISSION.md' },
    ];
    expect(expandPrFileChanges(prFiles)).toEqual([
      { path: 'MISSION.md', status: 'removed' },
      { path: 'docs/MISSION.md', status: 'renamed' },
    ]);
  });

  it('handles a rename without a previous_filename gracefully', () => {
    const prFiles: PrFileChange[] = [{ filename: 'src/x.ts', status: 'renamed' }];
    expect(expandPrFileChanges(prFiles)).toEqual([{ path: 'src/x.ts', status: 'renamed' }]);
  });

  it('does not emit a duplicate removed when previous_filename equals filename', () => {
    const prFiles: PrFileChange[] = [
      { filename: 'src/x.ts', status: 'renamed', previous_filename: 'src/x.ts' },
    ];
    expect(expandPrFileChanges(prFiles)).toEqual([{ path: 'src/x.ts', status: 'renamed' }]);
  });

  it('coerces unknown statuses to modified', () => {
    const prFiles: PrFileChange[] = [{ filename: 'src/y.ts', status: 'copied' }];
    expect(expandPrFileChanges(prFiles)).toEqual([{ path: 'src/y.ts', status: 'modified' }]);
  });
});

describe('checkGovernance — rename bypass guard (P1)', () => {
  it('FAILS when a governance file is renamed OUT of the perimeter', () => {
    // Simulates: MISSION.md -> docs/MISSION.md
    const changes = expandPrFileChanges([
      { filename: 'docs/MISSION.md', status: 'renamed', previous_filename: 'MISSION.md' },
    ]);
    const result = checkGovernance(changes, false);
    expect(result.ok).toBe(false);
    // The previous (governance) path is flagged as a removal violation.
    expect(result.violations.some((v) => v.path === 'MISSION.md')).toBe(true);
  });

  it('FAILS when an existing project.config.ts is renamed under bootstrap label', () => {
    const changes = expandPrFileChanges([
      {
        filename: 'target-projects/old/renamed-config.ts',
        status: 'renamed',
        previous_filename: 'target-projects/old/project.config.ts',
      },
    ]);
    const result = checkGovernance(changes, true);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.path === 'target-projects/old/project.config.ts')).toBe(
      true,
    );
  });

  it('still passes when a non-governance file is renamed', () => {
    const changes = expandPrFileChanges([
      { filename: 'src/new.ts', status: 'renamed', previous_filename: 'src/old.ts' },
    ]);
    const result = checkGovernance(changes, false);
    expect(result.ok).toBe(true);
  });
});

describe('acceptance criteria scenario', () => {
  const newProjectConfigPath = 'target-projects/test-slug/project.config.ts';
  const changes: ChangedFile[] = [{ path: newProjectConfigPath, status: 'added' }];

  it('bootstrap PR with new target-projects/test-slug/project.config.ts → check passes', () => {
    const result = checkGovernance(changes, true);
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('regular PR with same change → check fails', () => {
    const result = checkGovernance(changes, false);
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].path).toBe(newProjectConfigPath);
  });
});
