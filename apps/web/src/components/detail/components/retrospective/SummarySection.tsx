import { AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';
import type { Summary } from '../../lib/retrospective';
import { SectionHeader } from './SectionHeader';

function SummaryRow({
  label,
  body,
  tone,
  isFirst = false,
}: {
  label: string;
  body: string;
  tone: 'success' | 'warning' | 'info';
  isFirst?: boolean;
}) {
  const Icon = tone === 'success' ? CheckCircle : tone === 'warning' ? AlertCircle : RefreshCw;
  const color =
    tone === 'success' ? 'var(--success)' : tone === 'warning' ? 'var(--warning)' : 'var(--accent)';
  return (
    <div className={`flex items-start gap-3 px-4 py-3 ${isFirst ? '' : 'border-t border-line'}`}>
      <Icon size={14} className="shrink-0 mt-0.5" style={{ color }} />
      <div className="flex-1 min-w-0">
        <div className="text-[10.5px] uppercase tracking-wider text-fg-2 mb-0.5">{label}</div>
        <div className="text-[13px] text-fg-2 leading-relaxed">{body}</div>
      </div>
    </div>
  );
}

export function SummarySection({ summary }: { summary: Summary }) {
  return (
    <div data-testid="retro-summary">
      <SectionHeader title="Summary" />
      <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
        <SummaryRow label="What went well" body={summary.wentWell} tone="success" isFirst />
        <SummaryRow label="What didn't" body={summary.didNotGoWell} tone="warning" />
        <SummaryRow
          label="Architectural takeaway"
          body={summary.architecturalTakeaway}
          tone="info"
        />
      </div>
    </div>
  );
}
