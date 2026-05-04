import { fetchEvents } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { AgentEventDto } from '@/lib/types';
import {
  AlertCircle,
  ArrowRight,
  Bot,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Circle,
  ExternalLink,
  FileCode,
  GitPullRequest,
  Info,
  Sparkles,
  Tag,
  Target,
  Terminal,
  User,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { groupEvents } from '../lib/timeline';
import type { RenderItem } from '../lib/timeline';
import { timeAgo } from '@/lib/utils';
export type { RenderItem } from '../lib/timeline';

interface TimelineSectionProps {
  projectSlug: string;
  id: string;
  workItemId: string;
}

const STATE_LABEL: Record<string, string> = {
  'state.transitioned': 'State transitioned',
  'milestone.activated': 'Milestone activated',
  'agent.spawned': 'Agent spawned',
  'agent.decision-summary': 'Decision summary',
  'agent.terminated': 'Agent terminated',
  'agent.log': 'Agent log',
  'gate.awaiting-human': 'Gate — awaiting human',
  'system.note': 'Note',
  'manual.action': 'Manual action',
  'agent.run-started': 'Agent run started',
  'agent.run-completed': 'Agent run completed',
  'agent.run-failed': 'Agent run failed',
  'agent.tool-call': 'Tool call',
  'tool.stdout-truncated': 'Stdout truncated',
  'tool.timeout': 'Timeout',
  'agent.fallback-triggered': 'Fallback triggered',
  'agent.triage-complete': 'Triage complete',
  'agent.implement-complete': 'Implement complete',
  'pr.opened': 'PR opened',
  'evidence.no-spec-declared': 'Evidence — no spec declared',
  'evidence.posted': 'Evidence posted',
  'evidence.post-failed': 'Evidence post failed',
};

// ─── payload helpers ──────────────────────────────────────────────────────────

function getPayloadStr(payload: unknown): string {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  return text.length <= 80 ? text : `${text.slice(0, 79)}…`;
}

// ─── individual event renderers ───────────────────────────────────────────────

function AgentSpawnedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { skill?: string } | null;
  const skill = p?.skill ?? '';
  return (
    <li
      key={event.id}
      data-event-kind={event.kind}
      className="rounded-md border border-line border-l-2 border-l-[color:var(--accent)] bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        <Bot size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">Agent started: {skill}</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
    </li>
  );
}

function AgentDecisionSummaryEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { summary?: string } | null;
  const summary = p?.summary ?? getPayloadStr(event.payload);
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1 text-[11px] text-fg-3">
        <Sparkles size={13} className="shrink-0" />
        <span className="font-mono uppercase tracking-wider">Decision summary</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="text-[12.5px] text-fg-2">{summary}</div>
    </li>
  );
}

function AgentLogEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { line?: string } | null;
  const line = p?.line ?? getPayloadStr(event.payload);
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line/50 bg-bg/40 px-4 py-2"
    >
      <span className="font-mono text-[11.5px] text-fg-4">{line}</span>
    </li>
  );
}

function AgentLogGroupEvent({ events }: { events: AgentEventDto[] }) {
  const [open, setOpen] = useState(false);
  return (
    <li data-event-kind="agent.log" className="rounded-md border border-line/50 bg-bg/40 px-4 py-2">
      <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="flex items-center gap-1 cursor-pointer list-none font-mono text-[11.5px] text-fg-4 select-none">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {events.length} log lines
        </summary>
        <div className="mt-1 flex flex-col gap-0.5">
          {events.map((ev) => {
            const p = ev.payload as { line?: string } | null;
            const line = p?.line ?? getPayloadStr(ev.payload);
            return (
              <div key={ev.id} className="font-mono text-[11.5px] text-fg-4">
                {line}
              </div>
            );
          })}
        </div>
      </details>
    </li>
  );
}

function AgentTerminatedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { status?: string; skill?: string } | null;
  const completed = p?.status === 'completed';
  const label = completed ? 'Agent finished' : 'Agent failed';
  const skill = p?.skill ?? '';
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        {completed ? (
          <CheckCircle size={13} className="shrink-0 text-green-400" />
        ) : (
          <XCircle size={13} className="shrink-0 text-[color:var(--danger)]" />
        )}
        <span className="font-mono uppercase tracking-wider">
          {label}
          {skill ? `: ${skill}` : ''}
        </span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
    </li>
  );
}

function ManualActionEvent({ event }: { event: AgentEventDto }) {
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

function MilestoneActivatedEvent({ event }: { event: AgentEventDto }) {
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

function StateTransitionedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { from?: string; to?: string; by?: string } | null;
  const summary =
    p?.from != null && p?.to != null
      ? `${p.from} → ${p.to}${p.by != null ? ` (by ${p.by})` : ''}`
      : getPayloadStr(event.payload);
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
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

function GateAwaitingHumanEvent({ event }: { event: AgentEventDto }) {
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        <AlertCircle size={13} className="shrink-0 text-[color:var(--warning)]" />
        <span className="font-mono uppercase tracking-wider">Gate — awaiting human</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
    </li>
  );
}

function SystemNoteEvent({ event }: { event: AgentEventDto }) {
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

function FallbackEvent({ event }: { event: AgentEventDto }) {
  const payloadStr =
    typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload, null, 2);
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1 text-[11px] text-fg-3">
        <span className="font-mono uppercase tracking-wider">
          {STATE_LABEL[event.kind] ?? event.kind}
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

function AgentRunStatusEvent({ event }: { event: AgentEventDto }) {
  const isCompleted = event.kind === 'agent.run-completed';
  const isFailed = event.kind === 'agent.run-failed';
  const p = event.payload as { runId?: string; error?: string; skill?: string } | null;
  const skillSuffix = p?.skill != null ? `: ${p.skill}` : '';
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px]  ">
        {isCompleted ? (
          <CheckCircle size={13} className="shrink-0 text-green-400" />
        ) : isFailed ? (
          <XCircle size={13} className="shrink-0 text-[color:var(--danger)]" />
        ) : (
          <Circle size={13} className="shrink-0 text-[color:var(--accent)]" />
        )}
        <span className="font-mono uppercase tracking-wider">
          {STATE_LABEL[event.kind] ?? event.kind}
          {skillSuffix}
          {isFailed && p?.error != null ? ` — ${p.error}` : ''}
        </span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
    </li>
  );
}

function AgentToolCallEvent({ event }: { event: AgentEventDto }) {
  const [open, setOpen] = useState(false);
  const p = event.payload as { tool_name?: string; tool_input?: unknown } | null;
  const toolName = p?.tool_name ?? 'unknown';
  const inputStr =
    p?.tool_input != null ? JSON.stringify(p.tool_input, null, 2) : getPayloadStr(event.payload);
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line/50 bg-bg/40 px-4 py-2"
    >
      <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="flex items-center gap-1 cursor-pointer list-none font-mono text-[11.5px] select-none">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Wrench size={11} className="shrink-0" />
          <span>Tool call: {toolName}</span>
        </summary>
        <pre className="mt-1 font-mono text-[11px]  whitespace-pre-wrap overflow-x-auto">
          {inputStr}
        </pre>
      </details>
    </li>
  );
}

function ToolWarningEvent({ event }: { event: AgentEventDto }) {
  const label =
    event.kind === 'tool.stdout-truncated' ? 'Stdout truncated at 4 MB' : 'Process timed out (30s)';
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-yellow-500/30 bg-yellow-500/5 px-4 py-2"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        <AlertCircle size={13} className="shrink-0 text-yellow-400" />
        <span className="font-mono uppercase tracking-wider">{label}</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
    </li>
  );
}

function AgentTriageCompleteEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as {
    triage?: {
      type?: string;
      priority?: string;
      labels?: string[];
      reasoning?: string;
    };
    repoMatch?: {
      candidates?: { repo?: string; confidence?: number; tier?: number }[];
    };
  } | null;
  const t = p?.triage;
  const topRepo = p?.repoMatch?.candidates?.[0];
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-2 text-[11px] text-fg-3">
        <Tag size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">Triage complete</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {t != null && (
        <div className="flex flex-wrap gap-2 mb-2">
          {t.type != null && (
            <span className="px-1.5 py-0.5 rounded text-[10.5px] font-mono bg-bg border border-line text-fg-2">
              {t.type}
            </span>
          )}
          {t.priority != null && (
            <span className="px-1.5 py-0.5 rounded text-[10.5px] font-mono bg-bg border border-line text-fg-2">
              {t.priority}
            </span>
          )}
          {t.labels?.map((l) => (
            <span
              key={l}
              className="px-1.5 py-0.5 rounded text-[10.5px] font-mono bg-bg border border-line text-fg-3"
            >
              {l}
            </span>
          ))}
        </div>
      )}
      {t?.reasoning != null && (
        <p className="text-[11.5px] text-fg-2 mb-2 leading-relaxed">{t.reasoning}</p>
      )}
      {topRepo != null && (
        <div className="text-[11px] text-fg-3 font-mono">
          repo: <span className="text-fg-2">{topRepo.repo}</span>
          {topRepo.confidence != null && (
            <span className="text-fg-4 ml-2">{topRepo.confidence}% confidence</span>
          )}
        </div>
      )}
    </li>
  );
}

function PrOpenedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { prNumber?: number; prUrl?: string; branch?: string } | null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1 text-[11px] text-fg-3">
        <GitPullRequest size={13} className="shrink-0 text-green-400" />
        <span className="font-mono uppercase tracking-wider">PR opened</span>
        {p?.prNumber != null && <span className="font-mono text-fg-2">#{p.prNumber}</span>}
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {p?.prUrl != null && (
        <a
          href={p.prUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-[11.5px] text-[color:var(--accent)] hover:underline"
        >
          <ExternalLink size={11} />
          {p.prUrl}
        </a>
      )}
    </li>
  );
}

function AgentImplementCompleteEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as {
    filesWritten?: number;
    testsWritten?: number;
    confidence?: string;
  } | null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1.5 text-[11px] text-fg-3">
        <FileCode size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">Implement complete</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="flex gap-4 text-[11.5px] text-fg-3">
        {p?.filesWritten != null && (
          <span>
            <span className="text-fg-2 font-medium">{p.filesWritten}</span> files
          </span>
        )}
        {p?.testsWritten != null && (
          <span>
            <span className="text-fg-2 font-medium">{p.testsWritten}</span> tests
          </span>
        )}
        {p?.confidence != null && (
          <span>
            confidence: <span className="text-fg-2 font-medium">{p.confidence}</span>
          </span>
        )}
      </div>
    </li>
  );
}

function EvidenceNoSpecEvent({ event }: { event: AgentEventDto }) {
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line/50 bg-bg/40 px-4 py-2"
    >
      <div className="flex items-center gap-2 text-[11px] ">
        <Info size={13} className="shrink-0" />
        <span className="font-mono uppercase tracking-wider">No evidence spec declared</span>
      </div>
    </li>
  );
}

function EvidencePostedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { commentUrl?: string } | null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1 text-[11px] text-fg-3">
        <CheckCircle size={13} className="shrink-0 text-green-400" />
        <span className="font-mono uppercase tracking-wider">Evidence posted</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {p?.commentUrl != null && (
        <a
          href={p.commentUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-[11.5px] text-[color:var(--accent)] hover:underline"
        >
          <ExternalLink size={11} />
          {p.commentUrl}
        </a>
      )}
    </li>
  );
}

function EvidencePostFailedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { error?: string } | null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-yellow-500/30 bg-yellow-500/5 px-4 py-2"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        <AlertCircle size={13} className="shrink-0 text-yellow-400" />
        <span className="font-mono uppercase tracking-wider">Evidence post failed</span>
        {p?.error != null && <span className="text-fg-3">: {p.error}</span>}
      </div>
    </li>
  );
}

function getEarliestCreatedAt(items: RenderItem[]): string | null {
  let earliest: string | null = null;
  for (const item of items) {
    let iso: string | null = null;
    if (item.kind === 'event') iso = item.event.createdAt;
    else if (item.kind === 'log-group' && item.events.length > 0)
      iso = item.events[item.events.length - 1].createdAt;
    if (iso != null && (earliest == null || iso < earliest)) earliest = iso;
  }
  return earliest;
}

function RunGroupWrapper({
  runId,
  items,
  idx,
}: { runId: string; items: RenderItem[]; idx: number }) {
  const [open, setOpen] = useState(true);
  // Float terminal status events to the top so run outcome is immediately visible.
  const rank = (item: RenderItem) => {
    if (item.kind !== 'event') return 2;
    if (item.event.kind === 'agent.run-completed') return 0;
    if (item.event.kind === 'agent.run-failed') return 1;
    return 2;
  };
  const sorted = [...items].sort((a, b) => rank(a) - rank(b));
  const startedAt = getEarliestCreatedAt(items);
  return (
    <li data-run-id={runId} className="rounded-md border border-line/70 bg-bg/30">
      <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="flex items-center gap-1 cursor-pointer list-none px-4 py-2 font-mono text-[11px]  select-none">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span>Run {runId}</span>
          {startedAt != null && (
            <>
              <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
              <span className="text-fg-5">{timeAgo(startedAt)}</span>
            </>
          )}
          <span className="ml-auto text-fg-5">{items.length} events</span>
        </summary>
        <ol className="flex flex-col gap-2 px-3 pb-3">
          {sorted.map((item, i) => renderItem(item, idx * 1000 + i))}
        </ol>
      </details>
    </li>
  );
}

function renderItem(item: RenderItem, idx: number) {
  if (item.kind === 'log-group') {
    return <AgentLogGroupEvent key={`log-group-${idx}`} events={item.events} />;
  }
  if (item.kind === 'run-group') {
    return (
      <RunGroupWrapper
        key={`run-group-${item.runId}`}
        runId={item.runId}
        items={item.items}
        idx={idx}
      />
    );
  }
  const { event } = item;
  switch (event.kind) {
    case 'agent.spawned':
      return <AgentSpawnedEvent key={event.id} event={event} />;
    case 'agent.decision-summary':
      return <AgentDecisionSummaryEvent key={event.id} event={event} />;
    case 'agent.log':
      return <AgentLogEvent key={event.id} event={event} />;
    case 'agent.terminated':
      return <AgentTerminatedEvent key={event.id} event={event} />;
    case 'manual.action':
      return <ManualActionEvent key={event.id} event={event} />;
    case 'milestone.activated':
      return <MilestoneActivatedEvent key={event.id} event={event} />;
    case 'state.transitioned':
      return <StateTransitionedEvent key={event.id} event={event} />;
    case 'gate.awaiting-human':
      return <GateAwaitingHumanEvent key={event.id} event={event} />;
    case 'system.note':
      return <SystemNoteEvent key={event.id} event={event} />;
    case 'agent.run-started':
    case 'agent.run-completed':
    case 'agent.run-failed':
      return <AgentRunStatusEvent key={event.id} event={event} />;
    case 'agent.tool-call':
      return <AgentToolCallEvent key={event.id} event={event} />;
    case 'tool.stdout-truncated':
    case 'tool.timeout':
      return <ToolWarningEvent key={event.id} event={event} />;
    case 'agent.triage-complete':
      return <AgentTriageCompleteEvent key={event.id} event={event} />;
    case 'pr.opened':
      return <PrOpenedEvent key={event.id} event={event} />;
    case 'agent.implement-complete':
      return <AgentImplementCompleteEvent key={event.id} event={event} />;
    case 'evidence.no-spec-declared':
      return <EvidenceNoSpecEvent key={event.id} event={event} />;
    case 'evidence.posted':
      return <EvidencePostedEvent key={event.id} event={event} />;
    case 'evidence.post-failed':
      return <EvidencePostFailedEvent key={event.id} event={event} />;
    default:
      return <FallbackEvent key={event.id} event={event} />;
  }
}

// ─── main component ───────────────────────────────────────────────────────────

export function TimelineSection({ projectSlug, id, workItemId }: TimelineSectionProps) {
  const [events, setEvents] = useState<AgentEventDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchEvents(projectSlug, id)
      .then((list) => {
        if (cancelled) return;
        // Server returns ascending; render newest first.
        const sorted = [...list].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        setEvents(sorted);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectSlug, id]);

  // Live updates via SSE filtered to this work item.
  useEffect(() => {
    const url = `/events?projectId=${encodeURIComponent(projectSlug)}&workItemId=${encodeURIComponent(workItemId)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;
    const handler = (msg: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(msg.data) as AgentEventDto;
        setEvents((prev) => {
          if (prev.find((e) => e.id === parsed.id) != null) return prev;
          return [parsed, ...prev];
        });
      } catch {
        // ignore
      }
    };
    // Default 'message' fires for events without an `event:` field; named
    // events fire on the type. Subscribe to all known kinds.
    for (const kind of Object.keys(STATE_LABEL)) {
      es.addEventListener(kind, handler as EventListener);
    }
    es.onmessage = handler;
    es.onerror = () => {
      // Connection blip; EventSource auto-reconnects.
    };
    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [projectSlug, workItemId]);

  if (loading) {
    return <div className="px-8 py-6 text-fg-3">Loading timeline…</div>;
  }
  if (error != null) {
    return (
      <div className="px-8 py-6 text-[color:var(--danger)]">Couldn't load timeline: {error}</div>
    );
  }
  if (events.length === 0) {
    return (
      <div data-testid="timeline-section" className="px-8 py-10 text-center text-fg-3 text-[13px]">
        No timeline events yet. Transition the state or wait for the orchestrator (M4+) to populate
        this view.
      </div>
    );
  }

  const items = groupEvents(events);

  return (
    <div data-testid="timeline-section" className="px-8 py-6">
      <ol className="flex flex-col gap-3">{items.map((item, idx) => renderItem(item, idx))}</ol>
    </div>
  );
}
