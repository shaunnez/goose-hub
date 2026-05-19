import type { AgentEventDto } from '@/lib/types';
import { formatCost, formatTokens } from '@/lib/utils';
import { AlertTriangle, ArrowRight, Cpu, FileStack, Info, Target, User } from 'lucide-react';
import { EVENT_KIND_LABEL, getPayloadStr } from '../../lib/timeline';

type BudgetExceededPayload = {
  runId?: string;
  skill?: string;
  modelId?: string;
  costUsd?: number;
  budgetUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  overByUsd?: number;
};

type InvestigationContextInjectedPayload = {
  skill?: string;
  wpId?: string;
  investigationRunId?: string | null;
  keyFiles?: string[];
  keyFileCount?: number;
  findingsChars?: number;
  openQuestionCount?: number;
};

type WrongSurfaceGuardPayload = {
  skill?: string;
  reason?: string;
  expectedKeyFiles?: string[];
  touchedPaths?: string[];
  investigationRunId?: string | null;
};

type CompactPathList = {
  count?: number;
  paths?: string[];
  truncated?: boolean;
};

type ContractDriftPayload = {
  skill?: string;
  gate?: string;
  reason?: string;
  fields?: Array<{
    field?: string;
    from?: string;
    to?: string;
    rawValue?: string;
    normalizedValue?: string;
    source?: string;
  }>;
  observedChangedFiles?: CompactPathList;
  observedWriteFiles?: CompactPathList;
  modelDeclaredFiles?: CompactPathList;
  mismatches?: {
    observedNotDeclared?: CompactPathList;
    declaredNotObserved?: CompactPathList;
  };
};

type DisclosurePayload = {
  kind?: string;
  skill?: string;
  phase?: string;
  bytesSaved?: number;
  rawBytes?: number;
  contextBytes?: number;
  artifactKeys?: string[];
};

function formatShortId(value: string | undefined): string | null {
  if (value == null || value.length === 0) return null;
  return value.length <= 12 ? value : value.slice(0, 8);
}

function formatByteCount(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function ManualActionEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { action?: string } | null;
  const action = p?.action ?? getPayloadStr(event.payload);
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        <User size={13} className="shrink-0" />
        <span className="font-mono uppercase tracking-wider">Manual: {action}</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
    </li>
  );
}

export function MilestoneActivatedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { milestoneNumber?: number | string } | null;
  const num = p?.milestoneNumber ?? getPayloadStr(event.payload);
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        <Target size={13} className="shrink-0" />
        <span className="font-mono uppercase tracking-wider">Milestone set to {num}</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
    </li>
  );
}

export function StateTransitionedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { from?: string; to?: string; by?: string } | null;
  const summary =
    p?.from != null && p?.to != null
      ? `${p.from} → ${p.to}${p.by != null ? ` (by ${p.by})` : ''}`
      : getPayloadStr(event.payload);
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border bg-bg-elev/60 px-4 py-3 border-black"
    >
      <div className="flex items-center gap-2 mb-1 text-[11px] text-fg-3">
        <ArrowRight size={13} className="shrink-0" />
        <span className="font-mono uppercase tracking-wider">State transitioned</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="text-[12.5px] text-fg-2">{summary}</div>
    </li>
  );
}

export function SystemNoteEvent({ event }: { event: AgentEventDto }) {
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1 text-[11px] text-fg-3">
        <Info size={13} className="shrink-0" />
        <span className="font-mono uppercase tracking-wider">Note</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="text-[12.5px] text-fg-2">{getPayloadStr(event.payload)}</div>
    </li>
  );
}

export function AgentModelSelectedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as {
    skill?: string;
    role?: string;
    selectedTier?: string;
    reason?: string;
  } | null;
  const tier = p?.selectedTier ?? '—';
  const reason = p?.reason ?? '—';
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1 text-[11px] text-fg-3">
        <Cpu size={13} className="shrink-0" />
        <span className="font-mono uppercase tracking-wider">Model selected</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="text-[12.5px] text-fg-2">
        {tier}
        <span className="text-fg-4 mx-1">·</span>
        {reason}
      </div>
    </li>
  );
}

export function AgentBudgetExceededEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as BudgetExceededPayload | null;
  const cost = typeof p?.costUsd === 'number' ? p.costUsd : null;
  const budget = typeof p?.budgetUsd === 'number' ? p.budgetUsd : null;
  const overBy =
    typeof p?.overByUsd === 'number'
      ? p.overByUsd
      : cost != null && budget != null
        ? Math.max(0, cost - budget)
        : null;
  const inputTokens = typeof p?.inputTokens === 'number' ? p.inputTokens : null;
  const outputTokens = typeof p?.outputTokens === 'number' ? p.outputTokens : null;
  const totalTokens =
    inputTokens != null || outputTokens != null ? (inputTokens ?? 0) + (outputTokens ?? 0) : null;
  const shortRunId = formatShortId(p?.runId ?? event.runId ?? undefined);

  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-warning bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2 mb-2 text-[11px] text-fg-3">
        <AlertTriangle size={13} className="shrink-0 text-amber-400" />
        <span className="font-mono uppercase tracking-wider">Agent budget exceeded</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-fg-2">
        {cost != null && <span>Spent {formatCost(cost)}</span>}
        {budget != null && <span>Budget {formatCost(budget)}</span>}
        {overBy != null && <span className="text-amber-300">Over by {formatCost(overBy)}</span>}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-fg-3">
        {totalTokens != null && (
          <span>
            {formatTokens(totalTokens)} tokens
            {inputTokens != null && outputTokens != null
              ? ` (${formatTokens(inputTokens)} in / ${formatTokens(outputTokens)} out)`
              : ''}
          </span>
        )}
        {p?.modelId != null && <span className="font-mono text-fg-2">{p.modelId}</span>}
        {p?.skill != null && <span>{p.skill}</span>}
        {shortRunId != null && <span className="font-mono text-fg-4">run {shortRunId}</span>}
      </div>
    </li>
  );
}

export function AgentDisclosureEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as DisclosurePayload | null;
  const artifactKeys = p?.artifactKeys ?? [];
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-info bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2 mb-1 text-[11px] text-fg-3">
        <FileStack size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">Input summarized</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-fg-2">
        {p?.kind != null && <span className="font-mono">{p.kind}</span>}
        {p?.skill != null && <span>{p.skill}</span>}
        {p?.phase != null && <span>{p.phase}</span>}
        {typeof p?.bytesSaved === 'number' && <span>{formatByteCount(p.bytesSaved)} saved</span>}
      </div>
      {artifactKeys.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {artifactKeys.slice(0, 4).map((key) => (
            <span key={key} className="font-mono text-[11px] text-fg-3">
              {key}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

export function InvestigationContextInjectedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as InvestigationContextInjectedPayload | null;
  const keyFileCount =
    typeof p?.keyFileCount === 'number' ? p.keyFileCount : (p?.keyFiles?.length ?? 0);
  const shortRunId = formatShortId(p?.investigationRunId ?? undefined);
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2 mb-1 text-[11px] text-fg-3">
        <Info size={13} className="shrink-0" />
        <span className="font-mono uppercase tracking-wider">Investigation context injected</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="text-[12.5px] text-fg-2">
        {p?.skill ?? 'agent'}
        {p?.wpId != null && (
          <>
            <span className="text-fg-4 mx-1">·</span>
            {p.wpId}
          </>
        )}
        <span className="text-fg-4 mx-1">·</span>
        {keyFileCount} key file{keyFileCount === 1 ? '' : 's'}
        {typeof p?.openQuestionCount === 'number' && (
          <>
            <span className="text-fg-4 mx-1">·</span>
            {p.openQuestionCount} open question{p.openQuestionCount === 1 ? '' : 's'}
          </>
        )}
      </div>
      {p?.keyFiles != null && p.keyFiles.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {p.keyFiles.slice(0, 4).map((path) => (
            <span key={path} className="font-mono text-[11px] text-fg-3">
              {path}
            </span>
          ))}
        </div>
      )}
      {shortRunId != null && (
        <div className="mt-1 text-[11px] font-mono text-fg-4">investigation {shortRunId}</div>
      )}
    </li>
  );
}

export function WrongSurfaceGuardEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as WrongSurfaceGuardPayload | null;
  const expected = p?.expectedKeyFiles ?? [];
  const touched = p?.touchedPaths ?? [];
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-warning bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2 mb-1 text-[11px] text-fg-3">
        <AlertTriangle size={13} className="shrink-0 text-amber-400" />
        <span className="font-mono uppercase tracking-wider">Wrong surface guard</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="text-[12.5px] text-fg-2">
        {p?.skill ?? 'agent'}
        <span className="text-fg-4 mx-1">·</span>
        {p?.reason ?? 'implementation missed investigated files'}
      </div>
      {expected.length > 0 && (
        <div className="mt-2 text-[11.5px] text-fg-3">
          Expected: <span className="font-mono text-fg-2">{expected.slice(0, 3).join(', ')}</span>
        </div>
      )}
      {touched.length > 0 && (
        <div className="mt-1 text-[11.5px] text-fg-3">
          Touched: <span className="font-mono text-fg-2">{touched.slice(0, 3).join(', ')}</span>
        </div>
      )}
    </li>
  );
}

function PathList({ label, list }: { label: string; list?: CompactPathList }) {
  const paths = list?.paths ?? [];
  if (paths.length === 0 && list?.count == null) return null;
  return (
    <div className="mt-1 text-[11.5px] text-fg-3">
      {label}: <span className="font-mono text-fg-2">{paths.slice(0, 3).join(', ')}</span>
      {list?.count != null && list.count > paths.length && (
        <span className="text-fg-4"> +{list.count - paths.length} more</span>
      )}
    </div>
  );
}

export function ContractDriftEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as ContractDriftPayload | null;
  const title =
    event.kind === 'agent.output-repaired'
      ? 'Path normalized'
      : event.kind === 'agent.output-fact-mismatch'
        ? 'Operational fact mismatch'
        : event.kind === 'agent.path-normalized'
          ? 'Path normalized'
          : 'Contract gate blocked';
  const fields = p?.fields ?? [];
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-warning bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2 mb-1 text-[11px] text-fg-3">
        <AlertTriangle size={13} className="shrink-0 text-amber-400" />
        <span className="font-mono uppercase tracking-wider">{title}</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="text-[12.5px] text-fg-2">
        {p?.skill ?? 'agent'}
        {p?.gate != null && (
          <>
            <span className="text-fg-4 mx-1">·</span>
            {p.gate}
          </>
        )}
        {p?.reason != null && (
          <>
            <span className="text-fg-4 mx-1">·</span>
            {p.reason}
          </>
        )}
      </div>
      {fields.length > 0 && (
        <div className="mt-2 flex flex-col gap-1 text-[11px] text-fg-3">
          {fields.slice(0, 3).map((field, index) => (
            <div key={`${field.field ?? 'field'}-${index}`}>
              <span className="font-mono text-fg-2">{field.field}</span>
              {(field.rawValue ?? field.from) != null &&
                (field.normalizedValue ?? field.to) != null && (
                  <>
                    {' '}
                    <span className="font-mono">{field.rawValue ?? field.from}</span>
                    <span className="text-fg-4"> → </span>
                    <span className="font-mono">{field.normalizedValue ?? field.to}</span>
                  </>
                )}
            </div>
          ))}
        </div>
      )}
      <PathList label="Git observed changed" list={p?.observedChangedFiles} />
      <PathList label="Tool observed writes" list={p?.observedWriteFiles} />
      <PathList label="Model declared" list={p?.modelDeclaredFiles} />
      <PathList label="Observed not declared" list={p?.mismatches?.observedNotDeclared} />
      <PathList label="Declared not observed" list={p?.mismatches?.declaredNotObserved} />
    </li>
  );
}

export function FallbackEvent({ event }: { event: AgentEventDto }) {
  const payloadStr =
    typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload, null, 2);
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1 text-[11px] text-fg-3">
        <span className="font-mono uppercase tracking-wider">
          {EVENT_KIND_LABEL[event.kind] ?? event.kind}
        </span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <pre className="mt-1 text-[11px] font-mono text-fg-2 whitespace-pre-wrap overflow-x-auto">
        {payloadStr}
      </pre>
    </li>
  );
}
