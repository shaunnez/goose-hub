import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  auditFileReferences,
  auditMilestoneSpan,
  auditReadmeSkillsCoverage,
  auditRolesInClaude,
  auditSkillStructure,
  formatFindings,
} from './audit-docs.js';

const REPO_ROOT = path.resolve(__dirname, '..');

describe('auditSkillStructure', () => {
  it('reports nothing if all skills have the required trio', () => {
    const findings = auditSkillStructure(REPO_ROOT);
    const errors = findings.filter((f) => f.severity === 'error');
    // We expect this to be clean; if it fails, the failure message tells us which skill is broken.
    if (errors.length > 0) {
      console.error('Skill structure errors:', errors);
    }
    expect(errors).toEqual([]);
  });
});

describe('auditRolesInClaude', () => {
  it('extracts the Role union from core/types.ts and compares to CLAUDE.md', () => {
    const findings = auditRolesInClaude(REPO_ROOT);
    // Knowing the current state of CLAUDE.md: it lists Triager..Advisor but misses dev-reviewer and auditor.
    // The audit must flag at least those two.
    const missingMessages = findings.map((f) => f.message);
    expect(missingMessages.some((m) => m.toLowerCase().includes('dev-reviewer'))).toBe(true);
    expect(missingMessages.some((m) => m.toLowerCase().includes('auditor'))).toBe(true);
  });
});

describe('auditFileReferences', () => {
  it('confirms canonical referenced files exist', () => {
    const findings = auditFileReferences(REPO_ROOT);
    const errors = findings.filter((f) => f.severity === 'error');
    expect(errors).toEqual([]);
  });
});

describe('auditMilestoneSpan', () => {
  it('flags drift when CLAUDE.md milestone span lags the active milestone', () => {
    const findings = auditMilestoneSpan(REPO_ROOT);
    // CLAUDE.md says "M0–M18". goose-hub-self is on M19. We expect a warning.
    expect(findings.some((f) => f.severity === 'warn' && /M\d+/.test(f.message))).toBe(true);
  });
});

describe('auditReadmeSkillsCoverage', () => {
  it('returns findings as an array (informational only)', () => {
    const findings = auditReadmeSkillsCoverage(REPO_ROOT);
    expect(Array.isArray(findings)).toBe(true);
  });
});

describe('formatFindings', () => {
  it('groups findings by severity and produces a non-empty string when findings exist', () => {
    const out = formatFindings([
      { severity: 'error', area: 'skills', message: 'foo missing prompt.md', file: 'skills/foo' },
      { severity: 'warn', area: 'roles', message: 'role bar missing from CLAUDE.md', file: 'CLAUDE.md' },
      { severity: 'info', area: 'milestone', message: 'all good' },
    ]);
    expect(out).toContain('ERROR');
    expect(out).toContain('WARN');
    expect(out).toContain('foo missing prompt.md');
    expect(out).toContain('role bar missing from CLAUDE.md');
  });

  it('returns a clean message when there are no findings', () => {
    expect(formatFindings([])).toContain('clean');
  });
});
