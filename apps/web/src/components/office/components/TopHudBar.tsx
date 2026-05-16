// Top HUD bar — project name, alert slot, ticket count, system load.
// Placeholder shell for Phase 4; subsequent phases will wire alerts and a
// real load metric.

interface TopHudBarProps {
  projectName: string;
  ticketCount: number;
  systemLoadPct: number;
  alert?: string | null;
}

export function TopHudBar({ projectName, ticketCount, systemLoadPct, alert }: TopHudBarProps) {
  return (
    <div
      data-testid="office-top-hud"
      className="absolute top-0 left-0 right-44 h-12 flex items-center px-4 gap-4 bg-[#050309ee] border-b border-amber-500/30 z-30 font-mono text-[11px] text-fg-2 pointer-events-none"
    >
      <div className="flex items-center gap-3">
        <span className="text-amber-400 font-bold tracking-wider">GOOSE HUB</span>
        <span className="text-fg-3">/</span>
        <span>{projectName}</span>
        <span className="px-2 py-0.5 rounded bg-emerald-700/40 text-emerald-300 text-[10px]">
          IN PROGRESS
        </span>
      </div>
      <div className="flex-1 flex justify-center">
        {alert != null && alert.length > 0 && (
          <span className="px-3 py-1 rounded bg-red-900/60 text-red-200 text-[10px] font-bold tracking-wide">
            ⚠ {alert}
          </span>
        )}
      </div>
      <div className="flex items-center gap-5">
        <span>
          <span className="text-fg-3">TICKETS </span>
          <span className="text-amber-200 font-bold">{ticketCount}</span>
        </span>
        <span>
          <span className="text-fg-3">LOAD </span>
          <span className="text-amber-200 font-bold">{systemLoadPct}%</span>
          <span className="ml-2 inline-block w-16 h-1.5 bg-fg-3/20 rounded align-middle overflow-hidden">
            <span
              className="block h-full bg-amber-400/70"
              style={{ width: `${Math.min(100, Math.max(0, systemLoadPct))}%` }}
            />
          </span>
        </span>
      </div>
    </div>
  );
}
