export function KindChip({ kind }: { kind: string }) {
  return (
    <span className="font-mono text-[10px] tracking-wider px-1.5 py-0.5 rounded bg-bg-elev-2 text-[color:var(--accent)]">
      {kind}
    </span>
  );
}
