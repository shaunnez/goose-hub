import { SectionEmptyState } from './SectionEmptyState';

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
      className="h-full flex flex-col items-center justify-center px-8 py-6"
    >
      <SectionEmptyState
        title={`Available in ${milestone}`}
        subtitle={
          <>
            <span className="uppercase tracking-wider text-[10.5px] text-fg-5">{surface}</span>
            {description != null && (
              <span className="block mt-1 text-[12px] text-fg-4">{description}</span>
            )}
          </>
        }
      />
    </div>
  );
}
