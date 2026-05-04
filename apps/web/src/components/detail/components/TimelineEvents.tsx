import { cn } from '@/lib/cn';
import type { AgentEventDto } from '@/lib/types';
import { getPersonaLabel, usePersonaMap } from '@/lib/usePersonaMap';
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
  Loader2,
  Sparkles,
  Tag,
  Target,
  User,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  EVENT_KIND_LABEL,
  type RenderItem,
  formatDuration,
  formatSkillName,
  getPayloadStr,
} from '../lib/timeline';

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
          {EVENT_KIND_LABEL[event.kind] ?? event.kind}
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

function AgentInvestigationCompleteEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as {
    investigate?: {
      findings?: string;
      confidence?: string;
      keyFiles?: unknown[];
      openQuestions?: string[];
    };
    playwrightRepro?: { reproduced?: boolean; notes?: string };
  } | null;
  const inv = p?.investigate;
  const confidence = inv?.confidence ?? 'unknown';
  const findingsPreview =
    inv?.findings != null
      ? inv.findings.length > 120
        ? `${inv.findings.slice(0, 119)}…`
        : inv.findings
      : null;
  const keyFileCount = inv?.keyFiles?.length ?? 0;
  const openQuestionCount = inv?.openQuestions?.length ?? 0;
  const repro = p?.playwrightRepro;

  const confidenceColor =
    confidence === 'high'
      ? 'text-green-400'
      : confidence === 'medium'
        ? 'text-yellow-400'
        : confidence === 'low'
          ? 'text-[color:var(--danger)]'
          : 'text-fg-3';

  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-2 text-[11px] text-fg-3">
        <CheckCircle size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">Investigation complete</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className={`font-mono font-medium ${confidenceColor}`}>{confidence} confidence</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {findingsPreview != null && (
        <p className="text-[11.5px] text-fg-2 mb-2 leading-relaxed">{findingsPreview}</p>
      )}
      <div className="flex gap-3 text-[11px] text-fg-3 font-mono">
        {keyFileCount > 0 && (
          <span>
            <span className="text-fg-2">{keyFileCount}</span> key file
            {keyFileCount !== 1 ? 's' : ''}
          </span>
        )}
        {openQuestionCount > 0 && (
          <span className="text-yellow-400">
            {openQuestionCount} open question{openQuestionCount !== 1 ? 's' : ''}
          </span>
        )}
        {repro != null && (
          <span className={repro.reproduced ? 'text-[color:var(--danger)]' : 'text-fg-4'}>
            repro: {repro.reproduced ? 'confirmed' : 'not reproduced'}
          </span>
        )}
      </div>
      {repro?.notes != null && !repro.reproduced && (
        <p className="mt-1.5 text-[11px] text-fg-4 italic">{repro.notes}</p>
      )}
    </li>
  );
}

function ReviewCompletedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { verdict?: string; confidence?: number } | null;
  const verdict = p?.verdict ?? 'unknown';
  const isApproved = verdict === 'approved';
  const confidencePct = p?.confidence != null ? `${Math.round(p.confidence * 100)}%` : null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        {isApproved ? (
          <CheckCircle size={13} className="shrink-0 text-green-400" />
        ) : (
          <XCircle size={13} className="shrink-0 text-[color:var(--danger)]" />
        )}
        <span className="font-mono uppercase tracking-wider">Review</span>
        <span
          className={`font-mono font-medium ${isApproved ? 'text-green-400' : 'text-[color:var(--danger)]'}`}
        >
          {verdict}
        </span>
        {confidencePct != null && (
          <>
            <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
            <span className="font-mono text-fg-3">{confidencePct} confidence</span>
          </>
        )}
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
    </li>
  );
}

function PrMergedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { prNumber?: number; sha?: string } | null;
  const shortSha = p?.sha != null ? p.sha.slice(0, 7) : null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        <GitPullRequest size={13} className="shrink-0 text-purple-400" />
        <span className="font-mono uppercase tracking-wider">PR merged</span>
        {p?.prNumber != null && <span className="font-mono text-fg-2">#{p.prNumber}</span>}
        {shortSha != null && (
          <>
            <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
            <span className="font-mono text-fg-3">{shortSha}</span>
          </>
        )}
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
    </li>
  );
}

function GateApprovedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { source?: string; prNumber?: number } | null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-green-500/20 bg-green-500/5 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        <CheckCircle size={13} className="shrink-0 text-green-400" />
        <span className="font-mono uppercase tracking-wider">Approved</span>
        {p?.prNumber != null && <span className="font-mono text-fg-2">#{p.prNumber}</span>}
        {p?.source != null && <span className="font-mono text-fg-4">via {p.source}</span>}
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
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

type TierResult = {
  passed: boolean;
  findings?: { severity: string; description: string }[];
  command?: string | null;
};

function QaCompletedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as {
    verdict?: string;
    overallScore?: number;
    threshold?: number;
    tierResults?: {
      structural?: TierResult;
      functional?: TierResult;
      regression?: TierResult;
    };
  } | null;

  const verdict = p?.verdict ?? 'unknown';
  const score = p?.overallScore;
  const threshold = p?.threshold ?? 70;
  const tiers = p?.tierResults;

  const verdictColor =
    verdict === 'pass'
      ? 'text-green-400 border-green-500/20 bg-green-500/10'
      : verdict === 'fail'
        ? 'text-[color:var(--danger)] border-red-500/20 bg-red-500/10'
        : 'text-yellow-400 border-yellow-500/20 bg-yellow-500/10';

  const tierRows: { key: 'structural' | 'functional' | 'regression'; label: string }[] = [
    { key: 'structural', label: 'Structural' },
    { key: 'functional', label: 'Functional' },
    { key: 'regression', label: 'Regression (playwright)' },
  ];

  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-2 text-[11px] text-fg-3">
        <CheckCircle size={13} className="shrink-0 text-[color:var(--accent)]" />
        <span className="font-mono uppercase tracking-wider">QA completed</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <span
          className={cn(
            'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border',
            verdictColor,
          )}
        >
          {verdict.toUpperCase()}
        </span>
        {score != null && (
          <span className="text-[11.5px] text-fg-3 font-mono">
            <span className={score >= threshold ? 'text-green-400' : 'text-[color:var(--danger)]'}>
              {score}
            </span>
            <span className="text-fg-4">/{threshold}</span>
          </span>
        )}
      </div>
      {tiers != null && (
        <div className="flex flex-col gap-1">
          {tierRows.map(({ key, label }) => {
            const tier = tiers[key];
            const skipped = tier == null || (tier.command == null && key === 'regression');
            const passed = tier?.passed ?? false;
            return (
              <div key={key} className="flex items-center gap-2 text-[11px]">
                {skipped ? (
                  <Circle size={11} className="shrink-0 text-fg-4" />
                ) : passed ? (
                  <CheckCircle size={11} className="shrink-0 text-green-400" />
                ) : (
                  <XCircle size={11} className="shrink-0 text-[color:var(--danger)]" />
                )}
                <span className="text-fg-3 font-mono">{label}</span>
                {skipped && <span className="text-fg-5 italic">skipped</span>}
                {!skipped && tier?.command != null && (
                  <span className="text-fg-5 truncate max-w-[260px]">{tier.command}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
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

// ─── run group wrapper ────────────────────────────────────────────────────────

function RunGroupWrapper({
  runId,
  items,
  idx,
  skill,
  startedAt,
  endedAt,
  personaId,
}: {
  runId: string;
  items: RenderItem[];
  idx: number;
  skill: string | null;
  startedAt: string | null;
  endedAt: string | null;
  personaId: string | null;
}) {
  const personaMap = usePersonaMap();
  const [open, setOpen] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const isLive = endedAt == null;

  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isLive]);

  const rank = (item: RenderItem) => {
    if (item.kind !== 'event') return 2;
    if (item.event.kind === 'agent.run-completed') return 0;
    if (item.event.kind === 'agent.run-failed') return 1;
    return 2;
  };
  const sorted = [...items].sort((a, b) => rank(a) - rank(b));

  const startMs = startedAt != null ? new Date(startedAt).getTime() : null;
  const endMs = endedAt != null ? new Date(endedAt).getTime() : null;
  const liveDuration = startMs != null ? formatDuration(now - startMs) : null;
  const completeDuration =
    startMs != null && endMs != null ? formatDuration(endMs - startMs) : null;
  const isFailed = items.some(
    (item) => item.kind === 'event' && item.event.kind === 'agent.run-failed',
  );

  const statusBadge = isLive ? (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/10 text-green-400 border border-green-500/20">
      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
      Live
    </span>
  ) : isFailed ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-[color:var(--danger)] border border-red-500/20">
      Failed
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-fg-5/10 text-fg-3 border border-line/50">
      Complete
    </span>
  );

  const metaLine = isLive ? (
    liveDuration != null ? (
      <span className="text-fg-5 text-[10.5px]">running for {liveDuration}</span>
    ) : null
  ) : (
    <span className="text-fg-5 text-[10.5px]">
      {completeDuration != null && <>Ran for {completeDuration}</>}
      {startedAt != null && <> &middot; Started {new Date(startedAt).toLocaleTimeString()}</>}
      {endedAt != null && <> &middot; Ended {new Date(endedAt).toLocaleTimeString()}</>}
    </span>
  );

  return (
    <li data-run-id={runId} className="rounded-md border border-line/70 bg-bg/30">
      <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="flex flex-wrap items-center gap-2 cursor-pointer list-none px-4 py-2 font-mono text-[11px] select-none">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span title={runId} className="cursor-help border-b border-dashed border-fg-5/40">
            {formatSkillName(skill)} Run
          </span>
          {getPersonaLabel(personaMap, personaId) != null && (
            <>
              <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
              <span className="text-[color:var(--accent)] text-[10px]">
                {getPersonaLabel(personaMap, personaId)}
              </span>
            </>
          )}
          <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
          {statusBadge}
          {metaLine}
          <span className="ml-auto text-fg-5">{items.length} events</span>
        </summary>
        <ol className="flex flex-col gap-2 px-3 pb-3">
          {isLive && (
            <li className="rounded-md border border-dashed border-[color:var(--accent)]/30 bg-[color:var(--accent)]/5 px-3 py-2 flex items-center gap-2 text-[10.5px] text-[color:var(--accent)]">
              <Loader2 size={12} className="shrink-0 animate-spin" />
              <span className="font-mono uppercase tracking-wider">Agent running…</span>
            </li>
          )}
          {sorted.map((item, i) => renderTimelineItem(item, idx * 1000 + i))}
        </ol>
      </details>
    </li>
  );
}

// ─── switch ───────────────────────────────────────────────────────────────────

export function renderTimelineItem(item: RenderItem, idx: number) {
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
        skill={item.skill}
        startedAt={item.startedAt}
        endedAt={item.endedAt}
        personaId={item.personaId}
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
    case 'qa.completed':
      return <QaCompletedEvent key={event.id} event={event} />;
    case 'agent.triage-complete':
      return <AgentTriageCompleteEvent key={event.id} event={event} />;
    case 'agent.investigation-complete':
      return <AgentInvestigationCompleteEvent key={event.id} event={event} />;
    case 'pr.opened':
      return <PrOpenedEvent key={event.id} event={event} />;
    case 'review.completed':
      return <ReviewCompletedEvent key={event.id} event={event} />;
    case 'pr.merged':
      return <PrMergedEvent key={event.id} event={event} />;
    case 'gate.approved':
      return <GateApprovedEvent key={event.id} event={event} />;
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
