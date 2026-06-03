import type { AgentEventDto } from '@/lib/types';
import { formatCost, formatTokens } from '@/lib/utils';
import {
  AlertTriangle,
  ArrowRight,
  ClipboardCheck,
  Cpu,
  FileStack,
  GitBranch,
  Info,
  Network,
  Route,
  Target,
  User,
} from 'lucide-react';
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

type ToolIntensityAnomalyPayload = {
  runId?: string;
  skill?: string;
  readCount?: number;
  p95ReadCount?: number;
  thresholdReadCount?: number;
  bytesRead?: number;
  redundantReads?: number;
};

type ToolViolationPayload = {
  role?: string;
  runId?: string;
  disallowedKey?: string;
  leakedKey?: string;
  leak?: string;
  source?: string;
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

type InvestigationSeedBuiltPayload = {
  candidateFileCount?: number;
  candidateSymbolCount?: number;
  recentlyChangedCount?: number;
  priorInvestigationCount?: number;
  builtMs?: number;
};

type BugEnhanceLazyPayload = {
  hadExistingSeed?: boolean;
  producedSeed?: boolean;
  candidateFileCount?: number;
  candidateComponentCount?: number;
  candidateRouteCount?: number;
  ranMs?: number;
};

type RedundantReadPayload = {
  path?: string;
  count?: number;
  guidance?: string;
};

type CompactOperationalPayload = Record<string, unknown>;

type RouteBudgetCaps = {
  maxUsd?: number;
  maxScouts?: number;
  allowWave2?: boolean;
  reviewerSlots?: number;
};

type InvestigationDigestAppliedPayload = {
  wave?: string;
  scoutCount?: number;
  rawBytes?: number;
  digestBytes?: number;
  bytesSaved?: number;
};

type RelatedSurfacePayload = {
  skill?: string;
  keyFileCount?: number;
  packageRootCount?: number;
  existingTestCount?: number;
  testCandidateCount?: number;
  checkedAbsentCount?: number;
  evidenceSpecPath?: string | null;
};

type DiscoveryBudgetPayload = {
  skill?: string;
  checkedAbsentCount?: number;
  runId?: string;
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

type AcceptanceContractPayload = {
  criteriaCount?: number;
  issueBodyPatchRecommended?: boolean;
  contract?: {
    source?: string;
    criteria?: Array<{
      id?: string;
      statement?: string;
      executableChecks?: Array<{ id?: string; command?: string }>;
    }>;
  };
};

type DogfoodSeedAppliedPayload = {
  seedId?: string;
  baseBranch?: string;
  seedCommit?: string;
  truthSignal?:
    | string
    | boolean
    | number
    | {
        testFile?: string;
        testName?: string;
      };
};

function formatShortId(value: string | undefined): string | null {
  if (value == null || value.length === 0) return null;
  return value.length <= 12 ? value : value.slice(0, 8);
}

function formatByteCount(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function payloadRecord(payload: unknown): CompactOperationalPayload | null {
  if (payload == null) return null;
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      return parsed != null && typeof parsed === 'object'
        ? (parsed as CompactOperationalPayload)
        : { message: payload };
    } catch {
      return { message: payload };
    }
  }
  return typeof payload === 'object' ? (payload as CompactOperationalPayload) : { value: payload };
}

function payloadString(payload: CompactOperationalPayload | null, key: string): string | null {
  const value = payload?.[key];
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function payloadNumber(payload: CompactOperationalPayload | null, key: string): number | null {
  const value = payload?.[key];
  return typeof value === 'number' ? value : null;
}

function payloadRecordValue(
  payload: CompactOperationalPayload | null,
  key: string,
): CompactOperationalPayload | null {
  const value = payload?.[key];
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as CompactOperationalPayload)
    : null;
}

function payloadStringArray(payload: CompactOperationalPayload | null, key: string): string[] {
  const value = payload?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

function formatBudgetCaps(value: unknown): string | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const caps = value as RouteBudgetCaps;
  const parts: string[] = [];
  if (typeof caps.maxUsd === 'number') parts.push(`$${caps.maxUsd.toFixed(2)} cap`);
  if (typeof caps.maxScouts === 'number') parts.push(`${caps.maxScouts} scouts`);
  if (typeof caps.reviewerSlots === 'number') parts.push(`${caps.reviewerSlots} reviewer`);
  if (typeof caps.allowWave2 === 'boolean')
    parts.push(caps.allowWave2 ? 'wave 2 allowed' : 'no wave 2');
  return parts.length > 0 ? parts.join(' · ') : null;
}

function formatRouteStages(stages: string[]): string | null {
  if (stages.length === 0) return null;
  return `stages ${stages.join(' → ')}`;
}

function formatTruthSignal(value: DogfoodSeedAppliedPayload['truthSignal']): string | null {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  const parts = [value.testName, value.testFile].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  return parts.length > 0 ? parts.join(' · ') : null;
}

function factoryResourceFromStderr(stderr: string | null): string | null {
  return stderr?.match(/factory:\/\/[^\s)]+/)?.[0] ?? null;
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
  const p = event.payload as {
    from?: string;
    to?: string;
    by?: string;
    interventionId?: string;
    causedByInterventionId?: string;
  } | null;
  const interventionId = p?.interventionId ?? p?.causedByInterventionId;
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
      {interventionId != null && (
        <div className="mt-1 text-[11.5px] text-fg-3">
          Caused by intervention <span className="font-mono">{interventionId.slice(0, 8)}</span>
        </div>
      )}
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

export function DogfoodSeedAppliedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as DogfoodSeedAppliedPayload | null;
  const shortSeedCommit = formatShortId(p?.seedCommit);
  const truthSignal = formatTruthSignal(p?.truthSignal);

  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2 mb-1 text-[11px] text-fg-3">
        <GitBranch size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">Dogfood seed applied</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-fg-2">
        {p?.seedId != null && <span className="font-mono">{p.seedId}</span>}
        {p?.baseBranch != null && <span>{p.baseBranch}</span>}
        {shortSeedCommit != null && <span className="font-mono">{shortSeedCommit}</span>}
        {truthSignal != null && <span>truth {truthSignal}</span>}
      </div>
    </li>
  );
}

export function AcceptanceContractAuthoredEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as AcceptanceContractPayload | null;
  const criteria = p?.contract?.criteria ?? [];
  const count = p?.criteriaCount ?? criteria.length;
  const source = p?.contract?.source ?? 'normalized';
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-[color:var(--accent)]/25 bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-2 text-[11px] text-fg-3">
        <ClipboardCheck size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">Acceptance contract authored</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="text-[12.5px] text-fg-2">
        {count} acceptance criteria from {source}
        {p?.issueBodyPatchRecommended ? (
          <span className="text-fg-4"> · issue body patch recommended</span>
        ) : null}
      </div>
      {criteria.length > 0 && (
        <ol className="mt-2 flex flex-col gap-1.5">
          {criteria.slice(0, 4).map((criterion, index) => (
            <li
              key={criterion.id ?? index}
              className="grid grid-cols-[3rem_1fr] gap-2 text-[11.5px] text-fg-3"
            >
              <span className="font-mono">{criterion.id ?? `AC-${index + 1}`}</span>
              <span className="min-w-0">
                {criterion.statement}
                {(criterion.executableChecks?.length ?? 0) > 0 ? (
                  <span className="text-fg-4"> · {criterion.executableChecks?.length} checks</span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      )}
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

export function ToolIntensityAnomalyEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as ToolIntensityAnomalyPayload | null;
  const shortRunId = formatShortId(p?.runId ?? event.runId ?? undefined);
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-warning bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2 mb-2 text-[11px] text-fg-3">
        <AlertTriangle size={13} className="shrink-0 text-amber-400" />
        <span className="font-mono uppercase tracking-wider">Tool intensity anomaly</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-fg-2">
        {p?.skill != null && <span>{p.skill}</span>}
        {typeof p?.readCount === 'number' && <span>{p.readCount} reads</span>}
        {typeof p?.p95ReadCount === 'number' && <span>p95 {p.p95ReadCount} reads</span>}
        {typeof p?.thresholdReadCount === 'number' && (
          <span className="text-amber-300">threshold {p.thresholdReadCount} reads</span>
        )}
        {typeof p?.bytesRead === 'number' && <span>{formatByteCount(p.bytesRead)} read</span>}
        {typeof p?.redundantReads === 'number' && p.redundantReads > 0 && (
          <span>{p.redundantReads} redundant reads</span>
        )}
      </div>
      {shortRunId != null && (
        <div className="mt-1 text-[11px] font-mono text-fg-4">run {shortRunId}</div>
      )}
    </li>
  );
}

export function ToolViolationEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as ToolViolationPayload | null;
  const key = p?.disallowedKey ?? p?.leakedKey ?? null;
  const shortRunId = formatShortId(p?.runId ?? event.runId ?? undefined);
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-warning bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2 mb-1 text-[11px] text-fg-3">
        <AlertTriangle size={13} className="shrink-0 text-amber-400" />
        <span className="font-mono uppercase tracking-wider">Tool violation</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-fg-2">
        {p?.role != null && <span>{p.role}</span>}
        {key != null && <span>blocked key {key}</span>}
        {p?.leak != null && <span>{p.leak} leak</span>}
        {p?.source != null && <span>{p.source}</span>}
      </div>
      {shortRunId != null && (
        <div className="mt-1 text-[11px] font-mono text-fg-4">run {shortRunId}</div>
      )}
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

export function InvestigationSeedBuiltEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as InvestigationSeedBuiltPayload | null;
  const candidateFiles = typeof p?.candidateFileCount === 'number' ? p.candidateFileCount : null;
  const candidateSymbols =
    typeof p?.candidateSymbolCount === 'number' ? p.candidateSymbolCount : null;
  const recentChanges = typeof p?.recentlyChangedCount === 'number' ? p.recentlyChangedCount : null;
  const priorInvestigations =
    typeof p?.priorInvestigationCount === 'number' ? p.priorInvestigationCount : null;
  const builtMs = typeof p?.builtMs === 'number' ? p.builtMs : null;

  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2 mb-1 text-[11px] text-fg-3">
        <FileStack size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">Investigation seed built</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-fg-2">
        {candidateFiles != null && (
          <span>
            {candidateFiles} candidate file{candidateFiles === 1 ? '' : 's'}
          </span>
        )}
        {candidateSymbols != null && (
          <span>
            {candidateSymbols} symbol hint{candidateSymbols === 1 ? '' : 's'}
          </span>
        )}
        {recentChanges != null && (
          <span>
            {recentChanges} recent change{recentChanges === 1 ? '' : 's'}
          </span>
        )}
        {priorInvestigations != null && (
          <span>
            {priorInvestigations} prior investigation{priorInvestigations === 1 ? '' : 's'}
          </span>
        )}
        {builtMs != null && <span>{builtMs} ms</span>}
      </div>
    </li>
  );
}

export function BugEnhanceLazyEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as BugEnhanceLazyPayload | null;
  const candidateFiles = typeof p?.candidateFileCount === 'number' ? p.candidateFileCount : null;
  const candidateComponents =
    typeof p?.candidateComponentCount === 'number' ? p.candidateComponentCount : null;
  const candidateRoutes = typeof p?.candidateRouteCount === 'number' ? p.candidateRouteCount : null;
  const ranMs = typeof p?.ranMs === 'number' ? p.ranMs : null;
  const producedSeed = p?.producedSeed === true;

  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2 mb-1 text-[11px] text-fg-3">
        <FileStack size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">Bug grounding seed</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-fg-2">
        <span>{producedSeed ? 'Produced seed' : 'No seed produced'}</span>
        {p?.hadExistingSeed === false && <span>lazy run</span>}
        {p?.hadExistingSeed === true && <span>existing seed found</span>}
        {candidateFiles != null && (
          <span>
            {candidateFiles} candidate file{candidateFiles === 1 ? '' : 's'}
          </span>
        )}
        {candidateComponents != null && (
          <span>
            {candidateComponents} component{candidateComponents === 1 ? '' : 's'}
          </span>
        )}
        {candidateRoutes != null && (
          <span>
            {candidateRoutes} route{candidateRoutes === 1 ? '' : 's'}
          </span>
        )}
        {ranMs != null && <span>{(ranMs / 1000).toFixed(1)} s</span>}
      </div>
    </li>
  );
}

export function RedundantReadEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as RedundantReadPayload | null;
  const count = typeof p?.count === 'number' ? p.count : null;
  const path = p?.path ?? null;
  const guidance = p?.guidance ?? null;

  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-warning bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2 mb-1 text-[11px] text-fg-3">
        <AlertTriangle size={13} className="shrink-0 text-amber-400" />
        <span className="font-mono uppercase tracking-wider">Redundant file read</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-fg-2">
        {count != null && (
          <span>
            {count} read{count === 1 ? '' : 's'}
          </span>
        )}
        {path != null && <span className="font-mono text-fg-2 break-all">{path}</span>}
      </div>
      {guidance != null && <div className="mt-2 text-[11.5px] text-fg-3">{guidance}</div>}
    </li>
  );
}

function compactOperationalEventDetails(event: AgentEventDto): {
  title: string;
  tone: 'default' | 'warning' | 'danger' | 'success';
  icon: 'info' | 'warning';
  facts: string[];
  detail: string | null;
} {
  const p = payloadRecord(event.payload);
  const facts: string[] = [];
  let detail: string | null = null;
  const title = EVENT_KIND_LABEL[event.kind] ?? event.kind;
  let tone: 'default' | 'warning' | 'danger' | 'success' = 'default';
  let icon: 'info' | 'warning' = 'info';

  const push = (value: string | null) => {
    if (value != null && value.length > 0) facts.push(value);
  };
  const pushNumber = (key: string, label: string) => {
    const value = payloadNumber(p, key);
    if (value != null) facts.push(`${value} ${label}`);
  };

  switch (event.kind) {
    case 'agent.fallback-triggered':
      tone = 'warning';
      icon = 'warning';
      push(payloadString(p, 'skill'));
      push(payloadString(p, 'role'));
      push(payloadString(p, 'modelId'));
      push(payloadString(p, 'fallbackModel'));
      detail = payloadString(p, 'reason') ?? payloadString(p, 'error');
      break;
    case 'agent.repo-override':
      push(payloadString(p, 'repo'));
      break;
    case 'merge.conflict':
      tone = 'warning';
      icon = 'warning';
      push(payloadString(p, 'prNumber'));
      detail = 'Merge paused until the conflict is resolved.';
      break;
    case 'merge.conflict-resolved':
      tone = 'success';
      push(payloadString(p, 'prNumber'));
      push(payloadString(p, 'sha'));
      break;
    case 'merge.conflict-unresolvable':
      tone = 'danger';
      icon = 'warning';
      push(payloadString(p, 'prNumber'));
      push(payloadString(p, 'prUrl'));
      detail = payloadString(p, 'error');
      break;
    case 'qa.tier-disagreement':
      tone = 'danger';
      icon = 'warning';
      push(payloadString(p, 'runId') ?? formatShortId(event.runId ?? undefined));
      if (Array.isArray(p?.disagreements)) {
        facts.push(
          `${p.disagreements.length} disagreement${p.disagreements.length === 1 ? '' : 's'}`,
        );
      }
      detail = 'QA output disagreed with deterministic tier verdicts.';
      break;
    case 'project.budget-exceeded': {
      tone = 'warning';
      icon = 'warning';
      const totalTokens = payloadNumber(p, 'totalTokens');
      const limitTokens = payloadNumber(p, 'limitTokens');
      const totalCostUsd = payloadNumber(p, 'totalCostUsd');
      if (totalTokens != null) facts.push(`${formatTokens(totalTokens)} tokens used`);
      if (limitTokens != null) facts.push(`${formatTokens(limitTokens)} token limit`);
      if (totalCostUsd != null) facts.push(`${formatCost(totalCostUsd)} total`);
      break;
    }
    case 'coach.completed':
      tone = 'success';
      push(payloadString(p, 'targetSkillName'));
      push(payloadString(p, 'confidence'));
      pushNumber('candidateId', 'candidate');
      if (payloadString(p, 'hasPatch') != null) {
        facts.push(payloadString(p, 'hasPatch') === 'true' ? 'patch proposed' : 'no patch');
      }
      break;
    case 'coach.dispatch-triggered':
      push(payloadString(p, 'targetSkillName'));
      push(payloadString(p, 'playbookId'));
      pushNumber('patternCount', 'patterns');
      break;
    case 'coach.skipped-forbidden-target':
      tone = 'warning';
      icon = 'warning';
      push(payloadString(p, 'targetSkillName'));
      detail = payloadString(p, 'reason');
      break;
    case 'coach.dispatch-failed':
      tone = 'danger';
      icon = 'warning';
      push(payloadString(p, 'targetSkillName'));
      push(payloadString(p, 'playbookId'));
      detail = payloadString(p, 'error');
      break;
    case 'workflow.smoke-failed':
      tone = 'danger';
      icon = 'warning';
      push(payloadString(p, 'failedCheck'));
      detail = payloadString(p, 'reason');
      break;
    case 'agent.cancelled':
      tone = 'warning';
      icon = 'warning';
      push(payloadString(p, 'runId') ?? formatShortId(event.runId ?? undefined));
      push(payloadString(p, 'reason'));
      if (payloadNumber(p, 'elapsedMs') != null) facts.push(`${payloadNumber(p, 'elapsedMs')} ms`);
      break;
    case 'agent.runtime-advisory': {
      tone = 'warning';
      icon = 'warning';
      push(payloadString(p, 'skill'));
      push(payloadString(p, 'toolName'));
      push(payloadString(p, 'surface'));
      push(
        payloadString(p, 'requestedPath') ?? factoryResourceFromStderr(payloadString(p, 'stderr')),
      );
      push(payloadString(p, 'runId') ?? formatShortId(event.runId ?? undefined));
      detail = 'Runtime surfaced a tool access warning; the agent run may still continue.';
      break;
    }
    case 'spec.wp-issues-created':
      tone = 'success';
      push(payloadString(p, 'pipelineRunId') ?? formatShortId(event.runId ?? undefined));
      pushNumber('count', 'issues');
      break;
    case 'merge-decision.completed':
      tone = payloadString(p, 'passed') === 'true' ? 'success' : 'warning';
      icon = payloadString(p, 'passed') === 'true' ? 'info' : 'warning';
      push(payloadString(p, 'prNumber'));
      push(payloadString(p, 'reason'));
      pushNumber('score', 'score');
      detail = payloadString(p, 'detail');
      break;
    case 'audit.completed':
      tone = payloadString(p, 'autonomyGateFired') === 'true' ? 'warning' : 'success';
      icon = payloadString(p, 'autonomyGateFired') === 'true' ? 'warning' : 'info';
      push(payloadString(p, 'trigger'));
      push(payloadString(p, 'rating'));
      pushNumber('auditScore', 'score');
      pushNumber('recommendationCount', 'recommendations');
      pushNumber('improvementCandidateCount', 'candidates');
      break;
    case 'audit.failed':
      tone = 'danger';
      icon = 'warning';
      push(payloadString(p, 'trigger'));
      push(payloadString(p, 'pipelineRunId'));
      detail = payloadString(p, 'error');
      break;
    case 'audit.autonomy-gate-fired':
      tone = 'warning';
      icon = 'warning';
      push(payloadString(p, 'trigger'));
      pushNumber('auditScore', 'score');
      pushNumber('threshold', 'threshold');
      break;
    case 'agent.investigation-seed-empty':
      tone = 'warning';
      icon = 'warning';
      detail = payloadString(p, 'reason') ?? payloadString(p, 'guidance');
      break;
    case 'state.transition-deferred':
      tone = 'warning';
      icon = 'warning';
      push(payloadString(p, 'from'));
      push(payloadString(p, 'to'));
      push(payloadString(p, 'by'));
      detail = payloadString(p, 'error') ?? payloadString(p, 'reason');
      break;
    case 'agent.bug-enhance-hallucinated':
      tone = 'warning';
      icon = 'warning';
      push(payloadString(p, 'runId') ?? formatShortId(event.runId ?? undefined));
      pushNumber('droppedCount', 'dropped');
      pushNumber('originalCount', 'original');
      detail = 'Candidate files were pruned because they did not exist in the workspace.';
      break;
    case 'agent.bug-enhance-workspace-empty':
      tone = 'warning';
      icon = 'warning';
      push(payloadString(p, 'workspaceDir'));
      push(payloadString(p, 'runId') ?? formatShortId(event.runId ?? undefined));
      detail = 'Workspace was unavailable, so bug grounding paths were not pruned.';
      break;
    case 'agent.run-aborted':
      tone = 'danger';
      icon = 'warning';
      push(payloadString(p, 'reason'));
      pushNumber('redundantReads', 'redundant reads');
      pushNumber('totalReads', 'total reads');
      break;
    case 'workflow.route-selected':
    case 'workflow.route-confirmed': {
      tone = event.kind === 'workflow.route-confirmed' ? 'success' : 'default';
      const tier = payloadString(p, 'tier');
      const source = payloadString(p, 'source');
      if (tier != null) facts.push(tier);
      if (source != null) facts.push(source);
      const budget = formatBudgetCaps(p?.budgetCaps);
      if (budget != null) facts.push(budget);
      const stages = formatRouteStages(payloadStringArray(p, 'selectedStages'));
      if (stages != null) facts.push(stages);
      const evidence = payloadRecordValue(p, 'evidence');
      const reasons = payloadStringArray(evidence, 'reasons');
      detail = reasons.length > 0 ? reasons.join(' · ') : null;
      break;
    }
    case 'workflow.route-escalation-proposed':
      tone = 'warning';
      icon = 'warning';
      push(payloadString(p, 'tier'));
      push(payloadString(p, 'source'));
      push(payloadString(p, 'interventionId'));
      detail = payloadStringArray(p, 'escalationTriggers').join(' · ') || null;
      break;
    case 'workflow.route-cap-applied':
      tone = 'warning';
      icon = 'warning';
      push(payloadString(p, 'requiredTier'));
      push(payloadString(p, 'effectiveTier'));
      push(payloadString(p, 'cappedBy'));
      detail = payloadString(p, 'reason');
      break;
  }

  if (facts.length === 0) {
    push(payloadString(p, 'runId') ?? formatShortId(event.runId ?? undefined));
    push(payloadString(p, 'pipelineRunId'));
    push(payloadString(p, 'message'));
  }

  return { title, tone, icon, facts, detail };
}

export function CompactOperationalEvent({ event }: { event: AgentEventDto }) {
  const details = compactOperationalEventDetails(event);
  const borderClass =
    details.tone === 'danger'
      ? 'border-danger'
      : details.tone === 'warning'
        ? 'border-warning'
        : details.tone === 'success'
          ? 'border-success'
          : 'border-line';
  const Icon = details.icon === 'warning' ? AlertTriangle : Info;
  return (
    <li
      data-event-kind={event.kind}
      className={`rounded-md border ${borderClass} bg-bg-elev/60 px-4 py-3`}
    >
      <div className="flex flex-wrap items-center gap-2 mb-1 text-[11px] text-fg-3">
        <Icon
          size={13}
          className={`shrink-0 ${details.icon === 'warning' ? 'text-amber-400' : ''}`}
        />
        <span className="font-mono uppercase tracking-wider">{details.title}</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {details.facts.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-fg-2">
          {details.facts.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
        </div>
      )}
      {details.detail != null && (
        <div className="mt-2 text-[11.5px] text-fg-3">{details.detail}</div>
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

export function InvestigationDigestAppliedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as InvestigationDigestAppliedPayload | null;
  const scoutCount = typeof p?.scoutCount === 'number' ? p.scoutCount : null;
  const rawBytes = typeof p?.rawBytes === 'number' ? p.rawBytes : null;
  const digestBytes = typeof p?.digestBytes === 'number' ? p.digestBytes : null;
  const bytesSaved = typeof p?.bytesSaved === 'number' ? p.bytesSaved : null;
  const savedPercent =
    rawBytes != null && rawBytes > 0 && bytesSaved != null
      ? Math.round((bytesSaved / rawBytes) * 100)
      : null;

  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2 mb-1 text-[11px] text-fg-3">
        <Network size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">Investigation digest applied</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-fg-2">
        {p?.wave != null && <span className="font-mono">{p.wave}</span>}
        {scoutCount != null && (
          <span>
            {scoutCount} scout{scoutCount === 1 ? '' : 's'}
          </span>
        )}
        {rawBytes != null && digestBytes != null && (
          <span>
            {formatByteCount(rawBytes)} raw → {formatByteCount(digestBytes)} digest
          </span>
        )}
        {bytesSaved != null && (
          <span>
            {formatByteCount(bytesSaved)} saved
            {savedPercent != null ? ` (${savedPercent}%)` : ''}
          </span>
        )}
      </div>
    </li>
  );
}

export function RelatedSurfaceManifestEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as RelatedSurfacePayload | null;
  const evidenceSpecPath = p?.evidenceSpecPath ?? null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2 mb-1 text-[11px] text-fg-3">
        <Route size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">Related surface manifest</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-fg-2">
        <span>{p?.skill ?? 'agent'}</span>
        {typeof p?.keyFileCount === 'number' && (
          <span>
            {p.keyFileCount} key file{p.keyFileCount === 1 ? '' : 's'}
          </span>
        )}
        {typeof p?.existingTestCount === 'number' && (
          <span>
            {p.existingTestCount} existing test{p.existingTestCount === 1 ? '' : 's'}
          </span>
        )}
        {typeof p?.testCandidateCount === 'number' && (
          <span>
            {p.testCandidateCount} candidate{p.testCandidateCount === 1 ? '' : 's'}
          </span>
        )}
        {typeof p?.checkedAbsentCount === 'number' && (
          <span>{p.checkedAbsentCount} absent checked</span>
        )}
        {typeof p?.packageRootCount === 'number' && (
          <span>
            {p.packageRootCount} package root{p.packageRootCount === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {evidenceSpecPath != null && evidenceSpecPath.length > 0 && (
        <div className="mt-2 text-[11.5px] text-fg-3">
          Evidence spec: <span className="font-mono text-fg-2">{evidenceSpecPath}</span>
        </div>
      )}
    </li>
  );
}

export function DiscoveryBudgetExceededEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as DiscoveryBudgetPayload | null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-warning bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2 mb-1 text-[11px] text-fg-3">
        <AlertTriangle size={13} className="shrink-0 text-amber-400" />
        <span className="font-mono uppercase tracking-wider">Discovery budget exceeded</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="text-[12.5px] text-fg-2">
        {p?.skill ?? 'agent'} repeated discovery for manifest-resolved paths
        {typeof p?.checkedAbsentCount === 'number' && (
          <>
            <span className="text-fg-4 mx-1">·</span>
            {p.checkedAbsentCount} absent path{p.checkedAbsentCount === 1 ? '' : 's'} were already
            checked
          </>
        )}
      </div>
      {formatShortId(p?.runId ?? undefined) != null && (
        <div className="mt-1 text-[11px] font-mono text-fg-4">
          run {formatShortId(p?.runId ?? undefined)}
        </div>
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
      : event.kind === 'agent.output-repair-failed'
        ? 'Output repair failed'
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
