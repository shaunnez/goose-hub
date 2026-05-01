import { useActiveMilestone } from '@/state/active-milestone';
import { ChevronDown } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

interface MilestoneSelectorSlotProps {
  activeSlug?: string;
}

export function MilestoneSelectorSlot({ activeSlug: _activeSlug }: MilestoneSelectorSlotProps) {
  const { milestones, loading, error, activeNumber, setActiveNumber } = useActiveMilestone();
  const { slug = 'goose-hub-self' } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div data-testid="milestone-selector" className="px-2 text-[11.5px] text-fg-4">
        Loading milestones…
      </div>
    );
  }

  if (error != null) {
    return (
      <div
        data-testid="milestone-selector"
        className="px-2 text-[11.5px] text-[color:var(--danger)]"
      >
        Milestones unavailable
      </div>
    );
  }

  if (milestones.length === 0) {
    return (
      <div data-testid="milestone-selector" className="px-2 text-[11.5px] text-fg-4">
        No milestones
      </div>
    );
  }

  return (
    <div className="px-2">
      <label
        htmlFor="active-milestone"
        className="block text-[10.5px] uppercase tracking-wider text-fg-4 mb-1"
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
              {m.isActive ? '' : ' (closed)'}
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
