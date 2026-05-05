import { PRIORITY_BG, PRIORITY_BORDER, PRIORITY_COLOR } from '@/lib/constants';
import { laneForState } from '@/lib/lanes.config';
import { renderMarkdownToHtml } from '@/lib/markdown';
import type { WorkItemDto } from '@/lib/types';
import { getPersonaLabel, usePersonaMap } from '@/lib/usePersonaMap';
import { formatCost, formatTokens } from '@/lib/utils';
import {
  Brain,
  Bug,
  Clock,
  Code2,
  Coins,
  Eye,
  FileText,
  Folder,
  MessageSquare,
  RotateCcw,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useIssueCostsBreakdown } from '../lib/costs';
import { SECTIONS } from '../lib/sections';
import { CommentsSection } from './CommentsSection';
import { DependenciesSection } from './DependenciesSection';

interface OverviewSectionProps {
  item?: WorkItemDto;
  projectSlug?: string;
}

const SECTION_ICONS: Record<string, React.ElementType> = {
  repo: Folder,
  investigation: Brain,
  prd: FileText,
  code: Code2,
  qa: Bug,
  review: Eye,
  retrospective: RotateCcw,
  timeline: Clock,
  chat: MessageSquare,
  costs: Coins,
};

const SECTION_HINTS: Record<string, string> = {
  repo: 'Repo candidates & triage',
  investigation: 'Findings & evidence trail',
  prd: 'Scope, criteria, decomposition',
  code: 'Diff view, file changes',
  qa: 'Test run outcome',
  review: 'Holdout review verdict',
  retrospective: 'Post-merge learning loop',
  timeline: 'Full event history',
  chat: 'Conversation with orchestrator',
  costs: 'Token spend & budget burn',
};

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-bg-elev px-4 py-3">
      <div className="text-[10.5px] uppercase tracking-wider text-fg-4 mb-1.5">{label}</div>
      <div
        className="text-[20px] font-semibold leading-none tracking-tight"
        style={{ color: color ?? 'var(--fg)' }}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-fg-4 mt-1">{sub}</div>}
    </div>
  );
}

export function OverviewSection({ item, projectSlug }: OverviewSectionProps) {
  const { slug = 'goose-hub-self', id = '' } = useParams<{ slug: string; id: string }>();
  const html = renderMarkdownToHtml(item?.body ?? '');
  const personaMap = usePersonaMap();

  const lane = item?.state ? (laneForState(item.state) ?? item.state.replace('factory:', '')) : '—';
  const priority = item?.priority ?? '—';
  const depsCount = item?.dependsOn?.length ?? 0;
  const blocksCount = item?.blocks?.length ?? 0;
  const lastAgentLabel = getPersonaLabel(personaMap, item?.lastPersonaId) ?? '—';

  const costs = useIssueCostsBreakdown(slug, id);
  const spentValue = costs.runCount === 0 ? '—' : formatCost(costs.total, costs.totalLabel);
  const spentSub =
    costs.runCount === 0
      ? 'no runs yet'
      : `${formatTokens(costs.totalTokens)} tokens · ${costs.runCount} run${costs.runCount === 1 ? '' : 's'}`;

  const priorityColor = PRIORITY_COLOR[priority];
  const priorityBg = PRIORITY_BG[priority];
  const priorityBorder = PRIORITY_BORDER[priority];

  const jumpSections = SECTIONS.filter((s) => s.key !== 'overview');

  return (
    <div data-testid="overview-section" className="px-8 py-6 flex flex-col gap-5">
      {/* Section header */}
      <div>
        <div className="text-[10.5px] uppercase tracking-wider text-fg-4 mb-1">01. Overview</div>
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
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Stage" value={lane} />
        <StatCard label="Priority" value={priority} color={priorityColor} />
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
      <div className="grid gap-4" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        {/* Brief card */}
        <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
          <div className="px-4 py-3 border-b border-line bg-bg-elev-2">
            <div className="text-[10.5px] uppercase tracking-wider text-fg-4">Brief</div>
          </div>
          <div className="px-4 py-4">
            {priority !== '—' && (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold mb-3 border"
                style={{
                  color: priorityColor,
                  background: priorityBg,
                  borderColor: priorityBorder,
                }}
              >
                {priority}
              </span>
            )}
            <article
              data-testid="overview-body"
              className="prose-fix text-[13.5px]"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML is generated by renderMarkdownToHtml which escapes raw input.
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        </div>

        {/* Quick jump card */}
        <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
          <div className="px-4 py-3 border-b border-line bg-bg-elev-2">
            <div className="text-[10.5px] uppercase tracking-wider text-fg-4">Quick jump</div>
          </div>
          <div className="py-1">
            {jumpSections.map((s) => {
              const Icon = SECTION_ICONS[s.key];
              const target =
                s.key === 'overview'
                  ? `/projects/${slug}/items/${id}`
                  : `/projects/${slug}/items/${id}/${s.key}`;
              return (
                <Link
                  key={s.key}
                  to={target}
                  className="flex items-center gap-3 px-4 py-2 hover:bg-bg-hover transition-colors group"
                >
                  <span className="w-7 h-7 rounded-md flex items-center justify-center bg-accent-soft text-accent shrink-0">
                    {Icon && <Icon size={13} />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-medium text-fg group-hover:text-fg">
                      {s.label}
                    </div>
                    <div className="text-[11px] text-fg-4 truncate">
                      {SECTION_HINTS[s.key] ?? s.description ?? ''}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Dependencies */}
      {item != null && projectSlug != null && (
        <DependenciesSection item={item} projectSlug={projectSlug} />
      )}

      {/* Comments */}
      {item != null && projectSlug != null && (
        <CommentsSection
          projectSlug={projectSlug}
          id={item.externalId}
          externalId={item.externalId}
        />
      )}
    </div>
  );
}
