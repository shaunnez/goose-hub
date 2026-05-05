import { addComment, fetchComments, fetchEvents, transitionState } from '@/lib/api';
import { renderMarkdownToHtml } from '@/lib/markdown';
import type { AgentEventDto, IssueCommentDto } from '@/lib/types';
import { getPersonaInitials, getPersonaLabel, usePersonaMap } from '@/lib/usePersonaMap';
import { timeAgo } from '@/lib/utils';
import { useActiveProject } from '@/state/active-project';
import { useQuery, useQueryClient } from '@tanstack/react-query';
// import { Filter, RefreshCw } from 'lucide-react';
import { Search } from 'lucide-react';
import { useState } from 'react';
import {
  CONFIDENCE_NUM,
  READ_TOOLS,
  SEARCH_TOOLS,
  countToolCalls,
  extractInvestigationPayload,
} from '../lib/investigation';
import { ConfidenceBadge } from './ConfidenceBadge';
import { FindingCard } from './FindingCard';
import { PlaywrightCaptureSection } from './PlaywrightCaptureSection';
import { SectionEmptyState } from './SectionEmptyState';
import { StatCard } from './StatCard';

interface InvestigationSectionProps {
  projectSlug: string;
  id: string;
  itemType?: string;
  itemState?: string;
}

export function InvestigationSection({ projectSlug, id, itemState, itemType }: InvestigationSectionProps) {
  const queryClient = useQueryClient();
  const personaMap = usePersonaMap();
  const { projects } = useActiveProject();
  const currentProject = projects.find((p) => p.slug === projectSlug);
  const githubBase =
    currentProject?.source.kind === 'github'
      ? `https://github.com/${currentProject.source.repo}/blob/${currentProject.defaultBranch ?? 'main'}`
      : null;
  const [notes, setNotes] = useState('');
  const [proceeding, setProceeding] = useState(false);
  const [proceedError, setProceedError] = useState<string | null>(null);

  const { data: events = [], isLoading } = useQuery<AgentEventDto[]>({
    queryKey: ['events', projectSlug, id],
    queryFn: () => fetchEvents(projectSlug, id),
  });

  const { data: comments = [] } = useQuery<IssueCommentDto[]>({
    queryKey: ['comments', projectSlug, id],
    queryFn: () => fetchComments(projectSlug, id),
  });

  const humanNotes = comments.filter((c) => c.body.startsWith('Human review notes:'));

  const canProceed =
    itemState === 'factory:investigation-complete' || itemState === 'factory:gate-pending';

  async function handleProceed() {
    if (!canProceed || proceeding) return;
    setProceeding(true);
    setProceedError(null);
    try {
      if (notes.trim()) {
        await addComment(projectSlug, id, `Human review notes:\n\n${notes.trim()}`);
      }
      const result = await transitionState(
        projectSlug,
        id,
        itemState as string,
        'factory:dev-ready',
      );
      if (result.status >= 400) {
        setProceedError((result.data as { error?: string }).error ?? 'Transition failed');
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['issue', projectSlug, id] });
      await queryClient.invalidateQueries({ queryKey: ['comments', projectSlug, id] });
    } catch (err) {
      setProceedError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setProceeding(false);
    }
  }

  if (isLoading) return null;

  const investigationEvents = events.filter((e) => e.kind === 'agent.investigation-complete');
  const latest = investigationEvents.at(-1);

  if (latest == null) {
    return (
      <div className="px-8 py-6">
        <SectionEmptyState
          data-testid="investigation-empty-state"
          icon={Search}
          title="Investigation has not run yet."
          subtitle="Run the investigator agent to populate this tab."
        />
      </div>
    );
  }

  const payload = extractInvestigationPayload(latest);
  if (payload == null) return null;

  const { investigate } = payload;
  const conf = CONFIDENCE_NUM[investigate.confidence] ?? 0.5;
  const personaId = latest.personaId ?? null;
  const initials = getPersonaInitials(personaMap, personaId);
  const personaLabel = getPersonaLabel(personaMap, personaId);

  // Stats sourced from the events stream for this work item.
  const investigationEventIds = new Set(investigationEvents.map((e) => e.runId).filter(Boolean));
  const runScopedEvents =
    investigationEventIds.size > 0
      ? events.filter((e) => e.runId != null && investigationEventIds.has(e.runId))
      : events;
  const reads = countToolCalls(runScopedEvents, READ_TOOLS);
  const searches = countToolCalls(runScopedEvents, SEARCH_TOOLS);

  const findingsCount =
    (investigate.findings.trim().length > 0 ? 1 : 0) + investigate.keyFiles.length;
  const confSub =
    investigate.confidence === 'high'
      ? 'strong evidence'
      : investigate.confidence === 'medium'
        ? 'plausible'
        : 'weak';

  return (
    <div data-testid="investigation-section" className="px-8 py-6 flex flex-col gap-5">
      {/* Section header */}
      <div className="flex items-start gap-4">
        <div className="grow min-w-0">
          <div className="text-[10.5px] uppercase tracking-wider text-fg-4 mb-1">
            03 · Investigation
          </div>
          <h2 className="text-[17px] font-semibold text-fg leading-snug">What was found</h2>
          <div className="flex items-center gap-3 mt-1.5 text-[12px] text-fg-3">
            <span>
              {reads} file read{reads !== 1 ? 's' : ''} · {searches} search
              {searches !== 1 ? 'es' : ''}
            </span>
            <span className="text-fg-5">·</span>
            <ConfidenceBadge level={investigate.confidence} />
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* <button
            type="button"
            disabled
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-line text-[12px] text-fg-3 hover:text-fg hover:bg-bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Filter size={12} />
            Filter
          </button>
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-line text-[12px] text-fg-3 hover:text-fg hover:bg-bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={12} />
            Re-run
          </button> */}
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard
          label="Findings"
          value={String(findingsCount)}
          sub={`${investigate.keyFiles.length} key file${investigate.keyFiles.length !== 1 ? 's' : ''}`}
        />
        <StatCard
          label="Reads"
          value={String(reads)}
          sub={reads === 0 ? 'no read events' : 'tool calls'}
        />
        <StatCard
          label="Searches"
          value={String(searches)}
          sub={searches === 0 ? 'no search events' : 'rg / glob / web'}
        />
        <StatCard label="Conf" value={investigate.confidence} sub={confSub} />
      </div>

      {/* Root-cause finding card */}
      {investigate.findings.trim().length > 0 && (
        <FindingCard
          severity={investigate.confidence}
          title="Root cause hypothesis"
          body={
            <div
              data-testid="findings-content"
              className="prose prose-sm prose-invert max-w-none text-[13px] text-fg-2 [&_p]:mb-2 [&_ul]:mb-2 [&_li]:ml-4 [&_li]:list-disc [&_code]:font-mono [&_code]:text-[12px]"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by renderMarkdownToHtml
              dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(investigate.findings) }}
            />
          }
          conf={conf}
          personaInitials={initials}
          personaName={personaLabel}
        />
      )}

      {/* Key files as long finding cards */}
      {investigate.keyFiles.length > 0 && (
        <div data-testid="key-files-list" className="flex flex-col gap-3">
          {investigate.keyFiles.map((f) => {
            const basename = f.path.split('/').pop() ?? f.path;
            return (
              <FindingCard
                key={f.path}
                severity={investigate.confidence}
                title={basename}
                body={f.reason ? <span>{f.reason}</span> : <span className="text-fg-4">—</span>}
                filePath={f.path}
                viewUrl={githubBase != null ? `${githubBase}/${f.path}` : undefined}
                conf={conf}
                personaInitials={initials}
                personaName={personaLabel}
              />
            );
          })}
        </div>
      )}

      {/* Open questions */}
      {investigate.openQuestions.length > 0 && (
        <div className="rounded-lg border border-line bg-bg-elev px-4 py-4">
          <div className="text-[10.5px] uppercase tracking-wider text-fg-4 mb-2">
            Open questions
          </div>
          <ul data-testid="open-questions-list" className="space-y-1 list-disc list-inside">
            {investigate.openQuestions.map((q) => (
              <li key={q} className="text-[12.5px] text-fg-2">
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Investigation trail */}
      {investigate.decisionSummaries.length > 0 && (
        <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
          <div className="px-4 py-3 border-b border-line bg-bg-elev-2 flex items-baseline gap-2">
            <div className="text-[10.5px] uppercase tracking-wider text-fg-4">
              Investigation trail
            </div>
            <div className="text-[12px] text-fg-3">What was looked at, in order</div>
          </div>
          <ol data-testid="investigation-trail" className="px-4 py-3 flex flex-col gap-2">
            {investigate.decisionSummaries.map((s, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: trail is append-only and indices are stable for a given event payload
                key={i}
                className="flex items-start gap-3 text-[12.5px] py-1"
              >
                <span className="font-mono tnum text-fg-4 w-6 shrink-0">
                  {String(i + 1).padStart(2, '0')}
                </span>
                {initials != null && (
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent-soft text-[9.5px] font-semibold text-[color:var(--accent)] shrink-0">
                    {initials}
                  </span>
                )}
                <span className="font-mono text-fg-3 w-24 shrink-0 truncate" title={s.step}>
                  {s.step}
                </span>
                <span className="flex-1 text-fg-2 leading-relaxed">
                  {s.summary}
                  {s.evidence != null && s.evidence.length > 0 && (
                    <span className="block mt-0.5 text-[11.5px] text-fg-4 font-mono">
                      {s.evidence}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Human review notes posted via the investigation gate */}
      {humanNotes.length > 0 && (
        <div data-testid="investigation-human-notes">
          <h4 className="text-[11px] font-medium text-fg-3 mb-2 uppercase tracking-wide">
            Human review notes
          </h4>
          <div className="space-y-2">
            {humanNotes.map((note) => (
              <div
                key={note.id}
                className="rounded border border-line bg-bg-elev/40 px-3 py-2 text-[12px] text-fg-2"
              >
                <div className="text-[11px] text-fg-4 mb-1">{timeAgo(note.createdAt)}</div>
                <div
                  className="prose prose-sm prose-invert max-w-none text-[12px] [&_p]:mb-1"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by renderMarkdownToHtml
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdownToHtml(
                      note.body.replace(/^Human review notes:\n\n?/, '').trim(),
                    ),
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Playwright captures (bug items only) */}
      {itemType === 'bug' && (
        <PlaywrightCaptureSection projectSlug={projectSlug} id={id} itemType={itemType} />
      )}

      {/* Human proceed gate */}
      {canProceed && (
        <div
          data-testid="investigation-proceed-gate"
          className={`rounded-md border px-4 py-4 space-y-3 ${
            itemState === 'factory:gate-pending'
              ? 'border-yellow-500/30 bg-yellow-500/5'
              : 'border-line bg-bg-elev/40'
          }`}
        >
          <div className="flex items-center gap-2">
            <h4 className="text-[11px] font-medium text-fg-3 uppercase tracking-wide">
              {itemState === 'factory:gate-pending' ? 'Human review required' : 'Ready to proceed'}
            </h4>
            {itemState === 'factory:gate-pending' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 font-medium">
                low confidence
              </span>
            )}
          </div>
          {itemState === 'factory:gate-pending' && (
            <p className="text-[12px] text-fg-3">
              Investigation confidence is low. Review the open questions above before proceeding.
            </p>
          )}
          <textarea
            data-testid="investigation-notes-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes or answers to open questions…"
            rows={3}
            className="w-full rounded border border-line bg-bg px-3 py-2 text-[12px] text-fg placeholder:text-fg-4 focus:outline-none focus:border-[color:var(--accent)] resize-none"
          />
          {proceedError != null && (
            <p className="text-[11px] text-[color:var(--danger)]">{proceedError}</p>
          )}
          <button
            type="button"
            data-testid="investigation-proceed-button"
            onClick={handleProceed}
            disabled={proceeding}
            className="px-3 py-1.5 rounded text-[11px] font-medium bg-[color:var(--accent)]/15 text-[color:var(--accent)] border border-[color:var(--accent)]/30 hover:bg-[color:var(--accent)]/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {proceeding ? 'Proceeding…' : 'Proceed to dev-ready'}
          </button>
        </div>
      )}
    </div>
  );
}
