interface MilestoneSelectorSlotProps {
  activeSlug?: string;
}

/**
 * Placeholder slot for the MilestoneSelector component (M2.05 / #30). Renders a
 * stub label until #30 lands the real selector.
 */
export function MilestoneSelectorSlot({ activeSlug: _activeSlug }: MilestoneSelectorSlotProps) {
  return (
    <div
      data-testid="milestone-selector-slot"
      className="px-2 text-[11px] uppercase tracking-wider text-fg-4"
    >
      Milestone · all
    </div>
  );
}
