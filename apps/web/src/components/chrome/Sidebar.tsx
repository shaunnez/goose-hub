import { cn } from '@/lib/cn';
import { Inbox, KanbanSquare, ListChecks, Rocket, Settings, Users } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { MilestoneSelectorSlot } from './slots/MilestoneSelectorSlot';
import { ProjectSwitcherSlot } from './slots/ProjectSwitcherSlot';

interface SidebarItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  available: boolean;
  milestone?: string;
}

function buildItems(slug: string | undefined): SidebarItem[] {
  const project = slug ?? 'goose-hub-self';
  return [
    {
      to: `/projects/${project}`,
      label: 'Kanban',
      icon: <KanbanSquare size={14} />,
      available: true,
    },
    {
      to: `/projects/${project}/inbox`,
      label: 'Inbox',
      icon: <Inbox size={14} />,
      available: true,
    },
    {
      to: `/projects/${project}/roster`,
      label: 'Roster',
      icon: <Users size={14} />,
      available: false,
      milestone: 'M5',
    },
    {
      to: `/projects/${project}/milestones`,
      label: 'Milestones',
      icon: <ListChecks size={14} />,
      available: false,
      milestone: 'later',
    },
    {
      to: `/projects/${project}/settings`,
      label: 'Settings',
      icon: <Settings size={14} />,
      available: false,
      milestone: 'later',
    },
    {
      to: `/projects/${project}/bootstrap`,
      label: 'Bootstrap',
      icon: <Rocket size={14} />,
      available: false,
      milestone: 'M12',
    },
  ];
}

interface SidebarProps {
  activeSlug?: string;
}

export function Sidebar({ activeSlug }: SidebarProps) {
  const items = buildItems(activeSlug);
  return (
    <aside
      data-testid="sidebar"
      className="w-[232px] shrink-0 flex flex-col border-r border-line bg-bg-elev"
    >
      <div className="px-4 py-3 border-b border-line">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block w-1.5 h-4 rounded-sm"
            style={{ background: '#7c3aed' }}
          />
          <span className="text-[14px] font-semibold tracking-tight">Goose Hub</span>
        </div>
      </div>

      <div className="px-2 py-3 border-b border-line space-y-3">
        <ProjectSwitcherSlot activeSlug={activeSlug} />
        <MilestoneSelectorSlot activeSlug={activeSlug} />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {items.map((item) => {
          if (!item.available) {
            return (
              <div
                key={item.label}
                title={`Available in ${item.milestone}`}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md text-[12.5px] text-fg-4 cursor-not-allowed"
              >
                {item.icon}
                <span>{item.label}</span>
                <span className="ml-auto text-[10.5px] uppercase tracking-wider text-fg-4/80">
                  {item.milestone}
                </span>
              </div>
            );
          }
          return (
            <NavLink
              key={item.label}
              to={item.to}
              end
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded-md text-[12.5px] transition-colors',
                  isActive ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:text-fg hover:bg-bg-hover',
                )
              }
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="px-3 py-2 border-t border-line text-[11px] text-fg-4">
        Local-first · M2 preview
      </div>
    </aside>
  );
}
