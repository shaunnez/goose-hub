export function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-baseline justify-between mb-2">
      <div className="text-[10.5px] uppercase tracking-wider text-fg-2">{title}</div>
      {count != null && <div className="text-[11px] text-fg-2 mono tnum">{count}</div>}
    </div>
  );
}
