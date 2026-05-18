import { describe, expect, it } from 'vitest';
import { auditSkillContracts, formatSkillContractAudit } from './skill-contract-audit.js';

describe('skill-contract-audit', () => {
  it('produces a readable per-skill report without enforcing cleanliness', () => {
    const audit = auditSkillContracts(process.cwd());
    expect(audit.skills.length).toBeGreaterThan(0);

    const implement = audit.skills.find((s: { skill: string }) => s.skill === 'implement');
    expect(implement).toBeDefined();

    const output = formatSkillContractAudit(audit);
    expect(output).toContain('## implement');
    expect(output).toContain('allowlistTags:');
    expect(output).toContain('schemaFields:');
    expect(output).toContain('outputExample:');
  });

  it('enforces deterministic context tag drift checks for every runtime skill', () => {
    const audit = auditSkillContracts(process.cwd());

    for (const report of audit.skills) {
      expect(report.snakeCaseTags, `${report.skill} should not reference snake_case tags`).toEqual(
        [],
      );
      expect(
        report.missingFromPrompt,
        `${report.skill} should reference every allowlisted tag`,
      ).toEqual([]);
      expect(
        report.extraPromptTags,
        `${report.skill} should only reference allowlisted tags`,
      ).toEqual([]);
    }
  });

  it('marks the grill/prd/decompose/advisor family clean', () => {
    const audit = auditSkillContracts(process.cwd());
    const cleanSkills = [
      'grill-me',
      'write-prd',
      'advise-on-prd',
      'decompose-issues',
      'advise-on-plan',
    ];

    for (const skill of cleanSkills) {
      const report = audit.skills.find((s: { skill: string }) => s.skill === skill);
      expect(report, `${skill} should be audited`).toBeDefined();
      expect(report?.snakeCaseTags, `${skill} should not reference snake_case tags`).toEqual([]);
      expect(report?.missingFromPrompt, `${skill} should reference every allowlisted tag`).toEqual(
        [],
      );
      expect(report?.extraPromptTags, `${skill} should only reference allowlisted tags`).toEqual(
        [],
      );
    }
  });

  it('marks the investigate/scout/wave/spec-author family clean', () => {
    const audit = auditSkillContracts(process.cwd());
    const cleanSkills = [
      'investigate',
      'scout-code-path',
      'scout-dependency',
      'scout-pattern',
      'scout-schema',
      'scout-test-inventory',
      'scout-user-journey',
      'wave2-interface-designer',
      'wave2-risk-analyst',
      'spec-author',
    ];

    for (const skill of cleanSkills) {
      const report = audit.skills.find((s: { skill: string }) => s.skill === skill);
      expect(report, `${skill} should be audited`).toBeDefined();
      expect(report?.snakeCaseTags, `${skill} should not reference snake_case tags`).toEqual([]);
      expect(report?.missingFromPrompt, `${skill} should reference every allowlisted tag`).toEqual(
        [],
      );
      expect(report?.extraPromptTags, `${skill} should only reference allowlisted tags`).toEqual(
        [],
      );
    }
  });

  it('marks the implement/QA/review/evidence family clean', () => {
    const audit = auditSkillContracts(process.cwd());
    const cleanSkills = [
      'implement',
      'implement-wp',
      'qa',
      'review',
      'dev-review',
      'dev-review-response',
      'evidence-post',
      'playwright-repro',
      'resolve-conflict',
    ];

    for (const skill of cleanSkills) {
      const report = audit.skills.find((s: { skill: string }) => s.skill === skill);
      expect(report, `${skill} should be audited`).toBeDefined();
      expect(report?.snakeCaseTags, `${skill} should not reference snake_case tags`).toEqual([]);
      expect(report?.missingFromPrompt, `${skill} should reference every allowlisted tag`).toEqual(
        [],
      );
      expect(report?.extraPromptTags, `${skill} should only reference allowlisted tags`).toEqual(
        [],
      );
    }
  });

  it('marks the retrospective/audit/coach/sprint family clean', () => {
    const audit = auditSkillContracts(process.cwd());
    const cleanSkills = [
      'retrospective-light',
      'retrospective-deep',
      'retrospective-cross-run',
      'code-quality-audit',
      'skill-coach',
      'sprint-review',
      'bug-enhance',
      'repo-match',
      'triage',
      'echo-test',
      'echo-test-holdout',
    ];

    for (const skill of cleanSkills) {
      const report = audit.skills.find((s: { skill: string }) => s.skill === skill);
      expect(report, `${skill} should be audited`).toBeDefined();
      expect(report?.snakeCaseTags, `${skill} should not reference snake_case tags`).toEqual([]);
      expect(report?.missingFromPrompt, `${skill} should reference every allowlisted tag`).toEqual(
        [],
      );
      expect(report?.extraPromptTags, `${skill} should only reference allowlisted tags`).toEqual(
        [],
      );
    }
  });
});
