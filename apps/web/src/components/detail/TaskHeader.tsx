import { Pill } from '@/components/ui/pill';
import type { WorkItemDto } from '@/lib/api';
import { TransitionButton } from './TransitionButton';

const STATE_LABEL: Record<string, string> = {
  'factory:triaging': 'triaging',
  'factory:accepted': 'accepted',
  'factory:rejected': 'rejected',
  'factory:grilling': 'grilling',
  'factory:prd-drafting': 'prd-drafting',
  'factory:prd-review': 'prd-review',
  'factory:decomposing': 'decomposing',
  'factory:issues-created': 'issues-created',
  'factory:research-pending': 'research-pending',
  'factory:research-complete': 'research-complete',
  'factory:investigating': 'investigating',
  'factory:investigation-complete': 'investigation-complete',
  'factory:dev-ready': 'dev-ready',
  'factory:in-progress': 'in-progress',
  'factory:needs-qa': 'needs-qa',
  'factory:qa-failed': 'qa-failed',
  'factory:needs-review': 'needs-review',
  'factory:needs-fix': 'needs-fix',
  'factory:approved': 'approved',
  'factory:retrospecting': 'retrospecting',
  'factory:needs-human': 'needs-human',
  'factory:done': 'done',
  'factory:archived': 'archived',
};

interface TaskHeaderProps {
  item: WorkItemDto;
  projectSlug: string;
  onStateChanged: (next: string) => void;
}

export function TaskHeader({ item, projectSlug, onStateChanged }: TaskHeaderProps) {
  return (
    <div data-testid="task-header" className="px-6 py-4 border-b border-line bg-bg-elev shrink-0">
      <div className="flex items-start gap-4">
        <div className="grow min-w-0">
          <div className="flex items-center gap-2 mb-1.5 text-[11px] text-fg-3">
            <span className="font-mono uppercase tracking-wider">#{item.externalId}</span>
            <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
            <span className="font-mono">{item.repoRef}</span>
          </div>
          <h1 className="text-[22px] font-semibold tracking-tight leading-tight text-fg">
            {item.title}
          </h1>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap shrink-0 justify-end">
          <Pill tone="accent" data-testid="state-pill">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            <span className="font-medium">{STATE_LABEL[item.state] ?? item.state}</span>
          </Pill>
          <Pill data-testid="priority-pill" className="capitalize">
            {item.priority}
          </Pill>
          <Pill data-testid="type-pill" className="capitalize">
            {item.type}
          </Pill>
          <TransitionButton
            projectSlug={projectSlug}
            id={item.externalId}
            currentState={item.state}
            onStateChanged={onStateChanged}
          />
        </div>
      </div>
      <div className="flex items-center gap-3 mt-3 text-[11.5px] text-fg-3 flex-wrap">
        <span>by {item.authorIsOwner ? 'owner' : 'guest'}</span>
        <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
        <span>opened {new Date(item.createdAt).toLocaleString()}</span>
        {item.milestoneId != null && (
          <>
            <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
            <span>
              milestone <span className="font-mono tnum">#{item.milestoneId}</span>
            </span>
          </>
        )}
      </div>
    </div>
  );
}
