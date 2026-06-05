/**
 * Cost record types — see core/cost/README.md.
 *
 * `costLabel` is the trust signal for the displayed number:
 * - `'exact'`   → derived from authoritative usage metadata (e.g. direct API
 *                  response with `usage.input_tokens` / `usage.output_tokens`).
 * - `'estimated'` → derived from the Claude CLI's reported totals only, or a
 *                    fallback calculation. UI must qualify these (M9.09).
 *
 * `stage` is the high-level pipeline phase (Triage / Investigate / Dev / QA /
 * Review / Retrospective). `skill` is the actual skill name that ran. Stages
 * group skills for the per-stage bar chart on the dashboard.
 */
export type CostLabel = 'estimated' | 'exact';

export type Stage =
  | 'triage'
  | 'discover'
  | 'investigate'
  | 'dev'
  | 'qa'
  | 'review'
  | 'retrospective'
  | 'chat'
  | 'other';

export interface CostRecord {
  runId: string;
  projectId: string;
  workItemId: string | null;
  stage: Stage;
  skill: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  reasoningOutputTokens: number;
  costUsd: number;
  costLabel: CostLabel;
  personaId: string | null;
}

export interface CostUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  reasoningOutputTokens: number;
  costUsd: number;
  costLabel: CostLabel;
}
