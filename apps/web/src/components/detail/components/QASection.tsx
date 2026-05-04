import { fetchEvents } from '@/lib/api';
import type { AgentEventDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle, Clock, XCircle } from 'lucide-react';

interface QASectionProps {
  projectSlug: string;
  id: string;
}

interface Finding {
  tier: 'structural' | 'functional' | 'regression';
  severity: 'error' | 'warning' | 'info';
  file?: string | null;
  line?: number | null;
  description: string;
  suggestion?: string;
}

interface TierResult {
  passed: boolean;
  findings: Finding[];
  command?: string | null;
  output?: string | null;
}

interface QaPayload {
  verdict: 'pass' | 'fail' | 'partial';
  overallScore: number;
  threshold?: number;
  tierResults: {
    structural: TierResult;
    functional: TierResult;
    regression: TierResult;
  };
}

const TIERS = ['structural', 'functional', 'regression'] as const;

export function QASection({ projectSlug, id }: QASectionProps) {
  const { data: events = [], isLoading } = useQuery<AgentEventDto[]>({
    queryKey: ['events', projectSlug, id],
    queryFn: () => fetchEvents(projectSlug, id),
  });

  if (isLoading) return null;

  const qaEvent = [...events].reverse().find((e) => e.kind === 'qa.completed');
  const qa = qaEvent?.payload as QaPayload | undefined;

  if (!qa) {
    return (
      <div
        data-testid="qa-empty-state"
        className="px-8 py-8 flex flex-col items-center justify-center gap-2 text-center"
      >
        <Clock size={24} className="text-fg-3 opacity-50" />
        <p className="text-[13px] text-fg-3">Waiting for QA to run…</p>
        <p className="text-[12px] text-fg-4">QA runs automatically after the PR is opened.</p>
      </div>
    );
  }

  const VerdictIcon =
    qa.verdict === 'pass' ? CheckCircle : qa.verdict === 'fail' ? XCircle : AlertCircle;
  const verdictColor =
    qa.verdict === 'pass'
      ? 'text-green-500'
      : qa.verdict === 'fail'
        ? 'text-red-500'
        : 'text-yellow-500';
  const verdictBg =
    qa.verdict === 'pass'
      ? 'bg-green-500/10 border-green-500/20'
      : qa.verdict === 'fail'
        ? 'bg-red-500/10 border-red-500/20'
        : 'bg-yellow-500/10 border-yellow-500/20';

  const threshold = qa.threshold ?? 70;

  return (
    <div data-testid="qa-section" className="px-8 py-6 space-y-6">
      {/* Verdict header */}
      <div className={`flex items-center gap-3 p-4 rounded-lg border ${verdictBg}`}>
        <VerdictIcon size={20} className={verdictColor} />
        <div>
          <div className="font-semibold text-[13px] uppercase tracking-wide">{qa.verdict}</div>
          <div className="text-[12px] text-fg-3">
            Score: {qa.overallScore}/{threshold <= 100 ? 100 : threshold} — threshold {threshold}
          </div>
        </div>
      </div>

      {/* Tier results */}
      <div>
        <h3 className="text-[11px] font-medium text-fg-3 uppercase tracking-wider mb-3">
          Verification Tiers
        </h3>
        <div className="grid grid-cols-3 gap-3">
          {TIERS.map((tier) => {
            const result = qa.tierResults?.[tier];
            return (
              <div key={tier} className="border border-line rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  {result?.passed ? (
                    <CheckCircle size={13} className="text-green-500" />
                  ) : (
                    <XCircle size={13} className="text-red-500" />
                  )}
                  <span className="text-[12px] font-medium capitalize">{tier}</span>
                </div>
                <div
                  className={`text-[11px] ${result?.passed ? 'text-green-500' : 'text-red-500'}`}
                >
                  {result?.passed ? 'Pass' : `${result?.findings?.length ?? 0} finding(s)`}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Findings across all tiers */}
      {qa.tierResults && TIERS.flatMap((tier) => qa.tierResults[tier].findings).length > 0 && (
        <div>
          <h3 className="text-[11px] font-medium text-fg-3 uppercase tracking-wider mb-3">
            Findings
          </h3>
          <div className="space-y-2">
            {TIERS.flatMap((tier) =>
              qa.tierResults[tier].findings.map((f) => (
                <div
                  key={`${tier}:${f.description}`}
                  className="border border-line rounded-lg p-3 text-[12.5px]"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${
                        f.severity === 'error'
                          ? 'bg-red-500/15 text-red-400'
                          : f.severity === 'warning'
                            ? 'bg-yellow-500/15 text-yellow-400'
                            : 'bg-blue-500/15 text-blue-400'
                      }`}
                    >
                      {f.severity}
                    </span>
                    <span className="text-[11px] text-fg-4 capitalize">{tier}</span>
                    {f.file && (
                      <span className="font-mono text-[10px] text-fg-3 bg-bg-glass px-1 py-0.5 rounded">
                        {f.file}
                        {f.line != null ? `:${f.line}` : ''}
                      </span>
                    )}
                  </div>
                  <div className="text-fg-2">{f.description}</div>
                  {f.suggestion && (
                    <div className="text-[11px] text-fg-3 mt-1">→ {f.suggestion}</div>
                  )}
                </div>
              )),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
