import { useActiveProject } from '@/state/active-project';
import { ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ProjectSwitcherSlotProps {
  activeSlug?: string;
}

export function ProjectSwitcherSlot({ activeSlug }: ProjectSwitcherSlotProps) {
  const { projects, loading, error, setActiveSlug } = useActiveProject();
  const navigate = useNavigate();
  const current = projects.find((p) => p.slug === activeSlug) ?? projects[0];

  if (loading) {
    return (
      <div data-testid="project-switcher" className="px-2 text-[11.5px] text-fg-4">
        Loading projects…
      </div>
    );
  }

  if (error != null) {
    return (
      <div data-testid="project-switcher" className="px-2 text-[11.5px] text-[color:var(--danger)]">
        Projects unavailable
      </div>
    );
  }

  if (current == null) {
    return (
      <div data-testid="project-switcher" className="px-2 text-[11.5px] text-fg-4">
        No projects configured
      </div>
    );
  }

  return (
    <div className="px-2">
      <label
        htmlFor="active-project"
        className="block text-[10.5px] uppercase tracking-wider text-fg-4 mb-1"
      >
        Project
      </label>
      <div className="relative">
        <select
          id="active-project"
          data-testid="project-switcher"
          aria-label="Active project"
          value={current.slug}
          onChange={(e) => {
            const next = e.target.value;
            setActiveSlug(next);
            navigate(`/projects/${next}`);
          }}
          className="appearance-none w-full h-8 pl-3 pr-8 bg-bg border border-line rounded-md text-[12.5px] text-fg focus:outline-none focus:border-accent-line cursor-pointer"
          style={{ borderLeft: `3px solid ${current.color}` }}
        >
          {projects.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
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
