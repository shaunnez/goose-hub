// Top HUD bar — three-card layout matching the canonical mockup:
//   [GOOSE HUB · project · status] [QA FAILURE alert] [TICKETS · LOAD]
// Phase 9b: rewritten from a slim one-line bar into a 96-px tall row of
// three framed cards so the canvas frame reads as proper ops console.

interface TopHudBarProps {
  projectName: string;
  ticketCount: number;
  activeCount: number;
  blockedCount: number;
  alert?: {
    tone: 'danger' | 'warning';
    title: string;
    detail: string;
    breadcrumb?: string;
  } | null;
}

export function TopHudBar({
  projectName,
  ticketCount,
  activeCount,
  blockedCount,
  alert,
}: TopHudBarProps) {
  const alertClass =
    alert == null
      ? 'bg-[#05030acc] border-amber-500/30'
      : alert.tone === 'warning'
        ? 'bg-[#1a1206cc] border-amber-500/50'
        : 'bg-[#1a0606cc] border-red-500/50';
  const alertIconClass =
    alert?.tone === 'warning'
      ? 'bg-amber-900/60 border-amber-500/60 text-amber-200'
      : 'bg-red-900/60 border-red-500/60 text-red-200';
  const alertTitleClass = alert?.tone === 'warning' ? 'text-amber-300' : 'text-red-300';

  return (
    <div
      data-testid="office-top-hud"
      className="absolute top-0 left-0 right-44 h-24 flex items-stretch gap-2 p-2 pointer-events-none z-30 font-mono"
    >
      {/* Left card — project identity */}
      <div className="flex items-center gap-3 px-4 py-2 bg-[#05030acc] border border-amber-500/30 rounded-sm min-w-[260px]">
        <div className="w-10 h-10 rounded-sm bg-amber-900/30 border border-amber-500/40 flex items-center justify-center text-2xl leading-none">
          🦢
        </div>
        <div className="flex flex-col leading-tight">
          <div className="text-amber-300 font-bold text-[13px] tracking-wider">GOOSE HUB</div>
          <div className="text-[10px] text-fg-3">
            PROJECT: <span className="text-fg-2">{projectName}</span>
          </div>
          <div className="text-[10px] text-fg-3">
            STATE: <span className="text-emerald-400">{activeCount} active</span>
          </div>
        </div>
      </div>

      {/* Centre card — alert / status banner */}
      <div className={`flex-1 flex items-center px-4 py-2 border rounded-sm min-w-0 ${alertClass}`}>
        {alert != null ? (
          <>
            <div
              className={`w-8 h-8 rounded-sm border flex items-center justify-center text-lg flex-shrink-0 ${alertIconClass}`}
            >
              ⚠
            </div>
            <div className="ml-3 flex flex-col leading-tight min-w-0">
              <div className={`${alertTitleClass} font-bold text-[13px] tracking-wider`}>
                {alert.title}
              </div>
              <div className="text-[11px] text-fg-2 truncate">{alert.detail}</div>
              {alert.breadcrumb != null && (
                <div className="text-[10px] text-cyan-400 truncate">{alert.breadcrumb}</div>
              )}
            </div>
            <button
              type="button"
              className="ml-auto px-3 py-1.5 text-[10px] text-amber-200 border border-amber-500/40 rounded-sm pointer-events-auto hover:bg-amber-500/10"
            >
              VIEW TICKET
            </button>
          </>
        ) : (
          <div className="flex-1 text-center text-fg-3 text-[11px] italic">
            Live office view · no blocked or failed work items
          </div>
        )}
      </div>

      {/* Right card — metrics */}
      <div className="flex items-center gap-6 px-4 py-2 bg-[#05030acc] border border-amber-500/30 rounded-sm min-w-[260px]">
        <Metric label="VISIBLE WORK" value={String(ticketCount)} icon="📋" />
        <Metric label="BLOCKED" value={String(blockedCount)} />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
  rightAdornment,
}: {
  label: string;
  value: string;
  icon?: string;
  rightAdornment?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[9px] text-fg-3 tracking-wide">{label}</span>
      <div className="flex items-center mt-0.5">
        <span className="text-amber-200 font-bold text-[18px]">{value}</span>
        {icon != null && <span className="ml-2 text-base">{icon}</span>}
        {rightAdornment}
      </div>
    </div>
  );
}
