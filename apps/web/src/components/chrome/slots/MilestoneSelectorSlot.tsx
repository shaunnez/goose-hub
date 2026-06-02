import { cn } from '@/lib/cn';
import { useActiveMilestone } from '@/state/active-milestone';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, Flag } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

interface MilestoneSelectorSlotProps {
  activeSlug?: string;
  collapsed?: boolean;
}

export function MilestoneSelectorSlot({
  activeSlug: _activeSlug,
  collapsed,
}: MilestoneSelectorSlotProps) {
  const { milestones, loading, error, activeNumber, setActiveNumber } = useActiveMilestone();
  const { slug = 'goose-hub-self' } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const activeMilestone = milestones.find((m) => m.number === activeNumber);

  if (loading) {
    return (
      <div
        data-testid="milestone-selector"
        className={cn('text-[11.5px] text-fg-2', collapsed ? 'flex justify-center' : 'px-2')}
      >
        {collapsed ? <Flag size={16} className="animate-pulse" /> : 'Loading milestones…'}
      </div>
    );
  }

  if (error != null) {
    return (
      <div
        data-testid="milestone-selector"
        className={cn(
          'text-[11.5px] text-[color:var(--danger)]',
          collapsed ? 'flex justify-center' : 'px-2',
        )}
      >
        {collapsed ? <Flag size={16} /> : 'Milestones unavailable'}
      </div>
    );
  }

  if (milestones.length === 0) {
    return (
      <div
        data-testid="milestone-selector"
        className={cn('text-[11.5px] text-fg-2', collapsed ? 'flex justify-center' : 'px-2')}
      >
        {collapsed ? <Flag size={16} /> : 'No milestones'}
      </div>
    );
  }

  if (collapsed) {
    return (
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            data-testid="milestone-selector"
            title={activeMilestone ? `Milestone: ${activeMilestone.title}` : 'Select milestone'}
            className="flex items-center justify-center w-9 h-9 mx-auto rounded-md text-fg-3 hover:text-fg hover:bg-bg-hover transition-colors"
          >
            <Flag size={16} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="right"
            sideOffset={8}
            className="z-50 min-w-[200px] bg-bg-elev border border-line rounded-lg shadow-lg p-1.5 outline-none"
          >
            <p className="text-[10px] uppercase tracking-wider text-fg-2 px-2 py-1">Milestone</p>
            {milestones.map((m) => (
              <button
                type="button"
                key={m.id}
                onClick={() => {
                  void setActiveNumber(m.number);
                  navigate(`/projects/${slug}`);
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12.5px] transition-colors text-left',
                  m.number === activeNumber
                    ? 'bg-accent-soft text-fg'
                    : 'text-fg-2 hover:text-fg hover:bg-bg-hover',
                )}
              >
                <span className="truncate">
                  {m.title}
                  {m.state === 'closed' ? ' (closed)' : ''}
                </span>
              </button>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  return (
    <div className="px-2">
      <label
        htmlFor="active-milestone"
        className="block text-[10.5px] uppercase tracking-wider text-fg-2 mb-1"
      >
        Milestone
      </label>
      <div className="relative">
        <select
          id="active-milestone"
          data-testid="milestone-selector"
          aria-label="Active milestone"
          value={activeNumber ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            const next = raw === '' ? null : Number(raw);
            void setActiveNumber(next);
            navigate(`/projects/${slug}`);
          }}
          className="appearance-none w-full h-8 pl-3 pr-8 bg-bg border border-line rounded-md text-[12.5px] text-fg focus:outline-none focus:border-accent-line cursor-pointer"
        >
          {milestones.map((m) => (
            <option key={m.id} value={m.number}>
              {m.title}
              {m.state === 'closed' ? ' (closed)' : ''}
            </option>
          ))}
        </select>
        <ChevronDown
          size={13}
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-fg-3"
        />
      </div>
    </div>
  );
}
