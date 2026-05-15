import type { AgentEventDto } from '@/lib/types';
import { AlertCircle, CheckCircle, ExternalLink, Info, XCircle } from 'lucide-react';

type PlaywrightRanPayload = {
  runId?: string;
  specPath?: string;
  status?: string;
  exitCode?: number | null;
  screenshots?: string[];
  videos?: string[];
  errors?: string[];
  phase?: string;
};

function shortRunId(runId: string | undefined): string | null {
  return runId == null || runId.length === 0 ? null : `run ${runId.slice(0, 8)}`;
}

function renderPathList(label: string, paths: string[] | undefined) {
  if (paths == null || paths.length === 0) return null;
  return (
    <div className="mt-2 text-[11.5px] text-fg-3">
      {label}: <span className="font-mono text-fg-2 break-all">{paths.slice(0, 3).join(', ')}</span>
      {paths.length > 3 && <span className="text-fg-4"> +{paths.length - 3} more</span>}
    </div>
  );
}

export function EvidenceNoSpecEvent({ event }: { event: AgentEventDto }) {
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

export function EvidencePostedEvent({ event }: { event: AgentEventDto }) {
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

export function EvidencePostFailedEvent({ event }: { event: AgentEventDto }) {
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

export function EvidencePlaywrightRanEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as PlaywrightRanPayload | null;
  const status = p?.status ?? 'unknown';
  const failed = status === 'failed' || (p?.exitCode != null && p.exitCode !== 0);
  const title = `Playwright ${status}`;
  const details = [
    p?.phase != null ? `phase ${p.phase}` : null,
    p?.exitCode != null ? `exit ${p.exitCode}` : null,
    shortRunId(p?.runId),
  ].filter((value): value is string => value != null);

  return (
    <li
      data-event-kind={event.kind}
      className={`rounded-md border bg-bg-elev/60 px-4 py-3 ${
        failed ? 'border-red-500/30 bg-red-500/5' : 'border-green-500/20 bg-green-500/5'
      }`}
    >
      <div className="flex items-center gap-2 mb-1 text-[11px] text-fg-3">
        {failed ? (
          <XCircle size={13} className="shrink-0 text-red-400" />
        ) : (
          <CheckCircle size={13} className="shrink-0 text-green-400" />
        )}
        <span className="font-mono uppercase tracking-wider">{title}</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      <div className="text-[12.5px] text-fg-2">
        <span className="font-mono break-all">{p?.specPath ?? '(unknown spec)'}</span>
      </div>
      {details.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 text-[11.5px] text-fg-3">
          {details.map((detail) => (
            <span key={detail} className="rounded border border-line/60 bg-bg/50 px-1.5 py-0.5">
              {detail}
            </span>
          ))}
        </div>
      )}
      {renderPathList('Screenshots', p?.screenshots)}
      {renderPathList('Videos', p?.videos)}
      {p?.errors != null && p.errors.length > 0 && (
        <div className="mt-2 space-y-1 text-[11.5px] text-red-200">
          {p.errors.slice(0, 3).map((error) => (
            <div key={error} className="font-mono break-words">
              {error}
            </div>
          ))}
          {p.errors.length > 3 && <div className="text-fg-4">+{p.errors.length - 3} more</div>}
        </div>
      )}
    </li>
  );
}
