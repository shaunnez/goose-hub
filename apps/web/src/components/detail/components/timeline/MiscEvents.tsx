import type { AgentEventDto } from '@/lib/types';
import { formatCost, formatTokens } from '@/lib/utils';
import { AlertTriangle, ArrowRight, Cpu, Info, Target, User } from 'lucide-react';
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

function formatShortId(value: string | undefined): string | null {
  if (value == null || value.length === 0) return null;
  return value.length <= 12 ? value : value.slice(0, 8);
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
