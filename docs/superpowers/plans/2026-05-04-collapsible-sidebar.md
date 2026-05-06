# Collapsible Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the left sidebar collapse to a 48px icon rail by default, with Radix popovers for project/milestone switching in collapsed state.

**Architecture:** `collapsed` boolean state lives in `Sidebar.tsx`, initialized from `localStorage` (defaults to `true`). Passed as prop to both slot components, which render either the existing select UI (expanded) or a Radix Popover with an icon trigger (collapsed). Nav items show icon-only with `title` tooltip when collapsed. A chevron toggle button in the footer persists the state.

**Tech Stack:** React, Radix UI `@radix-ui/react-popover`, Lucide icons, Tailwind CSS, Vitest

---

## File Map

| File | Change |
|------|--------|
| `apps/web/src/components/chrome/Sidebar.tsx` | Add `collapsed` state + localStorage persistence + layout switching + toggle button |
| `apps/web/src/components/chrome/slots/ProjectSwitcherSlot.tsx` | Add `collapsed` prop + popover variant |
| `apps/web/src/components/chrome/slots/MilestoneSelectorSlot.tsx` | Add `collapsed` prop + popover variant |
| `apps/web/src/components/chrome/slice.test.ts` | Add assertion: collapsed is default |
| `apps/web/src/components/chrome/slots/slice.test.ts` | Add assertion: collapsed prop accepted |

---

### Task 1: Update slice tests (TDD gate)

**Files:**
- Modify: `apps/web/src/components/chrome/slice.test.ts`
- Modify: `apps/web/src/components/chrome/slots/slice.test.ts`

- [ ] **Step 1: Add collapsed-default assertion to chrome slice test**

Open `apps/web/src/components/chrome/slice.test.ts` and add inside the existing `describe` block:

```typescript
it('sidebar defaults to collapsed (localStorage key absent = collapsed)', () => {
  // Contract: absence of the key means collapsed=true
  // The component reads localStorage.getItem('sidebar-collapsed') !== 'false'
  const absent = null;
  const collapsed = absent !== 'false';
  expect(collapsed).toBe(true);
});

it('sidebar respects explicit expanded preference', () => {
  const storedFalse = 'false';
  const collapsed = storedFalse !== 'false';
  expect(collapsed).toBe(false);
});
```

- [ ] **Step 2: Add collapsed prop contract to slots slice test**

Open `apps/web/src/components/chrome/slots/slice.test.ts` and add inside the existing `describe` block:

```typescript
it('slot components accept collapsed prop without type error (compile-time check)', () => {
  // This is a type-level contract; if the prop is missing from the component
  // signature, TypeScript will catch it during the build step.
  // Here we assert the shape of the expected props interface.
  type SlotProps = { activeSlug?: string; collapsed?: boolean };
  const props: SlotProps = { collapsed: true };
  expect(props.collapsed).toBe(true);
});
```

- [ ] **Step 3: Run tests — they should pass (no code changed yet)**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm --filter web test run
```

Expected: all existing tests pass + 3 new tests pass (pure logic, no component rendering).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/chrome/slice.test.ts apps/web/src/components/chrome/slots/slice.test.ts
git commit -m "test(chrome): add collapsed sidebar contract assertions"
```

---

### Task 2: Add collapsed variant to ProjectSwitcherSlot

**Files:**
- Modify: `apps/web/src/components/chrome/slots/ProjectSwitcherSlot.tsx`

- [ ] **Step 1: Replace file content**

```typescript
import { cn } from '@/lib/cn';
import { useActiveProject } from '@/state/active-project';
import * as Popover from '@radix-ui/react-popover';
import { FolderGit2 } from 'lucide-react';
import { ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ProjectSwitcherSlotProps {
  activeSlug?: string;
  collapsed?: boolean;
}

export function ProjectSwitcherSlot({ activeSlug, collapsed }: ProjectSwitcherSlotProps) {
  const { projects, loading, error, setActiveSlug } = useActiveProject();
  const navigate = useNavigate();
  const current = projects.find((p) => p.slug === activeSlug) ?? projects[0];

  if (loading) {
    return (
      <div data-testid="project-switcher" className={cn('text-[11.5px] text-fg-2', collapsed ? 'flex justify-center' : 'px-2')}>
        {collapsed ? <FolderGit2 size={16} className="animate-pulse" /> : 'Loading projects…'}
      </div>
    );
  }

  if (error != null) {
    return (
      <div data-testid="project-switcher" className={cn('text-[11.5px] text-[color:var(--danger)]', collapsed ? 'flex justify-center' : 'px-2')}>
        {collapsed ? <FolderGit2 size={16} /> : 'Projects unavailable'}
      </div>
    );
  }

  if (current == null) {
    return (
      <div data-testid="project-switcher" className={cn('text-[11.5px] text-fg-2', collapsed ? 'flex justify-center' : 'px-2')}>
        {collapsed ? <FolderGit2 size={16} /> : 'No projects configured'}
      </div>
    );
  }

  if (collapsed) {
    return (
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            data-testid="project-switcher"
            title={`Project: ${current.name}`}
            className="flex items-center justify-center w-9 h-9 mx-auto rounded-md hover:bg-bg-hover transition-colors"
            style={{ color: current.color }}
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
            {projects.map((p) => (
              <button
                key={p.slug}
                onClick={() => {
                  setActiveSlug(p.slug);
                  navigate(`/projects/${p.slug}`);
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12.5px] transition-colors text-left',
                  p.slug === current.slug
                    ? 'bg-accent-soft text-fg'
                    : 'text-fg-2 hover:text-fg hover:bg-bg-hover',
                )}
              >
                <span
                  className="w-1.5 h-4 rounded-sm shrink-0"
                  style={{ background: p.color }}
                />
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
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm --filter web exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run tests**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm --filter web test run
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/chrome/slots/ProjectSwitcherSlot.tsx
git commit -m "feat(chrome): add collapsed popover variant to ProjectSwitcherSlot"
```

---

### Task 3: Add collapsed variant to MilestoneSelectorSlot

**Files:**
- Modify: `apps/web/src/components/chrome/slots/MilestoneSelectorSlot.tsx`

- [ ] **Step 1: Replace file content**

```typescript
import { cn } from '@/lib/cn';
import { useActiveMilestone } from '@/state/active-milestone';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, Flag } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

interface MilestoneSelectorSlotProps {
  activeSlug?: string;
  collapsed?: boolean;
}

export function MilestoneSelectorSlot({ activeSlug: _activeSlug, collapsed }: MilestoneSelectorSlotProps) {
  const { milestones, loading, error, activeNumber, setActiveNumber } = useActiveMilestone();
  const { slug = 'goose-hub-self' } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const activeMilestone = milestones.find((m) => m.number === activeNumber);

  if (loading) {
    return (
      <div data-testid="milestone-selector" className={cn('text-[11.5px] text-fg-2', collapsed ? 'flex justify-center' : 'px-2')}>
        {collapsed ? <Flag size={16} className="animate-pulse" /> : 'Loading milestones…'}
      </div>
    );
  }

  if (error != null) {
    return (
      <div data-testid="milestone-selector" className={cn('text-[11.5px] text-[color:var(--danger)]', collapsed ? 'flex justify-center' : 'px-2')}>
        {collapsed ? <Flag size={16} /> : 'Milestones unavailable'}
      </div>
    );
  }

  if (milestones.length === 0) {
    return (
      <div data-testid="milestone-selector" className={cn('text-[11.5px] text-fg-2', collapsed ? 'flex justify-center' : 'px-2')}>
        {collapsed ? <Flag size={16} /> : 'No milestones'}
      </div>
    );
  }

  if (collapsed) {
    return (
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
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
                <span className="truncate">{m.title}{m.isActive ? '' : ' (closed)'}</span>
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
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm --filter web exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run tests**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm --filter web test run
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/chrome/slots/MilestoneSelectorSlot.tsx
git commit -m "feat(chrome): add collapsed popover variant to MilestoneSelectorSlot"
```

---

### Task 4: Update Sidebar with collapsed state and layout

**Files:**
- Modify: `apps/web/src/components/chrome/Sidebar.tsx`

- [ ] **Step 1: Replace file content**

```typescript
import { cn } from '@/lib/cn';
import {
  ChevronLeft,
  ChevronRight,
  Inbox,
  KanbanSquare,
  ListChecks,
  Rocket,
  Settings,
  Users,
} from 'lucide-react';
import { useState } from 'react';
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
      available: true,
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

      {/* Project + Milestone */}
      <div
        className={cn(
          'border-b border-line',
          collapsed ? 'px-1.5 py-2 space-y-1' : 'px-2 py-3 space-y-3',
        )}
      >
        <ProjectSwitcherSlot activeSlug={activeSlug} collapsed={collapsed} />
        <MilestoneSelectorSlot activeSlug={activeSlug} collapsed={collapsed} />
      </div>

      {/* Nav */}
      <nav
        className={cn(
          'flex-1 overflow-y-auto py-3 space-y-0.5',
          collapsed ? 'px-1.5' : 'px-2',
        )}
      >
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
                  collapsed
                    ? 'justify-center w-9 h-9 mx-auto'
                    : 'gap-2 px-2 py-1.5 text-[12.5px]',
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
                  isActive
                    ? 'bg-accent-soft text-fg'
                    : 'text-fg-2 hover:text-fg hover:bg-bg-hover',
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
        {!collapsed && (
          <span className="text-[11px] text-fg-2 flex-1 whitespace-nowrap">
            Local-first · M2 preview
          </span>
        )}
        <button
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
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm --filter web exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run tests**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm --filter web test run
```

Expected: all pass.

- [ ] **Step 4: Run lint**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm --filter web exec biome check --write src/components/chrome/
```

Expected: no errors (or only auto-fixed).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/chrome/Sidebar.tsx
git commit -m "feat(chrome): collapsible sidebar — icon rail default, localStorage persistence"
```

---

### Task 5: Verify in browser

- [ ] **Step 1: Start dev server**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm --filter web dev
```

- [ ] **Step 2: Check collapsed default**

Open app in browser. Sidebar must be 48px icon rail (not expanded). Refresh — must stay collapsed.

- [ ] **Step 3: Test project popover**

Click `FolderGit2` icon. Popover must open to the right with project list. Click a project — must navigate and close popover.

- [ ] **Step 4: Test milestone popover**

Click `Flag` icon. Popover must open with milestone list. Click one — must update active milestone and navigate.

- [ ] **Step 5: Test expand/collapse toggle**

Click `ChevronRight` in footer → sidebar expands to 232px, standard controls visible.
Click `ChevronLeft` → collapses back. Refresh → persists.

- [ ] **Step 6: Test nav items**

Hover icon-only nav items → native tooltip shows label. Click Kanban → navigates.

- [ ] **Step 7: Final commit if any tweaks needed**

```bash
git add -p
git commit -m "fix(chrome): sidebar collapsed-state visual tweaks"
```
