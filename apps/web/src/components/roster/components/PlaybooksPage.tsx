import type { CrossRunRetroOutput } from '@goose-hub/core';
import { useState } from 'react';

interface PlaybookDto {
  id: number;
  projectId: string;
  windowStartAt: string;
  windowEndAt: string;
  manifest: string; // JSON
  createdAt: string;
}

function PlaybookCard({
  playbook,
  isSelected,
  onClick,
}: {
  playbook: PlaybookDto;
  isSelected: boolean;
  onClick: () => void;
}) {
  let manifest: CrossRunRetroOutput | null = null;
  try {
    manifest = JSON.parse(playbook.manifest);
  } catch {
    // Invalid JSON
  }

  const windowStart = new Date(playbook.windowStartAt);
  const windowEnd = new Date(playbook.windowEndAt);
  const createdAt = new Date(playbook.createdAt);

  return (
    <button
      type="button"
      data-testid="playbook-card"
      onClick={onClick}
      className={[
        'w-full text-left px-3 py-3 rounded-md border transition-colors',
        isSelected
          ? 'border-accent bg-accent-soft'
          : 'border-line bg-bg-elev/60 hover:bg-bg-elev hover:border-line',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-[12.5px] font-medium text-fg">
          {windowStart.toLocaleDateString()} → {windowEnd.toLocaleDateString()}
        </span>
        <span className="text-[11px] font-mono text-fg-2 shrink-0">
          {manifest?.lifecycleCount ?? 0} runs
        </span>
      </div>
      <div className="text-[10.5px] text-fg-5 mb-2">{createdAt.toLocaleString()}</div>
      {manifest?.topPatterns && manifest.topPatterns.length > 0 && (
        <div className="text-[10px] text-fg-4 mb-1">
          Top pattern: {manifest.topPatterns[0]?.pattern}
        </div>
      )}
    </button>
  );
}

export function PlaybooksPage({ playbooks = [] }: { playbooks: PlaybookDto[] }) {
  const [selectedPlaybook, setSelectedPlaybook] = useState<PlaybookDto | null>(null);

  return (
    <div data-testid="playbooks-page" className="flex gap-8 h-full">
      <div className="flex-1 overflow-y-auto space-y-4 pr-4">
        <div>
          <h2 className="text-[14px] font-semibold text-fg mb-4">Playbooks</h2>
        </div>

        {playbooks.length === 0 && (
          <div
            data-testid="playbooks-empty-state"
            className="text-center text-fg-3 text-[13px] py-16"
          >
            <p className="mb-2 font-medium text-fg-2">No playbooks yet</p>
            <p>Playbooks are generated from archived lifecycles.</p>
          </div>
        )}

        {playbooks.length > 0 && (
          <div className="flex flex-col gap-3">
            {playbooks.map((pb) => (
              <PlaybookCard
                key={pb.id}
                playbook={pb}
                isSelected={selectedPlaybook?.id === pb.id}
                onClick={() => setSelectedPlaybook(pb)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Drill-in panel */}
      {selectedPlaybook && (
        <div className="w-96 overflow-y-auto border-l border-line pl-8 pr-4 py-4">
          <button
            type="button"
            onClick={() => setSelectedPlaybook(null)}
            className="text-[12px] text-fg-2 hover:text-fg mb-4 underline"
          >
            ← Back
          </button>

          {/* Render playbook manifest details here */}
          <div className="space-y-4">
            <h3 className="text-[13px] font-medium text-fg">Playbook Details</h3>
            <pre className="text-[10px] bg-bg-elev p-2 rounded overflow-auto max-h-96">
              {JSON.stringify(JSON.parse(selectedPlaybook.manifest), null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
