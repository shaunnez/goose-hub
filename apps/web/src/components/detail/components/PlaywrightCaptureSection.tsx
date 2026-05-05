import { fetchEvents } from '@/lib/api';
import type { AgentEventDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { extractPlaywrightRepro } from '../lib/playwright-capture';

interface PlaywrightCaptureSectionProps {
  projectSlug: string;
  id: string;
  itemType: string;
}

const CONSOLE_ERROR_BADGE: Record<string, string> = {
  error: 'bg-red-500/15 text-red-400',
  warning: 'bg-yellow-500/15 text-yellow-400',
  info: 'bg-blue-500/15 text-blue-400',
};

export function PlaywrightCaptureSection({
  projectSlug,
  id,
  itemType,
}: PlaywrightCaptureSectionProps) {
  const { data: events = [], isLoading } = useQuery<AgentEventDto[]>({
    queryKey: ['events', projectSlug, id],
    queryFn: () => fetchEvents(projectSlug, id),
    enabled: itemType === 'bug',
  });

  if (itemType !== 'bug') {
    return (
      <div
        data-testid="playwright-capture-non-bug"
        className="px-8 py-10 text-center text-fg-3 text-[13px]"
      >
        Screen captures are only available for bug issues.
      </div>
    );
  }

  if (isLoading) {
    return <div className="px-8 py-10 text-center text-fg-3 text-[13px]">Loading captures…</div>;
  }

  const repro = extractPlaywrightRepro(events);

  if (repro == null) {
    return (
      <div
        data-testid="playwright-capture-empty"
        className="px-8 py-10 text-center text-fg-3 text-[13px]"
      >
        Playwright capture has not run yet.
      </div>
    );
  }

  return (
    <div data-testid="playwright-capture-section" className="px-8 py-6 space-y-6">
      {!repro.reproduced && (
        <div
          data-testid="playwright-capture-not-reproduced"
          className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-[12.5px] text-yellow-300"
        >
          <span className="font-semibold">Bug could not be reproduced.</span>
          {repro.notes != null && repro.notes.length > 0 && (
            <span className="ml-2 text-yellow-400/80">Notes: {repro.notes}</span>
          )}
        </div>
      )}

      {repro.reproSteps.length > 0 && (
        <div data-testid="playwright-capture-repro-steps">
          <h3 className="text-[12px] font-semibold text-fg-3 uppercase tracking-wide mb-2">
            Repro Steps
          </h3>
          <ol className="space-y-1 list-decimal list-inside">
            {repro.reproSteps.map((step, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: repro steps are ordered and stable
              <li key={i} className="text-[12.5px] text-fg-2">
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}

      {repro.screenshots.length > 0 && (
        <div data-testid="playwright-capture-screenshots">
          <h3 className="text-[12px] font-semibold text-fg-3 uppercase tracking-wide mb-3">
            Screenshots
          </h3>
          <div className="space-y-4">
            {repro.screenshots.map((shot) => (
              <div
                key={shot.path}
                className="rounded-md border border-line bg-bg-elev p-3 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono bg-bg-glass px-1.5 py-0.5 rounded text-fg-3">
                    step {shot.step}
                  </span>
                  <span className="text-[12.5px] text-fg-2">{shot.caption}</span>
                </div>
                <img
                  src={shot.githubUrl ?? shot.path}
                  alt={shot.caption}
                  className="max-w-full rounded border border-line"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
                {shot.githubUrl == null && (
                  <p className="text-[11px] text-fg-4">
                    Saved to:{' '}
                    <code className="font-mono bg-bg-glass px-1 py-0.5 rounded text-fg-3 break-all">
                      {shot.path}
                    </code>
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {repro.gifPath != null && (
        <div data-testid="playwright-capture-gif">
          <h3 className="text-[12px] font-semibold text-fg-3 uppercase tracking-wide mb-3">
            Walkthrough
          </h3>
          <div className="rounded-md border border-line bg-bg-elev p-3 space-y-2">
            <img
              src={repro.gifPath}
              alt="bug walkthrough"
              className="max-w-full rounded border border-line"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
            <p className="text-[11px] text-fg-4">
              Saved to:{' '}
              <code className="font-mono bg-bg-glass px-1 py-0.5 rounded text-fg-3 break-all">
                {repro.gifPath}
              </code>
            </p>
          </div>
        </div>
      )}

      {repro.commentUrl != null && (
        <div data-testid="playwright-capture-comment-link">
          <a
            href={repro.commentUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-blue-400 underline"
          >
            View on GitHub →
          </a>
        </div>
      )}

      {repro.consoleErrors.length > 0 && (
        <div data-testid="playwright-capture-console-errors">
          <h3 className="text-[12px] font-semibold text-fg-3 uppercase tracking-wide mb-3">
            Console Errors
          </h3>
          <div className="space-y-1.5">
            {repro.consoleErrors.map((err, i) => (
              <div
                key={`${err.type}-${i}`}
                className="flex items-start gap-2 rounded-md border border-line bg-bg-elev px-3 py-2"
              >
                <span
                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 mt-0.5 ${
                    CONSOLE_ERROR_BADGE[err.type] ?? 'bg-gray-500/15 text-gray-400'
                  }`}
                >
                  {err.type}
                </span>
                <div className="min-w-0">
                  <p className="text-[12px] text-fg-2 break-words">{err.message}</p>
                  {err.url != null && err.url.length > 0 && (
                    <p className="text-[11px] text-fg-4 font-mono mt-0.5 break-all">{err.url}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
