// Bottom HUD bar — hero ticket card, team counters, state legend.
// Placeholder shell for Phase 4. Hero card pulls from props (real data when
// available); team counters derive from active persona placements.

interface HeroCard {
  externalId: string;
  title: string;
  fromRoom: string;
  toRoom: string;
}

export interface TeamCounts {
  scout: number;
  dev: number;
  qa: number;
  reviewer: number;
  ops: number;
}

interface BottomHudBarProps {
  hero: HeroCard | null;
  team: TeamCounts;
}

export function BottomHudBar({ hero, team }: BottomHudBarProps) {
  return (
    <div
      data-testid="office-bottom-hud"
      className="absolute bottom-0 left-0 right-44 h-20 flex items-stretch px-4 gap-6 bg-[#050309ee] border-t border-amber-500/30 z-30 font-mono text-[11px] text-fg-2 pointer-events-none"
    >
      <div className="flex-1 flex items-center gap-3 min-w-0">
        {hero != null ? (
          <>
            <span className="text-amber-400 font-bold tracking-wider">HERO</span>
            <div className="min-w-0">
              <div className="truncate">
                <span className="text-fg-3">#{hero.externalId}</span>{' '}
                <span className="text-amber-100">{hero.title}</span>
              </div>
              <div className="text-fg-3 text-[10px]">
                {hero.fromRoom} <span className="text-amber-400">→</span> {hero.toRoom}
              </div>
            </div>
          </>
        ) : (
          <span className="text-fg-3 italic">No hero ticket</span>
        )}
      </div>
      <div className="flex items-center gap-4">
        <span className="text-amber-400 font-bold tracking-wider">TEAM</span>
        <Counter label="SCOUT" n={team.scout} />
        <Counter label="DEV" n={team.dev} />
        <Counter label="QA" n={team.qa} />
        <Counter label="REVIEWER" n={team.reviewer} />
        <Counter label="OPS" n={team.ops} />
      </div>
      <div className="flex items-center gap-3 text-[10px]">
        <Legend dot="bg-emerald-400" label="Normal" />
        <Legend dot="bg-amber-400" label="High" />
        <Legend dot="bg-red-400" label="Blocked" />
      </div>
    </div>
  );
}

function Counter({ label, n }: { label: string; n: number }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[9px] text-fg-3">{label}</span>
      <span className="font-bold text-amber-100 text-[12px]">{n}</span>
    </div>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot}`} />
      <span className="text-fg-3">{label}</span>
    </div>
  );
}
