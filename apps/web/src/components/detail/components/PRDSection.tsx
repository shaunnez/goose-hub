import { approvePRD, fetchComments, rejectPRD } from '@/lib/api';
import { renderMarkdownToHtml } from '@/lib/markdown';
import type { IssueCommentDto } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { useState } from 'react';
import {
  type ParsedPRDView,
  findLatestPRDCommentBody,
  parsePRDComment,
} from '../lib/parse-prd-comment';
import { SectionEmptyState } from './SectionEmptyState';

interface PRDSectionProps {
  projectSlug: string;
  id: string;
  state: string | undefined;
}

const COMPLEXITY_COLORS: Record<string, string> = {
  low: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  medium: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  high: 'bg-red-500/15 text-red-300 border-red-500/30',
};

export function PRDSection({ projectSlug, id, state }: PRDSectionProps) {
  const queryClient = useQueryClient();
  const [advisorOpen, setAdvisorOpen] = useState(true);
  const [openJourney, setOpenJourney] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: comments = [], isLoading } = useQuery<IssueCommentDto[]>({
    queryKey: ['comments', projectSlug, id],
    queryFn: () => fetchComments(projectSlug, id),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['issue', projectSlug, id] });
    void queryClient.invalidateQueries({ queryKey: ['issues', projectSlug] });
    void queryClient.invalidateQueries({ queryKey: ['comments', projectSlug, id] });
    void queryClient.invalidateQueries({ queryKey: ['events', projectSlug, id] });
  };

  const approve = useMutation({
    mutationFn: () => approvePRD(projectSlug, id),
    onSuccess: invalidate,
    onError: (err: unknown) => setErrorMsg(err instanceof Error ? err.message : String(err)),
  });

  const reject = useMutation({
    mutationFn: () => rejectPRD(projectSlug, id),
    onSuccess: invalidate,
    onError: (err: unknown) => setErrorMsg(err instanceof Error ? err.message : String(err)),
  });

  if (isLoading) {
    return (
      <div className="px-8 py-6 text-[12.5px] text-fg-2" data-testid="prd-loading">
        Loading…
      </div>
    );
  }

  // Drafting state — show a friendly waiting message even before any PRD has
  // been posted.
  if (state === 'factory:prd-drafting') {
    const body = findLatestPRDCommentBody(comments);
    if (body == null) {
      return (
        <div className="px-8 py-6">
          <div className="mb-5">
            <div className="text-[10.5px] uppercase tracking-wider text-fg-2 mb-1">05 · PRD</div>
            <h2 className="text-[18px] font-semibold text-fg leading-snug" data-testid="prd-title">
              No PRD yet
            </h2>
          </div>
          <SectionEmptyState
            data-testid="prd-drafting"
            icon={FileText}
            title="Drafting PRD…"
            subtitle="The prd-writer agent is composing the structured PRD. This usually takes a couple of minutes."
          />
        </div>
      );
    }
  }

  const body = findLatestPRDCommentBody(comments);
  if (body == null) {
    return (
      <div className="px-8 py-6">
        <div className="mb-5">
          <div className="text-[10.5px] uppercase tracking-wider text-fg-2 mb-1">05 · PRD</div>
          <h2 className="text-[18px] font-semibold text-fg leading-snug" data-testid="prd-title">
            No PRD yet
          </h2>
        </div>
        <SectionEmptyState
          data-testid="prd-empty-state"
          icon={FileText}
          title="No PRD yet."
          subtitle="A PRD is generated automatically once the griller is satisfied that scope is clear."
        />
      </div>
    );
  }

  const { prd, advisorConcerns } = parsePRDComment(body);

  if (prd == null) {
    return (
      <div className="px-8 py-6">
        <SectionEmptyState
          data-testid="prd-parse-error"
          icon={FileText}
          title="PRD comment couldn't be parsed."
          subtitle="The PRD marker comment was found but its JSON block was malformed."
        />
      </div>
    );
  }

  const showApproveButtons = state === 'factory:prd-review';

  return (
    <div className="px-8 py-6 flex flex-col gap-5" data-testid="prd-section">
      <div>
        <div className="text-[10.5px] uppercase tracking-wider text-fg-2 mb-1">05 · PRD</div>
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-[18px] font-semibold text-fg leading-snug" data-testid="prd-title">
            {prd.title ?? 'Untitled PRD'}
          </h2>
          {prd.estimatedComplexity != null && (
            <span
              data-testid="prd-complexity-badge"
              className={`text-[10.5px] px-1.5 py-0.5 rounded-full border font-mono ${
                COMPLEXITY_COLORS[prd.estimatedComplexity] ?? 'bg-bg-elev border-line text-fg-2'
              }`}
            >
              {prd.estimatedComplexity} complexity
            </span>
          )}
        </div>
      </div>

      {advisorConcerns != null && advisorConcerns.length > 0 && (
        <div
          data-testid="prd-advisor-panel"
          className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3"
        >
          <button
            type="button"
            data-testid="prd-advisor-toggle"
            className="flex items-center gap-2 text-[12.5px] font-semibold text-amber-200"
            onClick={() => setAdvisorOpen((v) => !v)}
          >
            {advisorOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Advisor notes
          </button>
          {advisorOpen && (
            <div
              className="prose-fix mt-2 text-[12.5px] text-fg"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdownToHtml escapes raw input
              dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(advisorConcerns) }}
            />
          )}
        </div>
      )}

      {showApproveButtons && (
        <div
          className="rounded-md border border-line bg-bg-elev px-4 py-3 flex flex-col gap-2"
          data-testid="prd-approval-controls"
        >
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-semibold">PRD review</div>
            <div className="text-[12px] text-fg-3">
              Approve to begin decomposing into vertical slices.
            </div>
          </div>
          {errorMsg != null && (
            <div className="text-[12px] text-red-400" data-testid="prd-error">
              {errorMsg}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="prd-approve-btn"
              disabled={approve.isPending || reject.isPending}
              onClick={() => {
                setErrorMsg(null);
                approve.mutate();
              }}
              className="h-8 rounded-md bg-green-600 px-3 text-[12px] font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {approve.isPending ? 'Approving…' : 'Approve PRD'}
            </button>
            <button
              type="button"
              data-testid="prd-reject-btn"
              disabled={approve.isPending || reject.isPending}
              onClick={() => {
                setErrorMsg(null);
                reject.mutate();
              }}
              className="h-8 rounded-md border border-line px-3 text-[12px] hover:bg-bg-hover"
            >
              {reject.isPending ? 'Returning to grill…' : 'Reject / re-grill'}
            </button>
          </div>
        </div>
      )}

      {prd.problem != null && (
        <Section title="Problem" testid="prd-problem">
          <p className="text-[13px] text-fg leading-relaxed">{prd.problem}</p>
        </Section>
      )}

      {prd.proposedSolution != null && (
        <Section title="Proposed solution" testid="prd-proposed-solution">
          <p className="text-[13px] text-fg leading-relaxed">{prd.proposedSolution}</p>
        </Section>
      )}

      {prd.outOfScope != null && prd.outOfScope.length > 0 && (
        <Section title="Out of scope" testid="prd-out-of-scope">
          <ul className="list-disc pl-5 text-[12.5px] text-fg space-y-1">
            {prd.outOfScope.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Section>
      )}

      {prd.successCriteria != null && prd.successCriteria.length > 0 && (
        <Section title="Success criteria" testid="prd-success-criteria">
          <ul className="list-disc pl-5 text-[12.5px] text-fg space-y-1">
            {prd.successCriteria.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Section>
      )}

      {prd.acceptanceCriteria != null && prd.acceptanceCriteria.length > 0 && (
        <Section title="Acceptance criteria" testid="prd-acceptance-criteria">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="text-left text-fg-2 border-b border-line">
                <th className="py-1.5 pr-3 font-medium w-20">ID</th>
                <th className="py-1.5 pr-3 font-medium">Statement</th>
                <th className="py-1.5 pr-3 font-medium w-28">Journey</th>
              </tr>
            </thead>
            <tbody>
              {prd.acceptanceCriteria.map((ac) => (
                <tr key={ac.id} className="border-b border-line/40 align-top">
                  <td className="py-1.5 pr-3 font-mono text-fg-3">{ac.id}</td>
                  <td className="py-1.5 pr-3 text-fg">{ac.statement}</td>
                  <td className="py-1.5 pr-3 font-mono text-fg-3">
                    {ac.crossCutting === true ? 'cross-cutting' : (ac.journeyId ?? '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {prd.journeys != null && prd.journeys.length > 0 && (
        <Section title="Journeys" testid="prd-journeys">
          <div className="flex flex-col gap-2">
            {prd.journeys.map((j) => {
              const open = openJourney === j.id;
              return (
                <div key={j.id} className="rounded-md border border-line">
                  <button
                    type="button"
                    data-testid={`prd-journey-toggle-${j.id}`}
                    onClick={() => setOpenJourney(open ? null : j.id)}
                    className="w-full text-left px-3 py-2 flex items-center gap-2 text-[12.5px]"
                  >
                    {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <span className="font-mono text-fg-3">{j.id}</span>
                    <span className="text-fg">{j.persona}</span>
                    <span className="text-fg-3">— {j.trigger}</span>
                  </button>
                  {open && (
                    <div className="px-3 pb-3 text-[12px] text-fg-2 flex flex-col gap-2">
                      <ol className="list-decimal pl-5 space-y-1 text-fg">
                        {j.steps.map((s) => (
                          <li key={`${j.id}-${s.userAction}-${s.systemResponse}`}>
                            <span className="text-fg">{s.userAction}</span> →{' '}
                            <span className="text-fg-2">{s.systemResponse}</span>
                          </li>
                        ))}
                      </ol>
                      <div>
                        <span className="text-fg-2">Success: </span>
                        <span className="text-fg">{j.successState}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {prd.functionalSpec?.behaviors != null && prd.functionalSpec.behaviors.length > 0 && (
        <Section title="Functional spec — behaviors" testid="prd-behaviors">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="text-left text-fg-2 border-b border-line">
                <th className="py-1.5 pr-3 font-medium">When</th>
                <th className="py-1.5 pr-3 font-medium">Given</th>
                <th className="py-1.5 pr-3 font-medium">Then</th>
              </tr>
            </thead>
            <tbody>
              {prd.functionalSpec.behaviors.map((b) => (
                <tr
                  key={`${b.when}-${b.given}-${b.then}`}
                  className="border-b border-line/40 align-top"
                >
                  <td className="py-1.5 pr-3 text-fg">{b.when}</td>
                  <td className="py-1.5 pr-3 text-fg-2">{b.given}</td>
                  <td className="py-1.5 pr-3 text-fg">{b.then}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {prd.verticalSlices != null && prd.verticalSlices.length > 0 && (
        <Section title="Vertical slices" testid="prd-vertical-slices">
          <div className="grid gap-2">
            {prd.verticalSlices.map((s) => (
              <div
                key={s.title}
                className="rounded-md border border-line bg-bg-elev/50 px-3 py-2"
                data-testid="prd-slice"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12.5px] font-semibold text-fg">{s.title}</span>
                  <span className="text-[10.5px] font-mono px-1.5 py-0.5 rounded border border-line text-fg-3">
                    {s.estimatedSize}
                  </span>
                  {s.journeyRefs.map((ref) => (
                    <span
                      key={ref}
                      className="text-[10.5px] font-mono text-fg-3 border border-line rounded px-1.5 py-0.5"
                    >
                      {ref}
                    </span>
                  ))}
                </div>
                <div className="text-[12px] text-fg-2 mt-1">{s.goal}</div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  testid,
  children,
}: {
  title: string;
  testid?: string;
  children: React.ReactNode;
}) {
  return (
    <section data-testid={testid} className="flex flex-col gap-2">
      <h3 className="text-[11px] uppercase tracking-wider text-fg-2">{title}</h3>
      {children}
    </section>
  );
}

// Re-exported for tests / typing convenience.
export type { ParsedPRDView };
