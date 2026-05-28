import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';
import { EngineeringSpecSchema } from './schema.js';

/**
 * Engineering Spec authoring skill (M19.02, issue #559).
 *
 * Replaces the prior Playwright e2e spec-author content. The skill name
 * is the one Steve uses; PLAN.md §28 (M19) names this skill explicitly
 * as the author of the Engineering Spec consumed by parallel-builder
 * (M19.03) and convergent-review (M19.04).
 *
 * Context (rendered as XML in the user prompt):
 *
 *   <task>
 *     <workItem>{"title":"...","body":"...","number":123}</workItem>
 *     <issueType>feature|bug</issueType>
 *     <prdContext>{...}</prdContext>?      <!-- canonical compact PRD planning context -->
 *     <prd>...</prd>?                      <!-- legacy compact PRD context string -->
 *     <scoutReports>[json]</scoutReports>?      <!-- M19.01 Wave-1 reports when present -->
 *     <wave2Reports>[json]</wave2Reports>?      <!-- M19.01 Wave-2 reports when present -->
 *     <investigationSynthesis>[json]</investigationSynthesis>?  <!-- investigate synthesis -->
 *     <repairFeedback>...</repairFeedback>?      <!-- one-shot validator feedback on retry -->
 *   </task>
 */
export const SpecAuthorContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number(),
  }),
  /** Drives the strict-vs-advisory AC→Journey rule. Defaults to feature in the validator. */
  issueType: z.enum(['feature', 'bug']).optional(),
  /** PRD body (copied from #313 for type:feature). Optional when type:bug. */
  prd: z.string().optional(),
  /** Canonical compact PRD planning context, derived from the latest PRD read model. */
  prdContext: z
    .object({
      source: z.enum(['event', 'legacy-comment']),
      parentWorkItemId: z.string(),
      prdRunId: z.string().nullable(),
      title: z.string(),
      problem: z.string(),
      proposedSolution: z.string(),
      successCriteria: z.array(z.string()),
      acceptanceCriteria: z.array(z.unknown()),
      journeys: z.array(z.unknown()),
      verticalSlices: z.array(z.unknown()),
      implementationDecisions: z.array(z.unknown()),
      testingDecisions: z.unknown().nullable(),
      artifactRef: z
        .object({
          artifactKey: z.string(),
          kind: z.string(),
          summary: z.string(),
          bytes: z.number(),
          stored: z.literal(true),
        })
        .optional(),
    })
    .optional(),
  /** JSON-stringified Wave-1 scout reports (M19.01). Optional fall-back to manual investigation. */
  scoutReports: z.string().optional(),
  /** JSON-stringified Wave-2 deep-agent reports (M19.01). Optional. */
  wave2Reports: z.string().optional(),
  /** JSON-stringified InvestigateOutput (findings, keyFiles, confidence, openQuestions) from the synthesis step. Primary signal; scout reports are supporting evidence. */
  investigationSynthesis: z.string().optional(),
  /** One-shot validation feedback when the workflow retries a mechanically invalid spec. */
  repairFeedback: z.string().optional(),
  /** Capped list of files+dirs under the spec scopeRoots. Use to ground WP filesOwned. */
  existingFileManifest: z
    .array(z.object({ path: z.string(), kind: z.enum(['file', 'dir']) }))
    .optional()
    .describe('Capped list of files+dirs under the spec scopeRoots. Use to ground WP filesOwned.'),
  /** Feature code-grounding payload from the grounding scouts, when available. */
  featureGrounding: z.unknown().optional(),
});

const config: SkillConfig = {
  contextSchema: SpecAuthorContextSchema,
  outputSchema: EngineeringSpecSchema,
  contextAllowlist: [
    'workItem.title',
    'workItem.body',
    'workItem.number',
    'issueType',
    'prdContext',
    'prd',
    'scoutReports',
    'wave2Reports',
    'investigationSynthesis',
    'repairFeedback',
    'existingFileManifest',
    'featureGrounding',
  ],
  /**
   * Read bundle: spec-author authors a JSON artefact in its terminal
   * output, not files on disk. Persistence to `slices/<n>/spec.json` is
   * orchestrator-side after schema + validator pass.
   */
  toolBundles: ['read'],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'developer',
};

export default config;
