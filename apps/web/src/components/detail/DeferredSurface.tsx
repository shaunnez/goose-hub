interface DeferredSurfaceProps {
  surface: string;
  milestone: string;
  description?: string;
}

export function DeferredSurface({ surface, milestone, description }: DeferredSurfaceProps) {
  return (
    <div
      data-testid="deferred-surface"
      data-milestone={milestone}
      className="h-full flex flex-col items-center justify-center text-center px-8"
    >
      <div className="text-[11px] uppercase tracking-wider text-fg-4 mb-3">{surface}</div>
      <div className="text-fg-2 text-[14px] mb-2">Available in {milestone}</div>
      {description != null && (
        <p className="text-fg-3 text-[12.5px] max-w-md leading-relaxed">{description}</p>
      )}
    </div>
  );
}
