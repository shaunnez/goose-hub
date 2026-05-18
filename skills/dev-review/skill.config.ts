import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { DevReviewContextSchema } from './schema.js';

/**
 * Codex pre-QA dev-review skill (M19.11). This is an **advisor to the
 * developer**, NOT a holdout. The developer reads the findings and decides
 * what to act on before transitioning to QA. QA never sees this output.
 *
 * - `provider: 'codex'` — runs on the OpenAI Codex CLI sibling (M19.10).
 * - `freshContext: true` — Codex starts clean every run; the goal is an
 *   independent reading of the diff, not collaboration with the dev agent.
 * - `role: 'dev-reviewer'` — registered in `core/agent-runtime/roles.ts`,
 *   NOT in any holdout set. FACTORY_RULES rule 1 explicitly preserved:
 *   the holdout-context-exclusion guard in context-assembly.ts ensures
 *   `devReviewFindings` etc. cannot leak into QA / Reviewer specs.
 *
 * Tool bundle is `read` only — no shell, no write tools. Codex reads files
 * + diff + slice tests, returns a structured finding list with file:line
 * evidence. M19.12 wires this skill into the implement workflow.
 */
const config: SkillConfig = {
  contextSchema: DevReviewContextSchema,
  toolBundles: ['read'],
  modelPin: 'sonnet',
  provider: 'codex',
  freshContext: true,
  role: 'dev-reviewer',
  contextAllowlist: ['workItem', 'prDiff', 'sliceTests', 'projectCommands', 'symbolImpact'],
};

export default config;
export { DevReviewContextSchema };
