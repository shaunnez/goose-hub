import type { AgentEventDto } from '@/lib/types';

export interface KeyFile {
  path: string;
  reason: string;
}

export interface InvestigationPayload {
  investigate: {
    findings: string;
    keyFiles: KeyFile[];
    confidence: 'low' | 'medium' | 'high';
    openQuestions: string[];
    decisionSummaries: Array<{ kind: string; summary: string; evidence?: string }>;
  };
}

export const CONFIDENCE_COLOR: Record<string, string> = {
  high: 'bg-green-500/15 text-green-400',
  medium: 'bg-yellow-500/15 text-yellow-400',
  low: 'bg-red-500/15 text-red-400',
};

export const CONFIDENCE_NUM: Record<string, number> = { high: 0.9, medium: 0.65, low: 0.35 };

export const SEV_VAR: Record<string, string> = {
  high: 'var(--success)',
  medium: 'var(--warning)',
  low: 'var(--danger)',
};

export const SEV_LABEL: Record<string, string> = { high: 'HIGH', medium: 'MED', low: 'LOW' };

// Tool-name buckets used to compute the read/search counters in the investigation header.
export const READ_TOOLS = new Set(['Read', 'FileRead', 'NotebookRead']);
export const SEARCH_TOOLS = new Set([
  'Grep',
  'Glob',
  'WebSearch',
  'WebFetch',
  'work_item_search',
  'rg',
  'ast-grep',
]);

export function extractInvestigationPayload(event: AgentEventDto): InvestigationPayload | null {
  const p = event.payload as Record<string, unknown>;
  if (p == null || typeof p !== 'object') return null;
  if (!('investigate' in p)) return null;
  return p as unknown as InvestigationPayload;
}

export function countToolCalls(events: AgentEventDto[], names: Set<string>): number {
  let n = 0;
  for (const ev of events) {
    if (ev.kind !== 'agent.tool-call') continue;
    const p = ev.payload as { tool_name?: string } | null;
    if (p?.tool_name != null && names.has(p.tool_name)) n++;
  }
  return n;
}
