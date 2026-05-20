import { auditSkillContracts, formatSkillContractAudit } from '../core/agent-runtime/skill-contract-audit.js';

const strict = process.argv.includes('--strict');
const audit = await auditSkillContracts(process.cwd());

console.log(formatSkillContractAudit(audit));

if (strict) {
  const enforcePathLanguageFor = new Set(['implement', 'implement-wp', 'spec-author']);
  const violations = audit.skills.filter(
    (s) =>
      s.snakeCaseTags.length > 0 ||
      s.missingFromPrompt.length > 0 ||
      s.extraPromptTags.length > 0 ||
      !s.outputSchema.configured ||
      s.worktreePathExposure.allowlist ||
      s.worktreePathExposure.promptLines.length > 0 ||
      ['missing-output-example', 'invalid-output-example', 'no-marked-output-example'].includes(
        s.outputExample.status,
      ) ||
      (enforcePathLanguageFor.has(s.skill) &&
        (s.pathLanguage.vagueWorkspaceRelative.length > 0 ||
          s.pathLanguage.packageRelativeExamples.length > 0)),
  );
  if (violations.length > 0) {
    console.error(
      `\nstrict mode failed: ${violations.length} skill(s) contain deterministic contract drift`,
    );
    for (const violation of violations) {
      console.error(
        [
          `- ${violation.skill}`,
          `snakeCase=${violation.snakeCaseTags.join(',') || '(none)'}`,
          `missing=${violation.missingFromPrompt.join(',') || '(none)'}`,
          `extra=${violation.extraPromptTags.join(',') || '(none)'}`,
          `outputSchema=${
            violation.outputSchema.configured
              ? (violation.outputSchema.configuredSchema ?? '(configured)')
              : '(missing)'
          }`,
          `outputExample=${violation.outputExample.status}`,
          `outputExampleIssues=${violation.outputExample.issues.join('|') || '(none)'}`,
          `worktreePathExposure=${violation.worktreePathExposure.allowlist ? 'allowlist' : ''}:${
            violation.worktreePathExposure.promptLines.length
          }`,
          `pathLanguageWorkspaceRelative=${violation.pathLanguage.vagueWorkspaceRelative.length}`,
          `pathLanguagePackageRelativeExamples=${
            violation.pathLanguage.packageRelativeExamples.join(',') || '(none)'
          }`,
        ].join(' '),
      );
    }
    process.exit(1);
  }
}
