import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

/**
 * Wave-2 interface-designer output (M19.01, ADR 0030).
 *
 * Consumes Wave-1 scout reports (via the parent investigator's prompt — the
 * deep agent does not call scouts itself) and emits PASTE-READY artefacts:
 * Zod schemas, function signatures, and DDL statements. No pseudocode; if
 * the designer cannot produce a real signature, it must say so in
 * `decisionSummaries` rather than fabricate.
 */
export const InterfaceArtefactSchema = z.object({
  kind: z.enum(['zod-schema', 'function-signature', 'sql-ddl', 'typescript-interface']),
  /** Where this artefact would land — file path; informational only at Wave 2. */
  targetPath: z.string(),
  /** The paste-ready text. Must be valid syntax for `kind`; no "TODO" or "..." markers. */
  body: z.string().min(1),
  /** One sentence justifying why this shape, citing scout finding ids/files. */
  rationale: z.string().min(1),
});

export const Wave2InterfaceDesignerSchema = z.object({
  artefacts: z.array(InterfaceArtefactSchema),
  /** Open questions the designer could not resolve from Wave-1 reports alone. */
  openQuestions: z.array(z.string()),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type InterfaceArtefact = z.infer<typeof InterfaceArtefactSchema>;
export type Wave2InterfaceDesignerOutput = z.infer<typeof Wave2InterfaceDesignerSchema>;
