import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { CodeQualityAuditContextSchema, CodeQualityAuditOutputSchema } from './schema.js';

const config: SkillConfig = {
  contextSchema: CodeQualityAuditContextSchema,
  outputSchema: CodeQualityAuditOutputSchema,
  /**
   * Tool bundles:
   * - 'read'  — Read files, Grep, Glob against the working tree
   * - 'shell' — git log / git blame for Cat 7 (Gall's Law evolution analysis)
   *             Shell is restricted by prompt to read-only git operations only.
   */
  toolBundles: ['read', 'shell'],
  /** Opus: qualitative reasoning across Cat 1-4, 7 requires deep synthesis. */
  modelPin: 'opus',
  /** Not a holdout role — auditor sees full reasoning. */
  freshContext: false,
  role: 'auditor',
  contextAllowlist: ['worktreePath', 'metricsJson', 'workItem'],
};

export { CodeQualityAuditContextSchema, CodeQualityAuditOutputSchema };
export default config;
