import type { AgentEventDto } from '@/lib/types';
import { Database, Lightbulb } from 'lucide-react';

type SymbolIndexHintSource =
  | 'definition'
  | 'importer'
  | 'nearby-test'
  | 'key-file'
  | 'symbol-impact';

type SymbolIndexHintsUsedPayload = {
  consumerSkill?: string;
  offeredHintCount?: number;
  usedHintCount?: number;
  usedHints?: Array<{
    name?: string;
    path?: string;
    source?: SymbolIndexHintSource;
  }>;
};

type SymbolIndexLookupPayload = {
  consumerSkill?: string;
  identifierCount?: number;
  hintCount?: number;
  rawHintCount?: number;
  consumerHintCounts?: Record<string, number>;
  dbAgeMs?: number;
  stale?: boolean;
};

function formatCount(value: number | undefined): string {
  return (value ?? 0).toLocaleString();
}

function formatDbAge(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return 'unknown';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'less than 1m';
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 1) return `${minutes}m`;
  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainingMinutes}m`;
}

function formatSkillLabel(skill: string | undefined): string {
  if (skill == null || skill.length === 0) return 'Agent';
  return skill
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function SymbolIndexLookupEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as SymbolIndexLookupPayload | null;
  const consumerSkill = p?.consumerSkill;
  const consumerHintCounts = Object.entries(p?.consumerHintCounts ?? {});
  const allConsumerCountsZero =
    consumerHintCounts.length > 0 && consumerHintCounts.every(([, count]) => count === 0);
  const freshnessLabel = p?.stale === true ? 'Stale' : 'Fresh';

  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="mb-1 flex items-center gap-2 text-[11px] text-fg-3">
        <Database size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">Symbol index lookup</span>
        <span aria-hidden className="h-[3px] w-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="text-[12.5px] text-fg-2">
        {formatSkillLabel(consumerSkill)} looked up {formatCount(p?.identifierCount)} identifiers
        and found {formatCount(p?.hintCount)} usable hints
      </div>
      <div className="mt-2 grid gap-2 text-[11.5px] text-fg-3 sm:grid-cols-4">
        <div className="rounded border border-line/70 bg-bg px-2 py-1.5">
          <div className="font-mono uppercase text-fg-4">Identifiers</div>
          <div className="font-mono tnum text-fg-2">{formatCount(p?.identifierCount)}</div>
        </div>
        <div className="rounded border border-line/70 bg-bg px-2 py-1.5">
          <div className="font-mono uppercase text-fg-4">This scout</div>
          <div className="font-mono tnum text-fg-2">{formatCount(p?.hintCount)}</div>
        </div>
        <div className="rounded border border-line/70 bg-bg px-2 py-1.5">
          <div className="font-mono uppercase text-fg-4">Raw hints</div>
          <div className="font-mono tnum text-fg-2">{formatCount(p?.rawHintCount)}</div>
        </div>
        <div className="rounded border border-line/70 bg-bg px-2 py-1.5">
          <div className="font-mono uppercase text-fg-4">Index age</div>
          <div className="font-mono tnum text-fg-2">
            {formatDbAge(p?.dbAgeMs)} · {freshnessLabel}
          </div>
        </div>
      </div>
      {consumerHintCounts.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11.5px]">
          {consumerHintCounts.map(([skill, count]) => (
            <span
              key={skill}
              className="rounded border border-line/70 bg-bg px-2 py-1 font-mono text-fg-3"
            >
              {skill}: <span className="tnum text-fg-2">{formatCount(count)}</span>
            </span>
          ))}
        </div>
      )}
      {allConsumerCountsZero && (
        <div className="mt-2 text-[11.5px] text-fg-4">No scout received symbol hints.</div>
      )}
    </li>
  );
}

export function SymbolIndexHintsUsedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as SymbolIndexHintsUsedPayload | null;
  const consumerSkill = p?.consumerSkill ?? 'agent';
  const usedHintCount = p?.usedHintCount ?? p?.usedHints?.length ?? 0;
  const offeredHintCount = p?.offeredHintCount ?? usedHintCount;
  const usedHints = p?.usedHints ?? [];

  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1 text-[11px] text-fg-3">
        <Lightbulb size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">Symbol hints used</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="text-[12.5px] text-fg-2">
        {consumerSkill} used {usedHintCount} of {offeredHintCount} offered hints
      </div>
      {usedHints.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          {usedHints.map((hint, idx) => (
            <div
              key={`${hint.name ?? 'hint'}-${hint.path ?? idx}-${idx}`}
              className="flex min-w-0 items-baseline gap-2 text-[11.5px]"
            >
              <span className="shrink-0 font-medium text-fg-2">{hint.name ?? 'Symbol'}</span>
              <span className="min-w-0 truncate font-mono text-fg-3">{hint.path ?? 'unknown'}</span>
              <span className="shrink-0 text-fg-4">· {hint.source ?? 'definition'}</span>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
