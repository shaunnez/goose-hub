interface ProjectSwitcherSlotProps {
  activeSlug?: string;
}

/**
 * Placeholder slot for the ProjectSwitcher component (M2.04 / #29). Renders a
 * stub label until #29 lands the real switcher.
 */
export function ProjectSwitcherSlot({ activeSlug }: ProjectSwitcherSlotProps) {
  return (
    <div
      data-testid="project-switcher-slot"
      className="px-2 text-[11px] uppercase tracking-wider text-fg-4"
    >
      Project · {activeSlug ?? 'goose-hub-self'}
    </div>
  );
}
