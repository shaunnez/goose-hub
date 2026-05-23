import { describe, expect, it } from 'vitest';
import { auditSkillContracts, formatSkillContractAudit } from './skill-contract-audit.js';

describe('skill-contract-audit', () => {
  it('produces a readable per-skill report without enforcing cleanliness', async () => {
    const audit = await auditSkillContracts(process.cwd());
    expect(audit.skills.length).toBeGreaterThan(0);

    const implement = audit.skills.find((s: { skill: string }) => s.skill === 'implement');
    expect(implement).toBeDefined();

    const output = formatSkillContractAudit(audit);
    expect(output).toContain('## implement');
    expect(output).toContain('allowlistTags:');
    expect(output).toContain('schemaFields:');
    expect(output).toContain('outputSchema:');
    expect(output).toContain('outputExample:');
    expect(output).toContain('pathLanguageWorkspaceRelative:');
    expect(output).toContain('pathLanguagePackageRelativeExamples:');
    expect(output).toContain('pathLanguagePackageRelativeCommandGuidance:');
    expect(output).toContain('projectOverlays:');
  });

  it('enforces deterministic context tag drift checks for every runtime skill', async () => {
    const audit = await auditSkillContracts(process.cwd());

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

  it('requires every runtime skill to declare its output schema in skill.config.ts', async () => {
    const audit = await auditSkillContracts(process.cwd());

    for (const report of audit.skills) {
      expect(
        report.outputSchema.configured,
        `${report.skill} should declare outputSchema in skill.config.ts`,
      ).toBe(true);
    }
  });

  it('requires every runtime skill output example to be marked and schema-valid', async () => {
    const audit = await auditSkillContracts(process.cwd());

    for (const report of audit.skills) {
      expect(
        report.outputExample.status,
        `${report.skill} should have a marked output example that passes outputSchema.safeParse`,
      ).toBe('valid-output-example');
    }
  });

  it('marks the grill/prd/decompose/advisor family clean', async () => {
    const audit = await auditSkillContracts(process.cwd());
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

  it('marks the investigate/scout/wave/spec-author family clean', async () => {
    const audit = await auditSkillContracts(process.cwd());
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

  it('marks the implement/QA/review/evidence family clean', async () => {
    const audit = await auditSkillContracts(process.cwd());
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

  it('keeps path language canonical across base prompts and project overlays', async () => {
    const audit = await auditSkillContracts(process.cwd());

    for (const report of audit.skills) {
      expect(
        report.pathLanguage.vagueWorkspaceRelative,
        `${report.skill} should avoid vague workspace-relative path language`,
      ).toEqual([]);
      expect(
        report.pathLanguage.packageRelativeExamples,
        `${report.skill} should avoid package-relative src/... or e2e/... output examples`,
      ).toEqual([]);
      expect(
        report.pathLanguage.packageRelativeCommandGuidance,
        `${report.skill} should avoid package-relative command guidance in path-bearing outputs`,
      ).toEqual([]);
    }
  });

  it('includes per-project overlays in the path-language audit', async () => {
    const audit = await auditSkillContracts(process.cwd());
    const specAuthor = audit.skills.find((s: { skill: string }) => s.skill === 'spec-author');

    expect(specAuthor?.projectOverlayPaths).toContain(
      'target-projects/goose-hub-self/agent-context/spec-author.md',
    );
    expect(specAuthor?.pathLanguage.packageRelativeCommandGuidance).toEqual([]);
  });

  it('keeps worktreePath out of skill prompts and context allowlists', async () => {
    const audit = await auditSkillContracts(process.cwd());

    for (const report of audit.skills) {
      expect(
        report.worktreePathExposure.allowlist,
        `${report.skill} should not allowlist worktreePath`,
      ).toBe(false);
      expect(
        report.worktreePathExposure.promptLines,
        `${report.skill} prompt should not mention worktreePath`,
      ).toEqual([]);
    }
  }, 10_000);

  it('marks the retrospective/audit/coach/sprint family clean', async () => {
    const audit = await auditSkillContracts(process.cwd());
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
