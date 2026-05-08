import { fetchEvents, fetchIssueDiff } from '@/lib/api';
import { laneForState } from '@/lib/lanes.config';
import { renderMarkdownToHtml } from '@/lib/markdown';
import type { AgentEventDto, IssueDiffDto, WorkItemDto } from '@/lib/types';
import { getPersonaInitials, getPersonaLabel, usePersonaMap } from '@/lib/usePersonaMap';
import { formatCost, formatTokens } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { parseDiff } from '../lib/code-diff';
import { useIssueCostsBreakdown } from '../lib/costs';
import { CommentsSection } from './CommentsSection';
import { DependenciesSection } from './DependenciesSection';
import { StatCard } from './StatCard';

interface OverviewSectionProps {
  item?: WorkItemDto;
  projectSlug?: string;
}

export function OverviewSection({ item, projectSlug }: OverviewSectionProps) {
  const { slug = 'goose-hub-self', id = '' } = useParams<{ slug: string; id: string }>();
  const html = renderMarkdownToHtml(item?.body ?? '');
  const personaMap = usePersonaMap();

  const lane = item?.state ? (laneForState(item.state) ?? item.state.replace('factory:', '')) : '—';
  const depsCount = item?.dependsOn?.length ?? 0;
  const blocksCount = item?.blocks?.length ?? 0;
  const lastAgentLabel = getPersonaLabel(personaMap, item?.lastPersonaId) ?? '—';

  const costs = useIssueCostsBreakdown(slug, id);
  const spentValue = costs.runCount === 0 ? '—' : formatCost(costs.total, costs.totalLabel);
  const spentSub =
    costs.runCount === 0
      ? 'no runs yet'
      : `${formatTokens(costs.totalTokens)} tokens · ${costs.runCount} run${costs.runCount === 1 ? '' : 's'}`;

  const { data: diffData } = useQuery<IssueDiffDto>({
    queryKey: ['issue-diff', slug, id],
    queryFn: () => fetchIssueDiff(slug, id),
    staleTime: 10_000,
    enabled: id !== '',
  });
  const files = useMemo(() => (diffData?.diff ? parseDiff(diffData.diff) : []), [diffData?.diff]);
  const totalAdds = useMemo(() => files.reduce((s, f) => s + f.adds, 0), [files]);
  const totalDels = useMemo(() => files.reduce((s, f) => s + f.dels, 0), [files]);

  const { data: events = [] } = useQuery<AgentEventDto[]>({
    queryKey: ['events', slug, id],
    queryFn: () => fetchEvents(slug, id),
    staleTime: 10_000,
    enabled: id !== '',
  });
  const qaPayload = events.find((e) => e.kind === 'qa.completed')?.payload as
    | { testRun?: { passed: number; failed: number; skipped: number } }
    | undefined;
  const testRun = qaPayload?.testRun ?? null;

  return (
    <div data-testid="overview-section" className="px-8 py-6 flex flex-col gap-5">
      {/* Section header */}
      <div>
        <div className="text-[10.5px] uppercase tracking-wider text-fg-2 mb-1">01. Overview</div>
        <h2 className="text-[17px] font-semibold text-fg leading-snug truncate">
          What's happening on this task
        </h2>
        <div className="flex items-center gap-3 mt-1.5 text-[12px] text-fg-3">
          <span className="font-mono">#{item?.externalId}</span>
          <span className="text-fg-5">·</span>
          <span>{item?.state ?? '—'}</span>
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-3 lg:grid-cols-7 gap-3">
        <StatCard label="Stage" value={lane} />
        <StatCard
          label="Files"
          value={files.length === 0 ? '—' : String(files.length)}
          sub={files.length > 0 ? `+${totalAdds} / −${totalDels} lines` : undefined}
        />
        <StatCard
          label="Tests"
          value={testRun ? `${testRun.passed} pass` : '—'}
          sub={testRun ? `${testRun.failed} failing · ${testRun.skipped} skipped` : undefined}
          color={testRun && testRun.failed === 0 ? 'var(--success)' : undefined}
        />
        <StatCard
          label="Depends on"
          value={depsCount === 0 ? '—' : String(depsCount)}
          sub={depsCount > 0 ? item?.dependsOn.map((d) => `#${d}`).join(', ') : undefined}
        />
        <StatCard
          label="Blocks"
          value={blocksCount === 0 ? '—' : String(blocksCount)}
          sub={blocksCount > 0 ? item?.blocks.map((d) => `#${d}`).join(', ') : undefined}
        />
        <StatCard label="Last agent" value={lastAgentLabel} />
        <StatCard label="Spent" value={spentValue} sub={spentSub} />
      </div>

      {/* Main content grid */}
      <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1.4fr' }}>
        {/* Brief card */}
        <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
          <div className="px-4 py-3 border-b border-line bg-bg-elev-2">
            <div className="text-[10.5px] uppercase tracking-wider text-fg-2">Brief</div>
          </div>
          <div className="px-4 py-4">
            <article
              data-testid="overview-body"
              className="prose-fix text-[13.5px]"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is generated by renderMarkdownToHtml which escapes raw input.
              dangerouslySetInnerHTML={{ __html: html }}
            />
            {item && (
              <div className="border-t border-line mt-4 pt-3 flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-bg-elev-2 border border-line text-[10px] font-semibold text-fg-2 shrink-0">
                  {getPersonaInitials(personaMap, item.lastPersonaId) ?? '?'}
                </span>
                <span className="text-[12px] text-fg-2 truncate">
                  {getPersonaLabel(personaMap, item.lastPersonaId) ?? '—'} · {item.state ?? '—'}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Dependencies */}
        {item != null && projectSlug != null && (
          <DependenciesSection item={item} projectSlug={projectSlug} />
        )}

        {/* Comments card */}
        {item != null && projectSlug != null && (
          <div className="rounded-lg border border-line bg-bg-elev overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-line bg-bg-elev-2 flex items-center justify-between shrink-0">
              <div className="text-[10.5px] uppercase tracking-wider text-fg-2">Comments</div>
            </div>
            <div className="flex-1 overflow-y-auto">
              <CommentsSection
                projectSlug={projectSlug}
                id={item.externalId}
                externalId={item.externalId}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
