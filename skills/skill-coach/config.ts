import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { SkillCoachInputSchema } from './schema.js';

const config: SkillConfig = {
  contextSchema: SkillCoachInputSchema,
  contextAllowlist: ['targetSkillName', 'patternIds', 'lifecycleIds'],
  /**
   * `core` bundle — read skill files, access DB for evidence, format diffs.
   * Reasoning-heavy; no file writes beyond output JSON.
   */
  toolBundles: ['core'],
  /**
   * Sonnet 4.6 for routine pattern analysis; Opus 4.7 escalation for
   * safety-sensitive diff generation. Config pins runtime model; escalation
   * tier set by orchestrator (supervisor can override).
   */
  modelPin: 'sonnet',
  /**
   * `freshContext: false` — the orchestrating workflow supplies the evidence;
   * no upstream reasoning leaked.
   */
  freshContext: false,
  role: 'developer',
};

export default config;
