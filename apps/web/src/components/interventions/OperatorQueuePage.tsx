import {
  decideIntervention,
  fetchIssues,
  fetchProjectConfigs,
  fetchProjectInterventions,
} from '@/lib/api';
import { interventionKeys, invalidateInterventionDecision } from '@/lib/query-keys';
import type {
  InterventionDto,
  InterventionOptionDto,
  ProjectConfigDto,
  WorkItemDto,
} from '@/lib/types';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpRight, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

const ACTIONABLE_STATUSES = ['OPEN', 'PROPOSED'] as const;

function issueIdFromWorkItemId(workItemId: string): string {
  return workItemId.split('#').at(-1) ?? workItemId;
}

function typeLabel(type: string): string {
  return type
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function optionButtonLabel(option: InterventionOptionDto): string {
  return option.label.trim() || typeLabel(option.actionType);
}

function buildIssueMap(items: WorkItemDto[]): Map<string, WorkItemDto> {
  return new Map(
    items.flatMap((item) => [
      [item.id, item],
      [`#${item.externalId}`, item],
    ]),
  );
}

function ageLabel(createdAt: string): string {
  const ms = Date.now() - Date.parse(createdAt);
  if (!Number.isFinite(ms) || ms < 0) return 'now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

interface QueueRowProps {
  intervention: InterventionDto;
  issue: WorkItemDto | undefined;
  project: ProjectConfigDto;
}

function QueueRow({ intervention, issue, project }: QueueRowProps) {
  const queryClient = useQueryClient();
  const issueId = issue?.externalId ?? issueIdFromWorkItemId(intervention.workItemId);
  const decision = useMutation({
    mutationFn: (option: InterventionOptionDto) =>
      decideIntervention(intervention.id, {
        actionType: option.actionType,
        actionPayload: option.payload,
        expectedVersion: intervention.version,
        decidedBy: 'operator',
      }),
    onSuccess: () =>
      invalidateInterventionDecision(queryClient, {
        projectSlug: project.slug,
        issueId,
        interventionId: intervention.id,
      }),
  });

  return (
    <div
      data-testid="operator-queue-row"
      className="grid grid-cols-[minmax(180px,1.2fr)_110px_minmax(220px,1fr)_minmax(220px,1.3fr)] gap-3 px-3 py-2.5 border-t border-line text-[12px] items-start"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-mono text-fg-3">#{issueId}</span>
          <Link
            to={`/projects/${project.slug}/items/${issueId}`}
            className="truncate text-fg hover:text-accent"
          >
            {issue?.title ?? intervention.workItemId}
          </Link>
          <ArrowUpRight size={12} className="shrink-0 text-fg-3" />
        </div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-fg-3">
          <span>{project.slug}</span>
          <span>{ageLabel(intervention.createdAt)}</span>
        </div>
      </div>

      <div>
        <div className="font-medium">{intervention.status}</div>
        <div className="mt-1 text-[11px] text-fg-3">{typeLabel(intervention.interventionType)}</div>
      </div>

      <div className="min-w-0">
        <div className="font-medium truncate">{intervention.title}</div>
        <div className="mt-1 text-fg-2 line-clamp-2">{intervention.reason}</div>
      </div>

      <div className="min-w-0">
        {intervention.status === 'PROPOSED' && intervention.proposedOptions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {intervention.proposedOptions.map((option, index) => (
              <button
                key={`${option.actionType}-${index}`}
                type="button"
                onClick={() => decision.mutate(option)}
                disabled={decision.isPending}
                className="h-7 px-2 rounded-md border border-line text-[11.5px] hover:bg-bg-hover disabled:opacity-60"
              >
                {optionButtonLabel(option)}
              </button>
            ))}
          </div>
        ) : (
          <div className="text-fg-3">
            {intervention.leaseOwner != null ? 'Proposal running' : 'Proposal pending'}
          </div>
        )}
        {decision.error instanceof Error && (
          <div className="mt-1 text-[11px] text-[color:var(--danger)]">
            {decision.error.message}
          </div>
        )}
      </div>
    </div>
  );
}

export function OperatorQueuePage() {
  const {
    data: projects = [],
    isLoading: projectsLoading,
    isError: projectsError,
    refetch,
  } = useQuery({
    queryKey: ['project-configs'],
    queryFn: () => fetchProjectConfigs(),
  });

  const interventionQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: interventionKeys.project(project.slug, [...ACTIONABLE_STATUSES]),
      queryFn: () => fetchProjectInterventions(project.slug, [...ACTIONABLE_STATUSES]),
      enabled: projects.length > 0,
    })),
  });

  const issueQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: ['issues-all', project.slug],
      queryFn: () => fetchIssues(project.slug, { all: true }),
      enabled: projects.length > 0,
    })),
  });

  const loading =
    projectsLoading ||
    interventionQueries.some((query) => query.isLoading) ||
    issueQueries.some((query) => query.isLoading);
  const error =
    projectsError ||
    interventionQueries.some((query) => query.isError) ||
    issueQueries.some((query) => query.isError);

  const groups = projects.flatMap((project, index) => {
    const interventions = interventionQueries[index]?.data ?? [];
    const issueMap = buildIssueMap(issueQueries[index]?.data ?? []);
    const byType = new Map<string, InterventionDto[]>();
    for (const intervention of interventions) {
      const list = byType.get(intervention.interventionType) ?? [];
      list.push(intervention);
      byType.set(intervention.interventionType, list);
    }
    return [...byType.entries()].map(([type, rows]) => ({ project, type, rows, issueMap }));
  });

  const handleRetry = async () => {
    await Promise.all([
      refetch(),
      ...interventionQueries.map((query) => query.refetch()),
      ...issueQueries.map((query) => query.refetch()),
    ]);
  };

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-8">
        <div className="text-[color:var(--danger)] text-sm">Couldn't load interventions.</div>
        <button
          type="button"
          onClick={() => void handleRetry()}
          className="h-7 px-3 rounded-md border border-line text-[12px] hover:bg-bg-hover"
        >
          <RefreshCw size={12} className="inline mr-1" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" data-testid="operator-queue">
      <div className="shrink-0 border-b border-line px-4 py-3 flex items-center gap-2">
        <AlertTriangle size={15} className="text-fg-2" />
        <h1 className="text-[14px] font-semibold">Operator Queue</h1>
        <span className="text-[12px] text-fg-3">
          {loading
            ? 'Loading'
            : `${groups.reduce((sum, group) => sum + group.rows.length, 0)} open`}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        {groups.length === 0 && !loading ? (
          <div className="h-full flex items-center justify-center text-[13px] text-fg-3">
            No actionable interventions.
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <section
                key={`${group.project.slug}-${group.type}`}
                className="border border-line rounded-md bg-bg-elev overflow-hidden"
              >
                <div className="px-3 py-2 flex items-center gap-2 text-[12px]">
                  <span
                    aria-hidden
                    className="inline-block w-1.5 h-4 rounded-sm"
                    style={{ background: group.project.colorStripe }}
                  />
                  <span className="font-semibold">{group.project.slug}</span>
                  <span className="text-fg-3">{typeLabel(group.type)}</span>
                  <span className="ml-auto font-mono text-fg-3">{group.rows.length}</span>
                </div>
                {group.rows.map((intervention) => (
                  <QueueRow
                    key={intervention.id}
                    intervention={intervention}
                    issue={
                      group.issueMap.get(intervention.workItemId) ??
                      group.issueMap.get(`#${issueIdFromWorkItemId(intervention.workItemId)}`)
                    }
                    project={group.project}
                  />
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
