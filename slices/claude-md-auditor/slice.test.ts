import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  type AuditResult,
  type StackInfo,
  auditClaudeMd,
} from '@goose-hub/core/bootstrap/claude-md-auditor.js';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fixturesDir = path.join(import.meta.dirname, 'fixtures');

const minimalStack: StackInfo = {
  type: 'node',
  commands: {
    build: 'pnpm build',
    test: 'pnpm test',
    lint: 'pnpm lint',
    typecheck: 'pnpm typecheck',
  },
};

// ---------------------------------------------------------------------------
// Scenario 1: no CLAUDE.md → action='create'
// ---------------------------------------------------------------------------

describe('auditClaudeMd — no CLAUDE.md', () => {
  it('returns action=create with populated template content', async () => {
    const repoPath = path.join(fixturesDir, 'no-claude-md');
    const result: AuditResult = await auditClaudeMd(repoPath, minimalStack);

    expect(result.action).toBe('create');
    expect(result.rationale).toBeTruthy();
    expect(result.content).toBeTruthy();

    // Template must include key sections
    expect(result.content).toContain('## What this repo is');
    expect(result.content).toContain('## Stack');
    expect(result.content).toContain('## Commands');
    expect(result.content).toContain('## Hard rules');
    expect(result.content).toContain('## PR conventions');
    // Holdout-safety boundary mandated by CONTEXT.md:275
    expect(result.content).toContain("## What goes here / What doesn't");

    // Stack commands should be populated
    expect(result.content).toContain('pnpm build');
    expect(result.content).toContain('pnpm test');
    expect(result.content).toContain('pnpm lint');
    expect(result.content).toContain('pnpm typecheck');
  });

  it('does NOT write to disk', async () => {
    const repoPath = path.join(fixturesDir, 'no-claude-md');
    await auditClaudeMd(repoPath, minimalStack);

    // Verify no CLAUDE.md was created in the fixture dir
    await expect(fs.access(path.join(repoPath, 'CLAUDE.md'))).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: partial CLAUDE.md (missing sections) → action='update'
// ---------------------------------------------------------------------------

describe('auditClaudeMd — partial CLAUDE.md (missing sections)', () => {
  it('returns action=update with a unified diff for missing sections', async () => {
    const repoPath = path.join(fixturesDir, 'partial-claude-md');
    const result: AuditResult = await auditClaudeMd(repoPath, minimalStack);

    expect(result.action).toBe('update');
    expect(result.rationale).toBeTruthy();
    expect(result.content).toBeTruthy();

    // Diff must include missing sections (Commands, Hard rules, PR conventions)
    expect(result.content).toContain('## Commands');
    expect(result.content).toContain('## Hard rules');
    expect(result.content).toContain('## PR conventions');

    // Diff format indicators
    expect(result.content).toContain('+++');
    expect(result.content).toContain('@@');

    // Existing sections should NOT appear as additions
    expect(result.content).not.toContain('+## What this repo is');
    expect(result.content).not.toContain('+## Stack');
  });

  it('rationale lists the missing section names', async () => {
    const repoPath = path.join(fixturesDir, 'partial-claude-md');
    const result: AuditResult = await auditClaudeMd(repoPath, minimalStack);

    expect(result.rationale).toContain('Commands');
    expect(result.rationale).toContain('Hard rules');
    expect(result.rationale).toContain('PR conventions');
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: complete CLAUDE.md → action='ok'
// ---------------------------------------------------------------------------

describe('auditClaudeMd — complete CLAUDE.md', () => {
  it('returns action=ok with empty content and rationale', async () => {
    const repoPath = path.join(fixturesDir, 'complete-claude-md');
    const result: AuditResult = await auditClaudeMd(repoPath, minimalStack);

    expect(result.action).toBe('ok');
    expect(result.content).toBe('');
    expect(result.rationale).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: stack with e2e command
// ---------------------------------------------------------------------------

describe('auditClaudeMd — stack with e2e command', () => {
  it('includes e2e command in generated template', async () => {
    const repoPath = path.join(fixturesDir, 'no-claude-md');
    const stackWithE2e: StackInfo = {
      ...minimalStack,
      commands: { ...minimalStack.commands, e2e: 'pnpm playwright test' },
    };
    const result: AuditResult = await auditClaudeMd(repoPath, stackWithE2e);

    expect(result.action).toBe('create');
    expect(result.content).toContain('pnpm playwright test');
  });
});

// ---------------------------------------------------------------------------
// Scenario: holdout-safety section is mandatory (P1 from review)
// ---------------------------------------------------------------------------

describe('auditClaudeMd — holdout-safety section is required (CONTEXT.md:275)', () => {
  it('flags a CLAUDE.md missing the holdout-safety section as needing update', async () => {
    // The partial fixture has Stack + What-this-repo-is but is missing
    // PR conventions and What-goes-here / What-doesn't, so it must update.
    const repoPath = path.join(fixturesDir, 'partial-claude-md');
    const result: AuditResult = await auditClaudeMd(repoPath, minimalStack);

    expect(result.action).toBe('update');
    expect(result.content).toContain("## What goes here / What doesn't");
    expect(result.rationale).toContain("What goes here / What doesn't");
  });
});

// ---------------------------------------------------------------------------
// Scenario: read errors other than ENOENT surface (P2 from review)
// ---------------------------------------------------------------------------

describe('auditClaudeMd — non-ENOENT read errors surface', () => {
  it('rethrows when the repo path itself is not a directory', async () => {
    // Pointing repoPath at a file rather than a directory triggers ENOTDIR
    // when joining `<file>/CLAUDE.md`, which must surface rather than be
    // silently misreported as "no CLAUDE.md".
    const notADir = path.join(fixturesDir, 'partial-claude-md', 'CLAUDE.md');
    await expect(auditClaudeMd(notADir, minimalStack)).rejects.toMatchObject({
      code: 'ENOTDIR',
    });
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: AuditResult shape
// ---------------------------------------------------------------------------

describe('AuditResult type shape', () => {
  it('result has action, content, and rationale fields', async () => {
    const repoPath = path.join(fixturesDir, 'no-claude-md');
    const result: AuditResult = await auditClaudeMd(repoPath, minimalStack);

    expect(result).toHaveProperty('action');
    expect(result).toHaveProperty('content');
    expect(result).toHaveProperty('rationale');
    expect(['create', 'update', 'ok']).toContain(result.action);
    expect(typeof result.content).toBe('string');
    expect(typeof result.rationale).toBe('string');
  });
});
