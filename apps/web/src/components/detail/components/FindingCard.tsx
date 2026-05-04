import { Code } from 'lucide-react';
import { SEV_LABEL, SEV_VAR } from '../lib/investigation';

interface FindingCardProps {
  severity: 'low' | 'medium' | 'high';
  title: string;
  body: React.ReactNode;
  filePath?: string;
  conf: number;
  personaInitials?: string | null;
  personaName?: string | null;
}

export function FindingCard({
  severity,
  title,
  body,
  filePath,
  conf,
  personaInitials,
  personaName,
}: FindingCardProps) {
  const sevColor = SEV_VAR[severity];
  return (
    <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
      <div className="grid" style={{ gridTemplateColumns: '4px 1fr', minHeight: 90 }}>
        <div style={{ background: sevColor }} />
        <div className="p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wider border"
              style={{
                color: sevColor,
                background: `oklch(from ${sevColor} l c h / 0.1)`,
                borderColor: `oklch(from ${sevColor} l c h / 0.4)`,
              }}
            >
              {SEV_LABEL[severity]}
            </span>
            <span className="text-[14px] font-semibold text-fg">{title}</span>
          </div>
          <div className="text-[13px] text-fg-2 leading-relaxed">{body}</div>
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            {filePath != null && (
              <span className="font-mono text-[11.5px] text-fg-3">{filePath}</span>
            )}
            {filePath != null && <span className="w-px h-3 bg-line" />}
            {personaInitials != null && (
              <span className="flex items-center gap-1.5 text-[11.5px]">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent-soft text-[9.5px] font-semibold text-[color:var(--accent)]">
                  {personaInitials}
                </span>
                <span className="text-fg-3">{personaName}</span>
              </span>
            )}
            <span className="grow" />
            <span className="flex items-center gap-2 text-[11px]">
              <span className="text-fg-4">conf</span>
              <span className="block w-[60px] h-1 rounded-sm bg-line overflow-hidden">
                <span
                  className="block h-full rounded-sm"
                  style={{ width: `${conf * 100}%`, background: 'var(--accent)' }}
                />
              </span>
              <span className="font-mono tnum text-fg-3">{conf.toFixed(2)}</span>
            </span>
            {filePath != null && (
              <button
                type="button"
                className="inline-flex items-center gap-1 h-6 px-2 rounded border border-line text-[11px] text-fg-3 hover:text-fg hover:bg-bg-hover"
              >
                <Code size={11} />
                View
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
