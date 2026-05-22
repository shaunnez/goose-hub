import type { AgentEventDto } from '@/lib/types';

export interface KeyFile {
  path: string;
  reason: string;
}

/**
 * Decision summary as it appears on the wire. New runs (post-#466) write
 * `kind`; legacy runs (pre-#466) wrote `step`. Renderers should call
 * `decisionLabel(s)` to read either, falling back to the empty string.
 */
export interface DecisionSummaryWire {
  kind?: string;
  step?: string;
  summary: string;
  evidence?: string;
}

export interface InvestigationPayload {
  investigate: {
    findings: string;
    keyFiles?: KeyFile[];
    confidence?: 'low' | 'medium' | 'high';
    openQuestions?: string[];
    decisionSummaries?: DecisionSummaryWire[];
    repro?: {
      status?: string;
    };
  };
}

export interface InvestigationSummary {
  event: AgentEventDto;
  payload: InvestigationPayload['investigate'];
  confidence: 'low' | 'medium' | 'high' | 'unknown';
  keyFileCount: number;
  openQuestionCount: number;
  readCount: number;
  searchCount: number;
  reproStatus: string;
}

/** Returns `kind` (new) or `step` (legacy) for backward compatibility (#466). */
export function decisionLabel(s: DecisionSummaryWire): string {
  return s.kind ?? s.step ?? '';
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

const BASH_READ_COMMAND_RE = /(^|[\s;&|(`])(?:cat|head|tail|less|more|sed|nl)(\s|$)/;
const BASH_SEARCH_COMMAND_RE = /(^|[\s;&|(`])(?:rg|grep|find|fd|ast-grep)(\s|$)/;

export function extractInvestigationPayload(event: AgentEventDto): InvestigationPayload | null {
  const p = event.payload as Record<string, unknown>;
  if (p == null || typeof p !== 'object') return null;
  if (!('investigate' in p)) return null;
  return p as unknown as InvestigationPayload;
}

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function latestInvestigationEvent(events: AgentEventDto[]): AgentEventDto | null {
  return events
    .filter((e) => e.kind === 'agent.investigation-complete')
    .reduce<AgentEventDto | null>((latest, event) => {
      if (latest == null) return event;
      if (event.id !== latest.id) return event.id > latest.id ? event : latest;
      return event.createdAt > latest.createdAt ? event : latest;
    }, null);
}

export function getInvestigationSummary(events: AgentEventDto[]): InvestigationSummary | null {
  const event = latestInvestigationEvent(events);
  if (event == null) return null;
  const payload = extractInvestigationPayload(event)?.investigate;
  if (payload == null) return null;

  return {
    event,
    payload,
    confidence: payload.confidence ?? 'unknown',
    keyFileCount: asArray(payload.keyFiles).length,
    openQuestionCount: asArray(payload.openQuestions).length,
    readCount: countToolCalls(events, READ_TOOLS),
    searchCount: countToolCalls(events, SEARCH_TOOLS),
    reproStatus: payload.repro?.status ?? 'unknown',
  };
}

function isReadBucket(names: Set<string>): boolean {
  return names.has('Read') || names.has('FileRead') || names.has('NotebookRead');
}

function isSearchBucket(names: Set<string>): boolean {
  return names.has('Grep') || names.has('Glob') || names.has('WebSearch') || names.has('rg');
}

function bashCommandFor(
  payload: { tool_name?: string; tool_input?: unknown } | null,
): string | null {
  if (payload?.tool_name !== 'Bash') return null;
  const input = payload.tool_input;
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return null;
  const command = (input as { command?: unknown }).command;
  return typeof command === 'string' ? command : null;
}

export function countToolCalls(events: AgentEventDto[], names: Set<string>): number {
  let n = 0;
  const countBashReads = isReadBucket(names);
  const countBashSearches = isSearchBucket(names);
  for (const ev of events) {
    if (ev.kind !== 'agent.tool-call') continue;
    const p = ev.payload as { tool_name?: string; tool_input?: unknown } | null;
    if (p?.tool_name != null && names.has(p.tool_name)) {
      n++;
      continue;
    }
    const command = bashCommandFor(p);
    if (command == null) continue;
    if (countBashReads && BASH_READ_COMMAND_RE.test(command)) n++;
    if (countBashSearches && BASH_SEARCH_COMMAND_RE.test(command)) n++;
  }
  return n;
}
