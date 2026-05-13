// Out-of-canvas overlay showing the current floor number, project name, and
// up/down navigation buttons. Lives in plain DOM so it stays accessible
// (screen-reader-friendly) even though the underlying canvas is opaque.

import { ChevronDown, ChevronUp } from 'lucide-react';

interface FloorIndicatorProps {
  floorIndex: number;
  totalFloors: number;
  projectName: string;
  onUp: () => void;
  onDown: () => void;
}

export function FloorIndicator({
  floorIndex,
  totalFloors,
  projectName,
  onUp,
  onDown,
}: FloorIndicatorProps) {
  const upDisabled = floorIndex === 0;
  const downDisabled = floorIndex >= totalFloors - 1;
  return (
    <div
      data-testid="office-floor-indicator"
      className="absolute right-3 top-3 z-10 flex flex-col items-stretch rounded-md border border-line bg-bg-elev/95 backdrop-blur shadow-lg overflow-hidden"
    >
      <button
        type="button"
        onClick={onUp}
        disabled={upDisabled}
        className="flex items-center justify-center px-2 py-1 text-fg-2 hover:text-fg hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Previous floor"
      >
        <ChevronUp size={14} />
      </button>
      <div className="px-3 py-1 border-y border-line text-center">
        <div className="text-[10px] uppercase tracking-wider text-fg-3">Floor</div>
        <div className="font-mono text-[14px] tabular-nums text-fg">
          {floorIndex + 1}
          <span className="text-fg-3">/{Math.max(totalFloors, 1)}</span>
        </div>
        <div className="text-[11px] text-fg-2 max-w-[140px] truncate" title={projectName}>
          {projectName}
        </div>
      </div>
      <button
        type="button"
        onClick={onDown}
        disabled={downDisabled}
        className="flex items-center justify-center px-2 py-1 text-fg-2 hover:text-fg hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Next floor"
      >
        <ChevronDown size={14} />
      </button>
    </div>
  );
}
