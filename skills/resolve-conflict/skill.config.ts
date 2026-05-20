import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { ResolveConflictContextSchema, ResolveConflictSchema } from './schema.js';

const config: SkillConfig = {
  contextSchema: ResolveConflictContextSchema,
  outputSchema: ResolveConflictSchema,
  contextAllowlist: ['conflictedFiles', 'baseBranch', 'prNumber'],
  /**
   * `dev-tools` bundle — read, write, search, bash, test. Workspace-bound
   * paths only; bash-denylist enforced. The slice runs the actual git
   * commands; this skill writes resolved files via the `write` tool.
   */
  toolBundles: ['dev-tools'],
  /**
   * Pinned to sonnet — routine resolution work. Opus reserved for advisor
   * and investigator (FACTORY_RULES rule 22).
   */
  modelPin: 'sonnet',
  /**
   * `freshContext: false` — the orchestrating slice supplies conflicted files
   * and roots tools at the workspace; no upstream agent reasoning is leaked.
   */
  freshContext: false,
  role: 'developer',
};

export default config;
