export function RightRail() {
  return (
    <aside
      data-testid="detail-right-rail"
      className="w-[260px] shrink-0 flex flex-col border-l border-line bg-bg-elev/40"
    >
      <div className="px-4 py-3 border-b border-line">
        <div className="text-[10.5px] uppercase tracking-wider text-fg-4">Live activity</div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-6 text-[12px] text-fg-3 leading-relaxed">
        <div className="rounded-md border border-line bg-bg p-3">
          <div className="text-fg-2 mb-1.5">No agent runs yet</div>
          <p className="text-[11.5px] text-fg-3">
            The runtime that spawns agents arrives in M4. Once it does, this rail will stream tool
            calls and decision summaries from the running personas.
          </p>
        </div>
      </div>
      <div className="px-4 py-3 border-t border-line text-[10.5px] uppercase tracking-wider text-fg-4">
        Personas
      </div>
      <div className="px-4 pb-4 text-[11.5px] text-fg-3">Persona roster lights up in M5.</div>
    </aside>
  );
}
