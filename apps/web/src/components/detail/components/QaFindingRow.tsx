import type { Disposition, Finding } from '../lib/qa';
import { severityColor } from '../lib/qa';

interface QaFindingRowProps {
  finding: Finding;
  tier: 'structural' | 'functional' | 'regression';
}

function dispositionLabel(disposition: Disposition, dispositionRef?: string): string {
  if (disposition === 'fixed') return 'fixed';
  if (disposition === 'out-of-scope') return 'out-of-scope';
  // registered
  return dispositionRef != null && dispositionRef.length > 0
    ? `registered ${dispositionRef.startsWith('#') ? dispositionRef : `#${dispositionRef}`}`
    : 'registered';
}

function dispositionTone(disposition: Disposition): { fg: string; bg: string } {
  if (disposition === 'fixed')
    return { fg: 'var(--success)', bg: 'oklch(from var(--success) l c h / 0.12)' };
  if (disposition === 'registered')
    return { fg: 'var(--info)', bg: 'oklch(from var(--info) l c h / 0.12)' };
  // out-of-scope
  return { fg: 'var(--fg-3)', bg: 'var(--bg-elev-2)' };
}

export function QaFindingRow({ finding, tier }: QaFindingRowProps) {
  return (
    <div className="px-4 py-3 border-t border-line first:border-t-0 text-[12.5px]">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide"
          style={{
            color: severityColor(finding.severity),
            background: `oklch(from ${severityColor(finding.severity)} l c h / 0.12)`,
          }}
        >
          {finding.severity}
        </span>
        <span className="text-[11px] text-fg-4 capitalize">{tier}</span>
        {finding.disposition != null && (
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium tracking-wide"
            data-testid="qa-finding-disposition"
            style={{
              color: dispositionTone(finding.disposition).fg,
              background: dispositionTone(finding.disposition).bg,
            }}
          >
            {dispositionLabel(finding.disposition, finding.dispositionRef)}
          </span>
        )}
        {finding.file && (
          <span className="mono text-[10.5px] text-fg-3 bg-bg-elev-2 px-1.5 py-0.5 rounded">
            {finding.file}
            {finding.line != null ? `:${finding.line}` : ''}
          </span>
        )}
      </div>
      <div className="text-fg-2">{finding.description}</div>
      {finding.suggestion && (
        <div className="text-[11.5px] text-fg-3 mt-1">→ {finding.suggestion}</div>
      )}
    </div>
  );
}
