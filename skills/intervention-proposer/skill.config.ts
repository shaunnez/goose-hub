import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { InterventionProposerContextSchema, InterventionProposerOutputSchema } from './schema.js';

const config: SkillConfig = {
  contextSchema: InterventionProposerContextSchema,
  outputSchema: InterventionProposerOutputSchema,
  toolBundles: ['read'],
  modelPin: 'sonnet',
  freshContext: true,
  role: 'intervention-proposer',
  contextAllowlist: ['intervention', 'workItem', 'recentEvents', 'legalTargets'],
};

export default config;
export { InterventionProposerContextSchema };
