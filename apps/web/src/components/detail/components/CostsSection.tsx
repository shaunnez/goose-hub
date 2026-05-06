import { CostLegend } from '@/components/costs/CostLegend';
import { fetchIssueCosts, fetchProjectConfigs } from '@/lib/api';
import type { CostRowDto, ProjectConfigDto, WorkItemCostsDto } from '@/lib/types';
import { getPersonaInitials, getPersonaLabel, usePersonaMap } from '@/lib/usePersonaMap';
import { formatCost, formatTokens, timeAgo } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { Coins } from 'lucide-react';
import { useMemo } from 'react';
import { SectionEmptyState } from './SectionEmptyState';

interface CostsSectionProps {
  projectSlug: string;
  id: string;
}

const STAGE_LABEL: Record<CostRowDto['stage'], string> = {
  triage: 'Triage',
  investigate: 'Investigate',
  dev: 'Dev',
  qa: 'QA',
  review: 'Review',
  retrospective: 'Retrospective',
  other: 'Other',
};

function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex-1 border border-line rounded-lg p-3 bg-bg-elev/60">
      <div className="text-[10.5px] uppercase tracking-wider text-fg-2 mb-1">{label}</div>
      <div className="text-[18px] font-semibold tracking-tight">{value}</div>
      {sub != null && <div className="text-[11px] text-fg-3 mt-0.5">{sub}</div>}
    </div>
  );
}

export function CostsSection({ projectSlug, id }: CostsSectionProps) {
  const personaMap = usePersonaMap();

  const { data, isLoading, error } = useQuery<WorkItemCostsDto>({
    queryKey: ['issue-costs', projectSlug, id],
    queryFn: () => fetchIssueCosts(projectSlug, id),
  });

  const { data: configs = [] } = useQuery<ProjectConfigDto[]>({
    queryKey: ['project-configs'],
    queryFn: () => fetchProjectConfigs(),
  });
  const maxBudget = configs.find((c) => c.slug === projectSlug)?.budgets.perWorkflowMaxUsd ?? null;

  if (isLoading) return null;

  if (error) {
    return (
      <div className="px-8 py-6 text-[13px] text-[color:var(--danger)]">Failed to load costs.</div>
    );
  }

  if (!data || data.rows.length === 0) {
    return (
      <div className="px-8 py-6">
        <SectionEmptyState
          data-testid="costs-empty-state"
          icon={Coins}
          title="No agent runs recorded for this task yet."
          subtitle="Cost rows are written as runs complete."
        />
      </div>
    );
  }

  const totalLabel = data.hasEstimated ? 'estimated' : 'exact';
  const totalTokens = data.rows.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0);

  const personaSummaries = useMemo(() => {
    const groups = new Map<string, CostRowDto[]>();
    for (const row of data.rows) {
      const key = row.personaId ?? '__system__';
      const existing = groups.get(key);
      if (existing) existing.push(row);
      else groups.set(key, [row]);
    }
    return Array.from(groups.entries()).map(([key, rows]) => {
      const personaId = key === '__system__' ? null : key;
      const toks = rows.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0);
      const cost = rows.reduce((s, r) => s + r.costUsd, 0);
      const lastModel = rows[rows.length - 1].modelId;
      const skills = [...new Set(rows.map((r) => r.skill))].join(', ');
      return { personaId, toks, cost, lastModel, skills };
    });
  }, [data.rows]);

  const maxPersonaToks = Math.max(...personaSummaries.map((p) => p.toks), 1);
  const maxPersonaCost = Math.max(...personaSummaries.map((p) => p.cost), 0.0001);

  return (
    <div data-testid="costs-section" className="px-8 py-6 space-y-6">
      <div>
        <div className="text-[10.5px] uppercase tracking-wider text-fg-2 mb-1">11. Costs</div>
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-semibold text-fg leading-snug ">
            Token economics for this task
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-fg-2">
              Most recent run: {timeAgo(data.rows[data.rows.length - 1].createdAt)}
            </span>
            {data.hasEstimated && <CostLegend />}
          </div>
        </div>
      </div>
      {maxBudget != null && (
        <div>
          <div className="flex justify-between text-[11px] text-fg-2 mb-1.5">
            <span>
              {formatCost(data.totalUsd, totalLabel)} of {formatCost(maxBudget, 'exact')} budget
            </span>
            <span>{Math.round((data.totalUsd / maxBudget) * 100)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-bg-elev-2 overflow-hidden">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${Math.min((data.totalUsd / maxBudget) * 100, 100)}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <StatTile
          label="Spent"
          value={formatCost(data.totalUsd, totalLabel)}
          sub={`${data.rows.length} run${data.rows.length === 1 ? '' : 's'}`}
        />
        <StatTile label="Tokens" value={formatTokens(totalTokens)} sub="across all runs" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Persona grouping */}
        <div className="border border-line rounded-lg overflow-hidden min-w-0">
          <div className="grid grid-cols-[1fr_80px_80px_80px_1fr] px-4 py-2.5 border-b border-line bg-bg-elev/50 text-[10.5px] uppercase tracking-wider text-fg-2">
            <span className="pr-4">Persona</span>
            <span className="pr-4">Model</span>
            <span className="pr-4">Tokens</span>
            <span className="pr-4">Cost</span>
            <span>Operations</span>
          </div>
          {personaSummaries.map((p) => {
            const initials = getPersonaInitials(personaMap, p.personaId) ?? 'SYS';
            const label = getPersonaLabel(personaMap, p.personaId) ?? 'System';
            const tokPct = (p.toks / maxPersonaToks) * 100;
            const costPct = (p.cost / maxPersonaCost) * 100;
            return (
              <div
                key={p.personaId ?? '__system__'}
                className="grid grid-cols-[1fr_80px_80px_80px_1fr] px-4 py-2.5 border-t border-line items-center text-[12px]"
              >
                <div className="flex items-center gap-2 min-w-0 pr-4">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-bg-elev-2 border border-line text-[10px] font-semibold text-fg-2 shrink-0">
                    {initials}
                  </span>
                  <span className="text-fg-2 truncate">{label}</span>
                </div>
                <span className="font-mono text-fg-3 text-[11px] truncate pr-4">{p.lastModel}</span>
                <div className="pr-4">
                  <div className="text-fg-2 font-mono text-[11px] mb-0.5">
                    {formatTokens(p.toks)}
                  </div>
                  <div className="h-1 rounded-full bg-bg-elev-2 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-fg-3/40"
                      style={{ width: `${tokPct}%` }}
                    />
                  </div>
                </div>
                <div className="pr-4">
                  <div className="text-fg-2 font-mono text-[11px] mb-0.5">
                    {formatCost(p.cost, 'exact')}
                  </div>
                  <div className="h-1 rounded-full bg-bg-elev-2 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent/50"
                      style={{ width: `${costPct}%` }}
                    />
                  </div>
                </div>
                <span className="text-fg-3 text-[11px] truncate" title={p.skills}>
                  {p.skills}
                </span>
              </div>
            );
          })}
        </div>

        {/* Raw run table */}
        <div className="border border-line rounded-lg overflow-hidden min-w-0">
          <div className="grid grid-cols-[120px_1fr_80px_80px] px-4 py-2.5 border-b border-line bg-bg-elev/50 text-[10.5px] uppercase tracking-wider text-fg-2">
            <span className="pr-4">Stage</span>
            <span className="pr-4">Skill</span>
            <span className="pr-4">Tokens</span>
            <span>Cost</span>
          </div>
          {data.rows.map((r) => (
            <div
              key={r.runId}
              data-testid={`costs-row-${r.runId}`}
              className="grid grid-cols-[120px_1fr_80px_80px] px-4 py-2.5 border-t border-line items-center text-[12px]"
            >
              <span className="text-fg-2 pr-4">{STAGE_LABEL[r.stage]}</span>
              <span className="font-mono text-fg-3 text-[11.5px] pr-4 truncate">{r.skill}</span>
              <span className="font-mono text-fg-2 text-[11.5px] pr-4">
                {formatTokens(r.inputTokens + r.outputTokens)}
              </span>
              <span className="font-mono text-fg-2 text-[11.5px]">
                {formatCost(r.costUsd, r.costLabel)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
