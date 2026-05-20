import { createPlaybook, fetchPlaybook, fetchPlaybooks } from '@/lib/api';
import type { PlaybookDetailDto, PlaybookManifestDto, PlaybookSummaryDto } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { useState } from 'react';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

interface PlaybooksTabProps {
  projectSlug: string;
}

type PlaybookPreset = '7d' | '14d' | '10-lifecycles';

const PLAYBOOK_PRESETS: Array<{ id: PlaybookPreset; label: string }> = [
  { id: '7d', label: 'Last 7 days' },
  { id: '14d', label: 'Last 14 days' },
  { id: '10-lifecycles', label: 'Last 10 lifecycles' },
];

function buildPlaybookBody(
  preset: PlaybookPreset,
): { windowSize: number } | { dateRange: { startAt: string; endAt: string } } {
  if (preset === '10-lifecycles') return { windowSize: 10 };

  const days = preset === '14d' ? 14 : 7;
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    dateRange: {
      startAt: start.toISOString(),
      endAt: end.toISOString(),
    },
  };
}

export function PlaybooksTab({ projectSlug }: PlaybooksTabProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [preset, setPreset] = useState<PlaybookPreset>('7d');
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<{ playbookId: number; lifecycleCount: number } | null>(
    null,
  );
  const queryClient = useQueryClient();

  const {
    data: playbooks = [],
    isLoading,
    error,
  } = useQuery<PlaybookSummaryDto[]>({
    queryKey: ['playbooks', projectSlug],
    queryFn: () => fetchPlaybooks(projectSlug),
  });

  const generate = useMutation({
    mutationFn: () => createPlaybook(projectSlug, buildPlaybookBody(preset)),
    onMutate: () => {
      setGenerateError(null);
      setGenerated(null);
    },
    onSuccess: (result) => {
      setGenerated(result);
      setSelectedId(result.playbookId);
      void queryClient.invalidateQueries({ queryKey: ['playbooks', projectSlug] });
      void queryClient.invalidateQueries({
        queryKey: ['playbook-detail', projectSlug, result.playbookId],
      });
    },
    onError: (err: Error) => setGenerateError(err.message),
  });

  return (
    <div data-testid="playbooks-tab" className="flex h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h1 className="text-[15px] font-semibold">Playbooks</h1>
            <span className="text-[11.5px] text-fg-3">Cross-run retrospective manifests</span>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-1 rounded-md border border-line bg-bg-elev p-1">
              {PLAYBOOK_PRESETS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setPreset(option.id)}
                  disabled={generate.isPending}
                  className={[
                    'h-7 px-2 rounded text-[11px] transition-colors',
                    preset === option.id
                      ? 'bg-accent-soft text-fg'
                      : 'text-fg-3 hover:text-fg hover:bg-bg-hover',
                    generate.isPending ? 'cursor-not-allowed opacity-70' : '',
                  ].join(' ')}
                >
                  {option.label}
                </button>
              ))}
              <button
                type="button"
                data-testid="generate-playbook"
                onClick={() => generate.mutate()}
                disabled={generate.isPending}
                className="h-7 px-2.5 rounded bg-accent text-white text-[11px] font-medium flex items-center gap-1.5 disabled:opacity-70 disabled:cursor-not-allowed"
                title="Generate cross-run playbook"
              >
                <Play size={11} />
                {generate.isPending ? 'Generating...' : 'Generate'}
              </button>
            </div>
            {generateError != null && (
              <div className="text-[11px] text-[color:var(--danger)] max-w-[420px] text-right">
                {generateError}
              </div>
            )}
            {generated != null && !generate.isPending && (
              <div className="text-[11px] text-fg-3">
                Created playbook #{generated.playbookId} from {generated.lifecycleCount} lifecycles.
              </div>
            )}
          </div>
        </div>

        {isLoading && <div className="text-fg-3 text-[13px]">Loading playbooks…</div>}

        {error && (
          <div className="text-[color:var(--danger)] text-[13px]">Failed to load playbooks.</div>
        )}

        {!isLoading && !error && playbooks.length === 0 && (
          <div
            data-testid="playbooks-empty-state"
            className="text-center text-fg-3 text-[13px] py-16"
          >
            <p className="mb-2 font-medium text-fg-2">No playbooks yet</p>
            <p>Pick a window and generate the first cross-run retrospective manifest.</p>
          </div>
        )}

        {!isLoading && !error && playbooks.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {playbooks.map((p) => (
              <PlaybookCard
                key={p.id}
                playbook={p}
                isSelected={selectedId === p.id}
                onClick={() => setSelectedId(p.id)}
              />
            ))}
          </div>
        )}
      </div>

      {selectedId != null && (
        <PlaybookDrillIn
          projectSlug={projectSlug}
          playbookId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

interface PlaybookCardProps {
  playbook: PlaybookSummaryDto;
  isSelected: boolean;
  onClick: () => void;
}

function PlaybookCard({ playbook, isSelected, onClick }: PlaybookCardProps) {
  return (
    <button
      type="button"
      data-testid="playbook-card"
      onClick={onClick}
      className={[
        'w-full text-left px-3 py-3 rounded-md border transition-colors',
        isSelected
          ? 'border-accent bg-accent-soft'
          : 'border-line bg-bg-elev/60 hover:bg-bg-elev hover:border-line',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-[12.5px] font-medium text-fg truncate">
          {formatDate(playbook.windowStartAt)} → {formatDate(playbook.windowEndAt)}
        </span>
        <span className="text-[11px] font-mono shrink-0 text-fg-2">#{playbook.id}</span>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-fg-2">
        <span>{playbook.lifecycleCount} lifecycles</span>
        <span>·</span>
        <span>{playbook.topPatternCount} patterns</span>
        <span>·</span>
        <span>{playbook.topCandidateCount} candidates</span>
        {playbook.coachProposalCount > 0 && (
          <>
            <span>·</span>
            <span className="text-accent font-medium">
              Coach proposals: {playbook.coachProposalCount}
            </span>
          </>
        )}
      </div>
    </button>
  );
}

interface PlaybookDrillInProps {
  projectSlug: string;
  playbookId: number;
  onClose: () => void;
}

function PlaybookDrillIn({ projectSlug, playbookId, onClose }: PlaybookDrillInProps) {
  const { data: detail, isLoading } = useQuery<PlaybookDetailDto>({
    queryKey: ['playbook-detail', projectSlug, playbookId],
    queryFn: () => fetchPlaybook(projectSlug, playbookId),
  });

  return (
    <aside
      data-testid="playbook-drill-in"
      className="w-[620px] shrink-0 border-l border-line bg-bg-elev overflow-y-auto px-5 py-5"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[14px] font-semibold">Playbook #{playbookId}</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-fg-2 hover:text-fg text-[12px]"
          aria-label="Close playbook detail"
        >
          Close
        </button>
      </div>
      {isLoading && <div className="text-fg-3 text-[13px]">Loading…</div>}
      {detail && <PlaybookManifestView manifest={detail.manifest} />}
    </aside>
  );
}

function PlaybookManifestView({ manifest }: { manifest: PlaybookManifestDto }) {
  return (
    <div className="flex flex-col gap-5 text-[12.5px] text-fg-2">
      <Section title="Summary">
        <Row label="Went well">{manifest.summary.wentWell}</Row>
        <Row label="Did not">{manifest.summary.didNotGoWell}</Row>
        <Row label="Takeaway">{manifest.summary.architecturalTakeaway}</Row>
      </Section>

      <Section title={`Top patterns (${manifest.topPatterns.length})`}>
        {manifest.topPatterns.length === 0 ? (
          <p className="text-fg-3">No patterns surfaced.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {manifest.topPatterns.map((p) => (
              <li key={p.patternId} className="border border-line rounded p-2">
                <div className="font-mono text-[11px] text-fg-3">{p.patternId}</div>
                <div className="text-fg">{p.pattern}</div>
                <div className="text-[11px] text-fg-3">
                  {p.occurrenceCount}× · consistency {(p.consistencyScore * 100).toFixed(0)}%
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Improvement candidates (${manifest.improvementCandidates.length})`}>
        {manifest.improvementCandidates.length === 0 ? (
          <p className="text-fg-3">No candidates surfaced.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {manifest.improvementCandidates.map((c, idx) => (
              <li key={`${c.targetPath}-${idx}`} className="border border-line rounded p-2">
                <div className="font-mono text-[11px] text-fg-3">
                  {c.kind} · {c.targetPath}
                </div>
                <div className="text-fg">{c.suggestionText}</div>
                {c.evidence && (
                  <div className="text-[11px] text-fg-3 mt-1">Evidence: {c.evidence}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Gate thresholds">
        {manifest.gateThresholds.length === 0 ? (
          <p className="text-fg-3">No gate samples in window.</p>
        ) : (
          <table className="w-full text-[11.5px] font-mono">
            <thead className="text-fg-3">
              <tr>
                <th className="text-left">Gate</th>
                <th className="text-right">Mean</th>
                <th className="text-right">Min</th>
                <th className="text-right">Max</th>
                <th className="text-right">σ</th>
                <th className="text-right">N</th>
              </tr>
            </thead>
            <tbody>
              {manifest.gateThresholds.map((g) => (
                <tr key={g.gate}>
                  <td>{g.gate}</td>
                  <td className="text-right">{g.mean.toFixed(2)}</td>
                  <td className="text-right">{g.min.toFixed(2)}</td>
                  <td className="text-right">{g.max.toFixed(2)}</td>
                  <td className="text-right">{g.stdDev.toFixed(2)}</td>
                  <td className="text-right">{g.sampleCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Cost baselines">
        {manifest.costBaselines.length === 0 ? (
          <p className="text-fg-3">No cost samples in window.</p>
        ) : (
          <table className="w-full text-[11.5px] font-mono">
            <thead className="text-fg-3">
              <tr>
                <th className="text-left">Role/Skill</th>
                <th className="text-right">Mean</th>
                <th className="text-right">P50</th>
                <th className="text-right">P95</th>
                <th className="text-right">N</th>
              </tr>
            </thead>
            <tbody>
              {manifest.costBaselines.map((c) => (
                <tr key={`${c.role}::${c.skill}`}>
                  <td>
                    {c.role}/{c.skill}
                  </td>
                  <td className="text-right">{formatUsd(c.mean)}</td>
                  <td className="text-right">{formatUsd(c.p50)}</td>
                  <td className="text-right">{formatUsd(c.p95)}</td>
                  <td className="text-right">{c.sampleCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[11px] uppercase tracking-wider text-fg-2 mb-2">{title}</h3>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-fg-3">{label}</div>
      <div className="text-fg">{children}</div>
    </div>
  );
}
