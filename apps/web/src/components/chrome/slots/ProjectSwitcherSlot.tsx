import { cn } from '@/lib/cn';
import { useActiveProject } from '@/state/active-project';
import * as Popover from '@radix-ui/react-popover';
import { FolderGit2 } from 'lucide-react';
import { ChevronDown } from 'lucide-react';
import { useMatch, useNavigate } from 'react-router-dom';

interface ProjectSwitcherSlotProps {
  activeSlug?: string;
  collapsed?: boolean;
}

export function ProjectSwitcherSlot({ activeSlug, collapsed }: ProjectSwitcherSlotProps) {
  const { projects, loading, error, setActiveSlug } = useActiveProject();
  const navigate = useNavigate();
  const isAllProjects = useMatch('/projects/all') != null;
  const current =
    projects.find((p) => p.slug === activeSlug) ?? (isAllProjects ? null : projects[0]);

  if (loading) {
    return (
      <div
        data-testid="project-switcher"
        className={cn('text-[11.5px] text-fg-2', collapsed ? 'flex justify-center' : 'px-2')}
      >
        {collapsed ? <FolderGit2 size={16} className="animate-pulse" /> : 'Loading projects…'}
      </div>
    );
  }

  if (error != null) {
    return (
      <div
        data-testid="project-switcher"
        className={cn(
          'text-[11.5px] text-[color:var(--danger)]',
          collapsed ? 'flex justify-center' : 'px-2',
        )}
      >
        {collapsed ? <FolderGit2 size={16} /> : 'Projects unavailable'}
      </div>
    );
  }

  if (!isAllProjects && current == null) {
    return (
      <div
        data-testid="project-switcher"
        className={cn('text-[11.5px] text-fg-2', collapsed ? 'flex justify-center' : 'px-2')}
      >
        {collapsed ? <FolderGit2 size={16} /> : 'No projects configured'}
      </div>
    );
  }

  if (collapsed) {
    return (
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            data-testid="project-switcher"
            title={isAllProjects ? 'All Projects' : `Project: ${current.name}`}
            className="flex items-center justify-center w-9 h-9 mx-auto rounded-md hover:bg-bg-hover transition-colors"
            style={{ color: isAllProjects ? '#6b7280' : current.color }}
          >
            <FolderGit2 size={16} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="right"
            sideOffset={8}
            className="z-50 min-w-[180px] bg-bg-elev border border-line rounded-lg shadow-lg p-1.5 outline-none"
          >
            <p className="text-[10px] uppercase tracking-wider text-fg-2 px-2 py-1">Project</p>
            <button
              type="button"
              onClick={() => {
                setActiveSlug('all');
                navigate('/projects/all');
              }}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12.5px] transition-colors text-left',
                isAllProjects
                  ? 'bg-accent-soft text-fg'
                  : 'text-fg-2 hover:text-fg hover:bg-bg-hover',
              )}
            >
              <span className="w-1.5 h-4 rounded-sm shrink-0" style={{ background: '#6b7280' }} />
              All Projects
            </button>
            {projects.map((p) => (
              <button
                type="button"
                key={p.slug}
                onClick={() => {
                  setActiveSlug(p.slug);
                  navigate(`/projects/${p.slug}`);
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12.5px] transition-colors text-left',
                  !isAllProjects && p.slug === current.slug
                    ? 'bg-accent-soft text-fg'
                    : 'text-fg-2 hover:text-fg hover:bg-bg-hover',
                )}
              >
                <span className="w-1.5 h-4 rounded-sm shrink-0" style={{ background: p.color }} />
                {p.name}
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
        htmlFor="active-project"
        className="block text-[10.5px] uppercase tracking-wider text-fg-2 mb-1"
      >
        Project
      </label>
      <div className="relative">
        <select
          id="active-project"
          data-testid="project-switcher"
          aria-label="Active project"
          value={isAllProjects ? 'all' : current.slug}
          onChange={(e) => {
            const next = e.target.value;
            setActiveSlug(next);
            navigate(next === 'all' ? '/projects/all' : `/projects/${next}`);
          }}
          className="appearance-none w-full h-8 pl-3 pr-8 bg-bg border border-line rounded-md text-[12.5px] text-fg focus:outline-none focus:border-accent-line cursor-pointer"
          style={{
            borderLeft: isAllProjects
              ? '3px solid #6b7280'
              : `3px solid ${current?.color ?? '#6b7280'}`,
          }}
        >
          <option value="all">All Projects</option>
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
