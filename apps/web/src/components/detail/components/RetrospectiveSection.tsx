import { fetchEvents } from '@/lib/api';
import type { AgentEventDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { Clock, TrendingDown, TrendingUp, Minus } from 'lucide-react';

interface RetrospectiveSectionProps {
  projectSlug: string;
  id: string;
}

interface ImprovementCandidate {
  kind: string;
  targetPath: string;
  suggestionText: string;
  confidence: 'low' | 'medium' | 'high';
  proposedDiff?: string;
}

interface QualityScore {
  personaName: string;
  role: string;
  skillName: string;
  score: number;
  trend: 'improving' | 'stable' | 'declining';
}

interface LightRetroPayload {
  tier: 'light';
  output: {
    summary: string;
    improvementCandidates: ImprovementCandidate[];
  };
}

interface DeepRetroPayload {
  tier: 'deep';
  output: {
    summary: string;
    personaAnalysis: QualityScore[];
    improvementCandidates: ImprovementCandidate[];
    learningEntries: Array<{ observation: string; rationale: string; confidence: string }>;
    decisionPatterns: Array<{ pattern: string; frequency: number; confidence: string }>;
  };
}

type RetroPayload = LightRetroPayload | DeepRetroPayload;

function TrendIcon({ trend }: { trend: string }) {
  if (trend === 'improving') return <TrendingUp size={13} className="text-green-500" />;
  if (trend === 'declining') return <TrendingDown size={13} className="text-red-400" />;
  return <Minus size={13} className="text-fg-3" />;
}

function CandidateList({ candidates }: { candidates: ImprovementCandidate[] }) {
  if (candidates.length === 0) return null;
  return (
    <div>
      <h3 className="text-[11px] font-medium text-fg-3 uppercase tracking-wider mb-3">
        Improvement Candidates
      </h3>
      <div className="space-y-2">
        {candidates.map((c) => (
          <div key={c.targetPath} className="border border-line rounded-lg p-3 text-[12.5px]">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${
                  c.confidence === 'high'
                    ? 'bg-green-500/15 text-green-400'
                    : c.confidence === 'medium'
                      ? 'bg-yellow-500/15 text-yellow-400'
                      : 'bg-blue-500/15 text-blue-400'
                }`}
              >
                {c.confidence}
              </span>
              <span className="text-[11px] text-fg-4">{c.kind}</span>
              <span className="font-mono text-[10px] text-fg-3 bg-bg-glass px-1 py-0.5 rounded">
                {c.targetPath}
              </span>
            </div>
            <div className="text-fg-2">{c.suggestionText}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RetrospectiveSection({ projectSlug, id }: RetrospectiveSectionProps) {
  const { data: events = [], isLoading } = useQuery<AgentEventDto[]>({
    queryKey: ['events', projectSlug, id],
    queryFn: () => fetchEvents(projectSlug, id),
  });

  if (isLoading) return null;

  const retroEvent = [...events].reverse().find((e) => e.kind === 'retrospective.completed');
  const retro = retroEvent?.payload as RetroPayload | undefined;

  if (!retro) {
    return (
      <div
        data-testid="retro-empty-state"
        className="px-8 py-8 flex flex-col items-center justify-center gap-2 text-center"
      >
        <Clock size={24} className="text-fg-3 opacity-50" />
        <p className="text-[13px] text-fg-3">No retrospective yet.</p>
        <p className="text-[12px] text-fg-4">
          Runs automatically after the PR merges to <code className="font-mono">factory:done</code>.
        </p>
      </div>
    );
  }

  const bullets = retro.output.summary
    .split('\n')
    .map((l) => l.replace(/^-\s*/, '').trim())
    .filter(Boolean);

  return (
    <div data-testid="retro-section" className="px-8 py-6 space-y-6">
      {/* Tier badge */}
      <div className="flex items-center gap-2">
        <span
          className={`text-[10px] font-medium uppercase px-2 py-0.5 rounded-full ${
            retro.tier === 'deep'
              ? 'bg-purple-500/15 text-purple-400'
              : 'bg-blue-500/15 text-blue-400'
          }`}
        >
          {retro.tier} retro
        </span>
      </div>

      {/* Summary bullets */}
      <div>
        <h3 className="text-[11px] font-medium text-fg-3 uppercase tracking-wider mb-3">Summary</h3>
        <ul className="space-y-1.5">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2 text-[13px] text-fg-2">
              <span className="text-fg-4 mt-0.5">•</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Deep-only: persona analysis */}
      {retro.tier === 'deep' && retro.output.personaAnalysis.length > 0 && (
        <div>
          <h3 className="text-[11px] font-medium text-fg-3 uppercase tracking-wider mb-3">
            Persona Quality
          </h3>
          <div className="space-y-2">
            {retro.output.personaAnalysis.map((p) => (
              <div
                key={`${p.personaName}:${p.role}`}
                className="flex items-center gap-3 border border-line rounded-lg p-3"
              >
                <TrendIcon trend={p.trend} />
                <div className="grow">
                  <span className="text-[12.5px] font-medium">{p.personaName}</span>
                  <span className="text-[11px] text-fg-3 ml-1.5">{p.role}</span>
                </div>
                <span className="font-mono text-[12px] text-fg-2">
                  {(p.score * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Improvement candidates */}
      <CandidateList candidates={retro.output.improvementCandidates} />
    </div>
  );
}
