interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  /** Optional CSS color for the value. Defaults to `var(--fg)`. */
  color?: string;
}

export function StatCard({ label, value, sub, color }: StatCardProps) {
  return (
    <div className="rounded-lg border border-line bg-bg-elev px-4 py-3">
      <div className="text-[10.5px] uppercase tracking-wider text-fg-2 mb-1.5">{label}</div>
      <div
        className="text-[14px] font-semibold leading-none tracking-tight"
        style={{ color: color ?? 'var(--fg)' }}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-fg-2 mt-1">{sub}</div>}
    </div>
  );
}
