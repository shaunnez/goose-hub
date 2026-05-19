import { auditSkillContracts, formatSkillContractAudit } from '../core/agent-runtime/skill-contract-audit.js';

const strict = process.argv.includes('--strict');
const audit = auditSkillContracts(process.cwd());

console.log(formatSkillContractAudit(audit));

if (strict) {
  const enforcePathLanguageFor = new Set(['implement', 'implement-wp', 'spec-author']);
  const violations = audit.skills.filter(
    (s) =>
      s.snakeCaseTags.length > 0 ||
      s.missingFromPrompt.length > 0 ||
      s.extraPromptTags.length > 0 ||
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
