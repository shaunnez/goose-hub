import { approvePRD, declinePRD, fetchEvents, fetchPRD, revisePRD } from '@/lib/api';
import { renderMarkdownToHtml } from '@/lib/markdown';
import type { AgentEventDto, PrdReadModelDto } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, ChevronRight, FileText, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ParsedPRDView } from '../lib/parse-prd-comment';
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
  const [showRequestChanges, setShowRequestChanges] = useState(false);
  const [concernsText, setConcernsText] = useState('');
  const [showDeclineConfirm, setShowDeclineConfirm] = useState(false);
  const [submittedConcerns, setSubmittedConcerns] = useState<string[] | null>(null);
  const baselinePrdKeyRef = useRef<string | null>(null);

  const { data: prdResult = null, isLoading } = useQuery<PrdReadModelDto | null>({
    queryKey: ['prd', projectSlug, id],
    queryFn: () => fetchPRD(projectSlug, id),
    refetchInterval: submittedConcerns !== null ? 3000 : false,
  });

  const { data: events = [] } = useQuery<AgentEventDto[]>({
    queryKey: ['events', projectSlug, id],
    queryFn: () => fetchEvents(projectSlug, id),
  });

  const childIssueNumbers: number[] =
    (
      events.find((e) => e.kind === 'decompose.completed')?.payload as {
        childIssueNumbers?: number[];
      } | null
    )?.childIssueNumbers ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['issue', projectSlug, id] });
    void queryClient.invalidateQueries({ queryKey: ['issues', projectSlug] });
    void queryClient.invalidateQueries({ queryKey: ['prd', projectSlug, id] });
    void queryClient.invalidateQueries({ queryKey: ['events', projectSlug, id] });
  };

  const approve = useMutation({
    mutationFn: () => approvePRD(projectSlug, id),
    onSuccess: invalidate,
    onError: (err: unknown) => setErrorMsg(err instanceof Error ? err.message : String(err)),
  });

  const requestChanges = useMutation({
    mutationFn: (concerns: string[]) => revisePRD(projectSlug, id, concerns),
    onSuccess: (_, concerns) => {
      setSubmittedConcerns(concerns);
      setShowRequestChanges(false);
      setConcernsText('');
      invalidate();
    },
    onError: (err: unknown) => setErrorMsg(err instanceof Error ? err.message : String(err)),
  });

  const decline = useMutation({
    mutationFn: () => declinePRD(projectSlug, id),
    onSuccess: () => {
      setShowDeclineConfirm(false);
      invalidate();
    },
    onError: (err: unknown) => setErrorMsg(err instanceof Error ? err.message : String(err)),
  });

  const currentPrdKey =
    prdResult != null
      ? `${prdResult.source}:${prdResult.createdAt}:${prdResult.runId ?? ''}`
      : null;

  useEffect(() => {
    if (submittedConcerns !== null && currentPrdKey !== baselinePrdKeyRef.current) {
      setSubmittedConcerns(null);
    }
  }, [currentPrdKey, submittedConcerns]);

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
    if (prdResult == null) {
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

  if (prdResult == null) {
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

  const prd = prdResult.prd as ParsedPRDView | null;
  const advisorConcerns = prdResult.advisorConcerns;

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
  const prdApproved =
    state === 'factory:decomposing' ||
    state === 'factory:issues-created' ||
    state === 'factory:done';
  const isBusy = approve.isPending || requestChanges.isPending || decline.isPending;

  const onSubmitRequestChanges = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = concernsText.trim();
    if (trimmed.length === 0 || requestChanges.isPending) return;
    setErrorMsg(null);
    // Split on newlines or semicolons; treat each non-empty chunk as one concern.
    const concerns = trimmed
      .split(/\n|;/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    baselinePrdKeyRef.current = currentPrdKey;
    requestChanges.mutate(concerns);
  };

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

      {prdApproved && (
        <div
          data-testid="prd-approved-banner"
          className="rounded-md border border-green-500/30 bg-green-500/10 px-4 py-3 flex flex-col gap-2"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-green-400 shrink-0" />
            <span className="text-[13px] text-green-300 font-medium">PRD approved</span>
            <span className="text-[12px] text-fg-3 ml-1">
              {state === 'factory:decomposing'
                ? '— decomposing into vertical slices'
                : '— issues created'}
            </span>
          </div>
          {childIssueNumbers.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pl-[22px]">
              {childIssueNumbers.map((n) => (
                <Link
                  key={n}
                  to={`/projects/${projectSlug}/items/${n}`}
                  data-testid="prd-child-issue-link"
                  className="font-mono text-[11px] text-accent bg-bg-elev px-1.5 py-0.5 rounded border border-line hover:border-accent/50 transition-colors"
                >
                  Issue #{n}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {showApproveButtons && (
        <div
          className="rounded-md border border-line bg-bg-elev px-4 py-3 flex flex-col gap-3"
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

          {submittedConcerns !== null ? (
            <div
              data-testid="prd-rewriting-banner"
              className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex flex-col gap-2"
            >
              <div className="flex items-center gap-2">
                <Loader2 size={14} className="text-amber-400 shrink-0 animate-spin" />
                <span className="text-[13px] text-amber-300 font-medium">Rewriting PRD…</span>
              </div>
              <div className="pl-[22px] flex flex-col gap-1">
                <div className="text-[11.5px] text-fg-3 mb-0.5">Your amendments:</div>
                <ul className="list-disc pl-4 space-y-0.5">
                  {submittedConcerns.map((c) => (
                    <li key={c} className="text-[12px] text-fg-2">
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <>
              {/* Request Changes form */}
              {showRequestChanges && (
                <form
                  onSubmit={onSubmitRequestChanges}
                  className="flex flex-col gap-2"
                  data-testid="prd-request-changes-form"
                >
                  <label htmlFor="prd-concerns-input" className="text-[11.5px] text-fg-2">
                    Describe your concerns — one per line (or separated by semicolons):
                  </label>
                  <textarea
                    id="prd-concerns-input"
                    data-testid="prd-concerns-input"
                    value={concernsText}
                    onChange={(e) => setConcernsText(e.target.value)}
                    rows={4}
                    placeholder="e.g. Journey J-1 step 2 is unclear&#10;Missing error state for network timeout"
                    className="rounded-md border border-line bg-bg p-2 text-[12.5px] resize-y"
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      data-testid="prd-cancel-changes-btn"
                      onClick={() => {
                        setShowRequestChanges(false);
                        setConcernsText('');
                      }}
                      className="h-8 px-3 rounded-md border border-line text-[12px] hover:bg-bg-hover"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      data-testid="prd-submit-changes-btn"
                      disabled={requestChanges.isPending || concernsText.trim().length === 0}
                      className="h-8 px-4 rounded-md bg-amber-600 text-white text-[12px] font-medium hover:bg-amber-700 disabled:opacity-50"
                    >
                      {requestChanges.isPending ? 'Submitting…' : 'Submit changes'}
                    </button>
                  </div>
                </form>
              )}

              {/* Decline confirmation */}
              {showDeclineConfirm && (
                <div
                  className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 flex flex-col gap-2"
                  data-testid="prd-decline-confirm"
                >
                  <p className="text-[12.5px] text-fg">
                    Are you sure you want to decline this feature? The work item will be closed as
                    done.
                  </p>
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      data-testid="prd-cancel-decline-btn"
                      onClick={() => setShowDeclineConfirm(false)}
                      className="h-8 px-3 rounded-md border border-line text-[12px] hover:bg-bg-hover"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      data-testid="prd-confirm-decline-btn"
                      disabled={decline.isPending}
                      onClick={() => {
                        setErrorMsg(null);
                        decline.mutate();
                      }}
                      className="h-8 px-4 rounded-md bg-red-700 text-white text-[12px] font-medium hover:bg-red-800 disabled:opacity-50"
                    >
                      {decline.isPending ? 'Declining…' : 'Yes, decline feature'}
                    </button>
                  </div>
                </div>
              )}

              {!showRequestChanges && !showDeclineConfirm && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    data-testid="prd-approve-btn"
                    disabled={isBusy}
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
                    data-testid="prd-request-changes-btn"
                    disabled={isBusy}
                    onClick={() => {
                      setErrorMsg(null);
                      setShowRequestChanges(true);
                    }}
                    className="h-8 rounded-md border border-amber-500/50 px-3 text-[12px] text-amber-300 hover:bg-amber-500/10 disabled:opacity-50"
                  >
                    Request Changes
                  </button>
                  <button
                    type="button"
                    data-testid="prd-decline-btn"
                    disabled={isBusy}
                    onClick={() => {
                      setErrorMsg(null);
                      setShowDeclineConfirm(true);
                    }}
                    className="h-8 rounded-md border border-line px-3 text-[12px] text-fg-2 hover:bg-bg-hover disabled:opacity-50"
                  >
                    Decline Feature
                  </button>
                </div>
              )}
            </>
          )}
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

      {prd.implementationDecisions != null && prd.implementationDecisions.length > 0 && (
        <Section title="Implementation decisions" testid="prd-implementation-decisions">
          <div className="flex flex-col gap-2">
            {prd.implementationDecisions.map((d, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: decisions have no stable id
                key={i}
                data-testid="prd-impl-decision"
                className="rounded-md border border-line bg-bg-elev/50 px-3 py-2 text-[12.5px]"
              >
                <p className="text-fg font-medium">{d.decision}</p>
                {d.rationale != null && <p className="text-fg-2 mt-0.5">{d.rationale}</p>}
                {d.moduleRef != null && (
                  <p className="font-mono text-[11px] text-fg-3 mt-0.5">{d.moduleRef}</p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {prd.testingDecisions != null && (
        <Section title="Testing approach" testid="prd-testing-decisions">
          <div className="rounded-md border border-line bg-bg-elev/50 px-3 py-2 text-[12.5px] flex flex-col gap-2">
            <p className="text-fg">{prd.testingDecisions.approach}</p>
            {prd.testingDecisions.modulesToTest.length > 0 && (
              <ul className="list-disc pl-5 space-y-0.5">
                {prd.testingDecisions.modulesToTest.map((m) => (
                  <li key={m} className="font-mono text-[11.5px] text-fg-2">
                    {m}
                  </li>
                ))}
              </ul>
            )}
            {prd.testingDecisions.priorArt != null && (
              <p className="text-[12px] text-fg-3 italic">{prd.testingDecisions.priorArt}</p>
            )}
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
