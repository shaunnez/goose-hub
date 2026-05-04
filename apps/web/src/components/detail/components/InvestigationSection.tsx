import { addComment, fetchComments, fetchEvents, transitionState } from '@/lib/api';
import { renderMarkdownToHtml } from '@/lib/markdown';
import type { AgentEventDto, IssueCommentDto } from '@/lib/types';
import { timeAgo } from '@/lib/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';

interface InvestigationSectionProps {
  projectSlug: string;
  id: string;
  itemType?: string;
  itemState?: string;
}

interface KeyFile {
  path: string;
  reason: string;
}

interface InvestigationPayload {
  investigate: {
    findings: string;
    keyFiles: KeyFile[];
    confidence: 'low' | 'medium' | 'high';
    openQuestions: string[];
    decisionSummaries: Array<{ step: string; summary: string; evidence?: string }>;
  };
}

const CONFIDENCE_COLOR: Record<string, string> = {
  high: 'bg-green-500/15 text-green-400',
  medium: 'bg-yellow-500/15 text-yellow-400',
  low: 'bg-red-500/15 text-red-400',
};

function ConfidenceBadge({ level }: { level: string }) {
  return (
    <span
      data-testid="confidence-badge"
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${CONFIDENCE_COLOR[level] ?? 'bg-gray-500/15 text-gray-400'}`}
    >
      {level} confidence
    </span>
  );
}

function extractPayload(event: AgentEventDto): InvestigationPayload | null {
  const p = event.payload as Record<string, unknown>;
  if (p == null || typeof p !== 'object') return null;
  if (!('investigate' in p)) return null;
  return p as unknown as InvestigationPayload;
}

export function InvestigationSection({ projectSlug, id, itemState }: InvestigationSectionProps) {
  const queryClient = useQueryClient();
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
      <div data-testid="investigation-empty-state" className="px-8 py-6 flex flex-col gap-5">
        {/* Section header */}
        <div>
          <div className="text-[10.5px] uppercase tracking-wider text-fg-4 mb-1">
            03. Investigation
          </div>
          <h2 className="text-[17px] font-semibold text-fg leading-snug">
            Findings &amp; key files
          </h2>
        </div>

        {/* Empty body */}
        <div className="flex flex-col items-center justify-center gap-4 py-14 rounded-lg border border-dashed border-line bg-bg-elev/20 text-center">
          <div className="w-10 h-10 rounded-full bg-bg-elev flex items-center justify-center">
            <Search size={20} className="text-fg-4" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-[13px] font-medium text-fg-3">No investigation yet</p>
            <p
              data-testid="investigation-empty-description"
              className="text-[12px] text-fg-4 max-w-xs leading-snug"
            >
              The investigator agent analyses the issue and identifies key files.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const payload = extractPayload(latest);
  if (payload == null) return null;

  const { investigate } = payload;

  return (
    <div data-testid="investigation-section" className="px-8 py-6 space-y-6">
      {/* Header row: confidence badge */}
      <div className="flex items-center gap-3">
        <h3 className="text-[12px] font-semibold text-fg-3 uppercase tracking-wide">
          Investigation
        </h3>
        <ConfidenceBadge level={investigate.confidence} />
      </div>

      {/* Findings */}
      <div>
        <h4 className="text-[11px] font-medium text-fg-3 mb-2 uppercase tracking-wide">Findings</h4>
        <div
          data-testid="findings-content"
          className="prose prose-sm prose-invert max-w-none text-[13px] text-fg-2 [&_p]:mb-2 [&_ul]:mb-2 [&_li]:ml-4 [&_li]:list-disc [&_code]:font-mono [&_code]:text-[12px]"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by renderMarkdownToHtml
          dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(investigate.findings) }}
        />
      </div>

      {/* Key files */}
      {investigate.keyFiles.length > 0 && (
        <div>
          <h4 className="text-[11px] font-medium text-fg-3 mb-2 uppercase tracking-wide">
            Key Files
          </h4>
          <ul data-testid="key-files-list" className="space-y-2">
            {investigate.keyFiles.map((f) => (
              <li key={f.path} className="text-[12px]">
                <span className="font-mono text-fg bg-bg-hover px-1.5 py-0.5 rounded text-[11px]">
                  {f.path}
                </span>
                {f.reason && <span className="ml-2 text-fg-3">{f.reason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Open questions */}
      {investigate.openQuestions.length > 0 && (
        <div>
          <h4 className="text-[11px] font-medium text-fg-3 mb-2 uppercase tracking-wide">
            Open Questions
          </h4>
          <ul data-testid="open-questions-list" className="space-y-1 list-disc list-inside">
            {investigate.openQuestions.map((q) => (
              <li key={q} className="text-[12px] text-fg-2">
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Human review notes posted via the investigation gate */}
      {humanNotes.length > 0 && (
        <div data-testid="investigation-human-notes">
          <h4 className="text-[11px] font-medium text-fg-3 mb-2 uppercase tracking-wide">
            Human Review Notes
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
