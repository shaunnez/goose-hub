import type { WorkItemExternalRefDto } from '@/lib/types';
import { Link2 } from 'lucide-react';

interface ExternalRefsSectionProps {
  refs: WorkItemExternalRefDto[];
}

function labelForRef(ref: WorkItemExternalRefDto): string {
  return `${ref.provider} ${ref.kind.replaceAll('_', ' ')}`;
}

function displayId(ref: WorkItemExternalRefDto): string {
  return ref.repoRef == null ? ref.externalId : `${ref.repoRef} #${ref.externalId}`;
}

function ExternalRefRowContent({ externalRef }: { externalRef: WorkItemExternalRefDto }) {
  return (
    <>
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-line bg-bg-elev-2 text-fg-3 shrink-0">
        <Link2 size={14} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] uppercase tracking-wider text-fg-3">
          {labelForRef(externalRef)}
        </span>
        <span className="block font-mono text-[13px] text-fg truncate">
          {displayId(externalRef)}
        </span>
      </span>
    </>
  );
}

export function ExternalRefsSection({ refs }: ExternalRefsSectionProps) {
  if (refs.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
        <div className="px-4 py-3 border-b border-line bg-bg-elev-2">
          <div className="text-[10.5px] uppercase tracking-wider text-fg-2">External refs</div>
        </div>
        <div className="px-4 py-4 flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-line bg-bg-elev-2 text-fg-3">
            <Link2 size={14} />
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-fg">Local-only</div>
            <div className="text-[12px] text-fg-3">No external tracker or pull request linked</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
      <div className="px-4 py-3 border-b border-line bg-bg-elev-2">
        <div className="text-[10.5px] uppercase tracking-wider text-fg-2">Linked external refs</div>
      </div>
      <div className="divide-y divide-line">
        {refs.map((ref) => {
          return ref.url == null ? (
            <div key={ref.id} className="px-4 py-3 flex items-center gap-3">
              <ExternalRefRowContent externalRef={ref} />
            </div>
          ) : (
            <a
              key={ref.id}
              href={ref.url}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-3 flex items-center gap-3 hover:bg-bg-hover"
            >
              <ExternalRefRowContent externalRef={ref} />
            </a>
          );
        })}
      </div>
    </div>
  );
}
