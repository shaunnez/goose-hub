import { cn } from '@/lib/cn';
import {
  ChevronLeft,
  ChevronRight,
  Coins,
  Inbox,
  KanbanSquare,
  ListChecks,
  Rocket,
  Settings,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
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
      to: '/interventions',
      label: 'Interventions',
      icon: <ListChecks size={14} />,
      available: true,
    },
    {
      to: `/projects/${project}/roster`,
      label: 'Roster',
      icon: <Users size={14} />,
      available: true,
    },
    {
      to: `/projects/${project}/costs`,
      label: 'Costs',
      icon: <Coins size={14} />,
      available: true,
    },
    {
      to: '/settings',
      label: 'Settings',
      icon: <Settings size={14} />,
      available: true,
    },
  ];
}

function getInitialCollapsed(): boolean {
  try {
    const v = localStorage.getItem('sidebar-collapsed');
    return v === null ? true : v !== 'false';
  } catch {
    return true;
  }
}

interface SidebarProps {
  activeSlug?: string;
}

export function Sidebar({ activeSlug }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);
  const items = buildItems(activeSlug);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem('sidebar-collapsed', String(next));
      } catch {}
      return next;
    });
  }

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        'shrink-0 flex flex-col border-r border-line bg-bg-elev transition-[width] duration-200 overflow-hidden',
        collapsed ? 'w-12' : 'w-[232px]',
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'border-b border-line',
          collapsed ? 'flex justify-center px-2 py-3' : 'px-4 py-3',
        )}
      >
        {collapsed ? (
          <span
            aria-hidden
            className="inline-block w-1.5 h-4 rounded-sm"
            style={{ background: '#7c3aed' }}
          />
        ) : (
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block w-1.5 h-4 rounded-sm"
              style={{ background: '#7c3aed' }}
            />
            <span className="text-[14px] font-semibold tracking-tight whitespace-nowrap">
              Goose Hub
            </span>
          </div>
        )}
      </div>

      {/* Project */}
      <div className={cn('border-b border-line', collapsed ? 'px-1.5 py-2' : 'px-2 py-3')}>
        <ProjectSwitcherSlot activeSlug={activeSlug} collapsed={collapsed} />
      </div>

      {/* Nav */}
      <nav className={cn('flex-1 overflow-y-auto py-3 space-y-0.5', collapsed ? 'px-1.5' : 'px-2')}>
        {items.map((item) => {
          if (!item.available) {
            return (
              <div
                key={item.label}
                title={
                  collapsed
                    ? `${item.label} — available in ${item.milestone}`
                    : `Available in ${item.milestone}`
                }
                className={cn(
                  'flex items-center rounded-md text-fg-2 cursor-not-allowed',
                  collapsed ? 'justify-center w-9 h-9 mx-auto' : 'gap-2 px-2 py-1.5 text-[12.5px]',
                )}
              >
                {item.icon}
                {!collapsed && (
                  <>
                    <span>{item.label}</span>
                    <span className="ml-auto text-[10.5px] uppercase tracking-wider text-fg-2/80">
                      {item.milestone}
                    </span>
                  </>
                )}
              </div>
            );
          }
          return (
            <NavLink
              key={item.label}
              to={item.to}
              end
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex items-center rounded-md transition-colors',
                  collapsed ? 'justify-center w-9 h-9 mx-auto' : 'gap-2 px-2 py-1.5 text-[12.5px]',
                  isActive ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:text-fg hover:bg-bg-hover',
                )
              }
            >
              {item.icon}
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      <div
        className={cn(
          'border-t border-line',
          collapsed ? 'flex justify-center py-2' : 'flex items-center px-3 py-2',
        )}
      >
        <button
          type="button"
          onClick={toggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="text-fg-2 hover:text-fg transition-colors p-1 rounded"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>
    </aside>
  );
}
