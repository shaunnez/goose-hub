import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { CodeQualityAuditContextSchema, CodeQualityAuditOutputSchema } from './schema.js';

const config: SkillConfig = {
  contextSchema: CodeQualityAuditContextSchema,
  outputSchema: CodeQualityAuditOutputSchema,
  /**
   * Tool bundles (post-ADR 0045):
   * - 'read' — factory-tools read/search/list + read-only git/diff family
   *   (covers Cat 7 Gall's Law evolution analysis via get_diff /
   *   get_status / get_head_sha / get_merge_base).
   * No 'shell' bundle — git invocations route through factory_get_diff
   * etc. instead of `git log` / `git blame` via Bash.
   */
  toolBundles: ['read'],
  /** Opus: qualitative reasoning across Cat 1-4, 7 requires deep synthesis. */
  modelPin: 'opus',
  /** Not a holdout role — auditor sees full reasoning. */
  freshContext: false,
  role: 'auditor',
  contextAllowlist: ['metricsJson', 'workItem'],
};

export { CodeQualityAuditContextSchema, CodeQualityAuditOutputSchema };
export default config;
