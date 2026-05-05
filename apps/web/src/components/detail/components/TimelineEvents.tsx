import { resumeIssue } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { AgentEventDto, CostRowDto } from '@/lib/types';
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
  RefreshCw,
  Sparkles,
  Tag,
  Target,
  User,
  Wrench,
  XCircle,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import {
  EVENT_KIND_LABEL,
  type RenderItem,
  formatDuration,
  formatSkillName,
  getPayloadStr,
} from '../lib/timeline';
import { CostBadge } from './CostBadge';

type TimelineContext = {
  slug: string;
  issueId: string;
  latestRunId: string | null;
  runCosts?: Map<string, CostRowDto>;
  expandSignal?: { open: boolean; seq: number };
};

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
  const p = event.payload as { summary?: string; kind?: string; step?: string } | null;
  const summary = p?.summary ?? getPayloadStr(event.payload);
  // #466 — kind is the post-migration field. step was used pre-migration.
  // Fall back to step so legacy events still render a label rather than blank.
  const rawKind =
    typeof p?.kind === 'string' ? p.kind : typeof p?.step === 'string' ? p.step : null;
  const kind = rawKind != null && rawKind.length > 0 ? rawKind : null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line bg-bg-elev/60 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-1 text-[11px] text-fg-3">
        <Sparkles size={13} className="shrink-0" />
        <span className="font-mono uppercase tracking-wider">Decision summary</span>
        {kind != null && (
          <span
            data-testid="decision-kind-chip"
            className="font-mono text-[10px] tracking-wider px-1.5 py-[1px] rounded bg-bg-elev-2 text-[color:var(--accent)]"
          >
            {kind}
          </span>
        )}
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="text-[12.5px] text-fg-2">{summary}</div>
    </li>
  );
}

function AgentDecisionSummaryLiveEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { summary?: string; kind?: string; step?: string } | null;
  const summary = p?.summary ?? getPayloadStr(event.payload);
  // #466 — kind is the post-migration field. step was used pre-migration.
  // Fall back to step so legacy events still render a label rather than blank.
  const rawKind =
    typeof p?.kind === 'string' ? p.kind : typeof p?.step === 'string' ? p.step : null;
  const kind = rawKind != null && rawKind.length > 0 ? rawKind : null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line/50 bg-bg/40 px-4 py-2"
    >
      <details>
        <summary className="flex items-center gap-1 cursor-pointer list-none font-mono text-[11.5px] select-none">
          <ChevronRight size={12} />
          <span className="text-[color:var(--accent)] shrink-0" title="Live decision marker">
            💭
          </span>
          {kind != null && (
            <span
              data-testid="decision-kind-chip-live"
              className="font-mono text-[9.5px] tracking-wider px-1 py-[1px] rounded bg-bg-elev-2 text-[color:var(--accent)] shrink-0"
            >
              {kind}
            </span>
          )}
          <span className="truncate max-w-[460px]">{summary}</span>
        </summary>
        <div className="mt-1.5 text-[11px] text-fg-4 font-mono tnum pl-4">
          {new Date(event.createdAt).toLocaleString()}
        </div>
      </details>
    </li>
  );
}

function AgentLogEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { line?: string; text?: string } | null;
  const line = p?.line ?? p?.text ?? getPayloadStr(event.payload);
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
      <details
        open={open}
        onToggle={(e) => {
          e.stopPropagation();
          setOpen((e.target as HTMLDetailsElement).open);
        }}
      >
        <summary className="flex items-center gap-1 cursor-pointer list-none font-mono text-[11.5px] text-fg-4 select-none">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {events.length} log lines
        </summary>
        <div className="mt-1 flex flex-col gap-0.5">
          {events.map((ev) => {
            const p = ev.payload as { line?: string; text?: string } | null;
            const line = p?.line ?? p?.text ?? getPayloadStr(ev.payload);
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

function normalizeToolInput(
  toolName: string,
  input: unknown,
): { summary: string; body: ReactNode } {
  const rawStr =
    input != null ? (typeof input === 'string' ? input : JSON.stringify(input, null, 2)) : '';
  const fallback = {
    summary: `Tool call: ${toolName}`,
    body: (
      <pre className="mt-1 font-mono text-[11px] whitespace-pre-wrap overflow-x-auto">{rawStr}</pre>
    ),
  };

  if (input == null || typeof input !== 'object' || Array.isArray(input)) return fallback;
  const inp = input as Record<string, unknown>;

  // Bash
  if (typeof inp.command === 'string') {
    const desc = typeof inp.description === 'string' ? inp.description : null;
    const timeoutMs = typeof inp.timeout === 'number' ? inp.timeout : null;
    const cmdPreview = inp.command.length > 60 ? `${inp.command.slice(0, 60)}…` : inp.command;
    return {
      summary: desc != null ? `Bash: ${desc}` : `Bash: ${cmdPreview}`,
      body: (
        <div className="mt-1.5 flex flex-col gap-1">
          {desc != null && <span className="text-[11px] text-fg-3 italic">{desc}</span>}
          <code className="block font-mono text-[10.5px] text-fg-2 whitespace-pre-wrap break-all">
            $ {inp.command}
          </code>
          {timeoutMs != null && (
            <span className="text-[10px] text-fg-4">timeout: {Math.round(timeoutMs / 1000)}s</span>
          )}
        </div>
      ),
    };
  }

  // Edit
  if ('old_string' in inp || 'new_string' in inp) {
    const filePath = typeof inp.file_path === 'string' ? inp.file_path : null;
    const fileName = filePath?.split('/').pop() ?? 'file';
    const replaceAll = inp.replace_all === true;
    const oldStr = typeof inp.old_string === 'string' ? inp.old_string : '';
    const newStr = typeof inp.new_string === 'string' ? inp.new_string : '';
    return {
      summary: `Edit: ${fileName}`,
      body: (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {filePath != null && (
            <span className="text-[10.5px] text-fg-4 font-mono truncate">{filePath}</span>
          )}
          {replaceAll && (
            <span className="text-[10px] text-yellow-400/80 font-mono">replace all</span>
          )}
          {oldStr.length > 0 && (
            <pre className="text-[10px] font-mono text-[color:var(--danger)]/70 bg-red-500/5 rounded px-2 py-1 whitespace-pre-wrap break-all line-clamp-5">
              {oldStr.length > 300 ? `${oldStr.slice(0, 300)}…` : oldStr}
            </pre>
          )}
          {newStr.length > 0 && (
            <pre className="text-[10px] font-mono text-green-400/80 bg-green-500/5 rounded px-2 py-1 whitespace-pre-wrap break-all line-clamp-5">
              {newStr.length > 300 ? `${newStr.slice(0, 300)}…` : newStr}
            </pre>
          )}
        </div>
      ),
    };
  }

  // Write
  if (typeof inp.file_path === 'string' && typeof inp.content === 'string') {
    const filePath = inp.file_path;
    const fileName = filePath.split('/').pop() ?? 'file';
    const content = inp.content;
    return {
      summary: `Write: ${fileName}`,
      body: (
        <div className="mt-1.5 flex flex-col gap-1">
          <span className="text-[10.5px] text-fg-4 font-mono truncate">{filePath}</span>
          <span className="text-[10px] text-fg-4">{content.length.toLocaleString()} chars</span>
          {content.length > 0 && (
            <pre className="mt-0.5 text-[10px] font-mono text-fg-3 whitespace-pre-wrap break-all line-clamp-6">
              {content.length > 400 ? `${content.slice(0, 400)}…` : content}
            </pre>
          )}
        </div>
      ),
    };
  }

  // Read
  if (typeof inp.file_path === 'string') {
    const filePath = inp.file_path;
    const fileName = filePath.split('/').pop() ?? 'file';
    const limit = typeof inp.limit === 'number' ? inp.limit : null;
    const offset = typeof inp.offset === 'number' ? inp.offset : null;
    const lineHint =
      limit != null
        ? offset != null
          ? `lines ${offset + 1}–${offset + limit}`
          : `first ${limit} lines`
        : null;
    return {
      summary: `Read: ${fileName}${lineHint != null ? ` [${lineHint}]` : ''}`,
      body: (
        <div className="mt-1.5 flex flex-col gap-1">
          <span className="text-[10.5px] text-fg-4 font-mono truncate">{filePath}</span>
          {lineHint != null && <span className="text-[10px] text-fg-4">{lineHint}</span>}
        </div>
      ),
    };
  }

  // Grep
  if (typeof inp.pattern === 'string') {
    const pattern = inp.pattern;
    const path = typeof inp.path === 'string' ? inp.path : null;
    const outputMode = typeof inp.output_mode === 'string' ? inp.output_mode : null;
    return {
      summary: `Grep: ${pattern}`,
      body: (
        <div className="mt-1.5 flex flex-col gap-1">
          <span className="text-[10.5px] text-fg-2 font-mono">/{pattern}/</span>
          {path != null && <span className="text-[10px] text-fg-4 font-mono truncate">{path}</span>}
          {outputMode != null && <span className="text-[10px] text-fg-4">{outputMode}</span>}
        </div>
      ),
    };
  }

  // Glob
  if (typeof inp.path === 'string') {
    const path = inp.path;
    return {
      summary: `Glob: ${path}`,
      body: (
        <div className="mt-1.5">
          <span className="text-[10.5px] text-fg-4 font-mono">{path}</span>
        </div>
      ),
    };
  }

  // Skill
  if (typeof inp.skill === 'string') {
    const skill = inp.skill;
    const args = typeof inp.args === 'string' ? inp.args : null;
    return {
      summary: `Skill: ${skill}${args != null ? ` ${args}` : ''}`,
      body: (
        <div className="mt-1.5 flex flex-col gap-1">
          <span className="text-[10.5px] text-fg-2 font-mono">{skill}</span>
          {args != null && <span className="text-[10px] text-fg-3">{args}</span>}
        </div>
      ),
    };
  }

  return fallback;
}

function AgentToolCallEvent({ event }: { event: AgentEventDto }) {
  const [open, setOpen] = useState(false);
  const p = event.payload as { tool_name?: string; tool_input?: unknown } | null;
  const toolName = p?.tool_name ?? 'unknown';
  const { summary, body } = normalizeToolInput(toolName, p?.tool_input ?? null);
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line/50 bg-bg/40 px-4 py-2"
    >
      <details
        open={open}
        onToggle={(e) => {
          e.stopPropagation();
          setOpen((e.target as HTMLDetailsElement).open);
        }}
      >
        <summary className="flex items-center gap-1 cursor-pointer list-none font-mono text-[11.5px] select-none">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Wrench size={11} className="shrink-0" />
          <span>{summary}</span>
        </summary>
        {body}
      </details>
    </li>
  );
}

function AgentVerifyCommandEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as {
    ac?: string;
    command?: string;
    actual?: string;
    passed?: boolean;
  } | null;
  const passed = p?.passed ?? false;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-line/50 bg-bg/40 px-4 py-2"
    >
      <div className="flex items-center gap-2 text-[11px]">
        {passed ? (
          <CheckCircle size={12} style={{ color: 'var(--success)' }} />
        ) : (
          <XCircle size={12} style={{ color: 'var(--danger)' }} />
        )}
        <span className="font-mono uppercase tracking-wider">Verify AC: {p?.ac ?? '—'}</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {p?.command != null && (
        <div className="mt-1 mono text-[10.5px] text-fg-3 truncate">{p.command}</div>
      )}
    </li>
  );
}

function ToolWarningEvent({ event }: { event: AgentEventDto }) {
  const label =
    event.kind === 'tool.stdout-truncated' ? 'Stdout truncated at 4 MB' : 'Process timed out';
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

function GateRejectedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as { source?: string; reason?: string } | null;
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-red-500/20 bg-red-500/5 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-fg-3">
        <XCircle size={13} className="shrink-0 text-red-400" />
        <span className="font-mono uppercase tracking-wider">Rejected</span>
        {p?.source != null && <span className="font-mono text-fg-4">via {p.source}</span>}
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {p?.reason != null && <p className="mt-1.5 text-[12px] text-fg-2">{p.reason}</p>}
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

function QaFailedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as {
    tier?: string;
    findings?: { tier?: string; severity?: string; description?: string }[];
  } | null;
  const tier = p?.tier ?? event.kind.replace('qa.', '').replace('-failed', '');
  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
  const findings = p?.findings ?? [];
  return (
    <li
      data-event-kind={event.kind}
      className="rounded-md border border-red-500/20 bg-red-500/5 px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-2 text-[11px] text-fg-3">
        <XCircle size={13} className="shrink-0 text-[color:var(--danger)]" />
        <span className="font-mono uppercase tracking-wider">QA {tierLabel} failed</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {findings.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {findings.map((f, i) => (
            <li
              key={`${f.severity}-${f.description}-${i}`}
              className="flex items-start gap-2 text-[11.5px]"
            >
              <span
                className={cn(
                  'mt-0.5 shrink-0 font-mono text-[10px] px-1 py-0.5 rounded',
                  f.severity === 'error'
                    ? 'bg-red-500/10 text-[color:var(--danger)]'
                    : f.severity === 'warning'
                      ? 'bg-yellow-500/10 text-yellow-400'
                      : 'bg-fg-5/10 text-fg-3',
                )}
              >
                {f.severity ?? 'info'}
              </span>
              <span className="text-fg-2 leading-relaxed">{f.description}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

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

const STALL_MS = 15 * 60 * 1000; // 15 minutes with no new events → stalled

function RunGroupWrapper({
  runId,
  items,
  idx,
  skill,
  startedAt,
  endedAt,
  lastEventAt,
  personaId,
  context,
}: {
  runId: string;
  items: RenderItem[];
  idx: number;
  skill: string | null;
  startedAt: string | null;
  endedAt: string | null;
  lastEventAt: string | null;
  personaId: string | null;
  context?: TimelineContext;
}) {
  const personaMap = usePersonaMap();
  const [open, setOpen] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [resuming, setResuming] = useState(false);
  const [resumed, setResumed] = useState(false);
  const isLive = endedAt == null;

  const expandSignal = context?.expandSignal;
  useEffect(() => {
    if (expandSignal != null) {
      setOpen(expandSignal.open);
    }
  }, [expandSignal]);

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
  const lastMs = lastEventAt != null ? new Date(lastEventAt).getTime() : null;
  const isStalled = isLive && lastMs != null && now - lastMs > STALL_MS;
  const liveDuration = startMs != null ? formatDuration(now - startMs) : null;
  const completeDuration =
    startMs != null && endMs != null ? formatDuration(endMs - startMs) : null;
  const isFailed = items.some(
    (item) => item.kind === 'event' && item.event.kind === 'agent.run-failed',
  );

  const isOrphaned = items.some(
    (item) =>
      item.kind === 'event' &&
      item.event.kind === 'agent.run-failed' &&
      (item.event.payload as { orphaned?: boolean } | null)?.orphaned === true,
  );

  const isLatestRun = context?.latestRunId === runId;
  const canResume = context != null && (isFailed || isStalled) && isLatestRun && !resumed;

  const costRow = context?.runCosts?.get(runId);
  const runTokens = costRow ? costRow.inputTokens + costRow.outputTokens : 0;

  const handleResume = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (context == null || resuming || resumed) return;
    setResuming(true);
    setResumed(true);
    try {
      await resumeIssue(context.slug, context.issueId);
    } finally {
      setResuming(false);
    }
  };

  const statusBadge = isStalled ? (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
      Stalled
    </span>
  ) : isLive ? (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/10 text-green-400 border border-green-500/20">
      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
      Live
    </span>
  ) : isFailed ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-[color:var(--danger)] border border-red-500/20">
      {isOrphaned ? 'Orphaned' : 'Failed'}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-fg-5/10 text-fg-3 border border-line/50">
      Complete
    </span>
  );

  const metaLine =
    isLive && !isStalled ? (
      liveDuration != null ? (
        <span className="text-fg-5 text-[10.5px]">running for {liveDuration}</span>
      ) : null
    ) : isStalled ? (
      <span className="text-yellow-400/70 text-[10.5px]">
        no activity for {lastMs != null ? formatDuration(now - lastMs) : '?'}
      </span>
    ) : (
      <span className="text-fg-5 text-[10.5px]">
        {completeDuration != null && <>Ran for {completeDuration}</>}
        {startedAt != null && <> &middot; Started {new Date(startedAt).toLocaleTimeString()}</>}
        {endedAt != null && <> &middot; Ended {new Date(endedAt).toLocaleTimeString()}</>}
      </span>
    );

  return (
    <li data-run-id={runId} className="rounded-md border border-line/70 bg-bg/30">
      <details
        open={open}
        onToggle={(e) => {
          e.stopPropagation();
          setOpen((e.target as HTMLDetailsElement).open);
        }}
      >
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
          {costRow && (
            <CostBadge
              tokens={runTokens}
              usd={costRow.costUsd}
              label={costRow.costLabel}
              size="sm"
            />
          )}
          {metaLine}
          {canResume && (
            <button
              type="button"
              onClick={handleResume}
              disabled={resuming}
              className="ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[color:var(--accent)]/10 text-[color:var(--accent)] border border-[color:var(--accent)]/30 hover:bg-[color:var(--accent)]/20 disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={10} className={resuming ? 'animate-spin' : ''} />
              {resuming ? 'Dispatching…' : 'Resume'}
            </button>
          )}
          <span className="ml-auto text-fg-5">{items.length} events</span>
        </summary>
        <ol className="flex flex-col gap-2 px-3 pb-3">
          {isStalled && (
            <li className="rounded-md border border-dashed border-yellow-500/30 bg-yellow-500/5 px-3 py-2 flex items-center gap-2 text-[10.5px] text-yellow-400">
              <span className="font-mono uppercase tracking-wider">
                Agent may have stalled — no events for{' '}
                {lastMs != null ? formatDuration(now - lastMs) : '?'}
              </span>
            </li>
          )}
          {isLive && !isStalled && (
            <li className="rounded-md border border-dashed border-[color:var(--accent)]/30 bg-[color:var(--accent)]/5 px-3 py-2 flex items-center gap-2 text-[10.5px] text-[color:var(--accent)]">
              <Loader2 size={12} className="shrink-0 animate-spin" />
              <span className="font-mono uppercase tracking-wider">Agent running…</span>
            </li>
          )}
          {sorted.map((item, i) => renderTimelineItem(item, idx * 1000 + i, context))}
        </ol>
      </details>
    </li>
  );
}

// ─── switch ───────────────────────────────────────────────────────────────────

export function renderTimelineItem(item: RenderItem, idx: number, context?: TimelineContext) {
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
        lastEventAt={item.lastEventAt}
        personaId={item.personaId}
        context={context}
      />
    );
  }
  const { event } = item;

  switch (event.kind) {
    case 'agent.spawned':
      return <AgentSpawnedEvent key={event.id} event={event} />;
    case 'agent.decision-summary':
      return <AgentDecisionSummaryEvent key={event.id} event={event} />;
    case 'agent.decision-summary-live':
      return <AgentDecisionSummaryLiveEvent key={event.id} event={event} />;
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
    case 'agent.verify-command':
      return <AgentVerifyCommandEvent key={event.id} event={event} />;
    case 'tool.stdout-truncated':
    case 'tool.timeout':
      return <ToolWarningEvent key={event.id} event={event} />;
    case 'qa.completed':
      return <QaCompletedEvent key={event.id} event={event} />;
    case 'qa.structural-failed':
    case 'qa.functional-failed':
    case 'qa.regression-failed':
      return <QaFailedEvent key={event.id} event={event} />;
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
    case 'gate.rejected':
      return <GateRejectedEvent key={event.id} event={event} />;
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
