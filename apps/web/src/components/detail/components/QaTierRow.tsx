import type { Finding, TierResult } from '../lib/qa';
import { severityColor } from '../lib/qa';

interface QaTierRowProps {
  tier: 'structural' | 'functional' | 'regression';
  result: TierResult | undefined;
  isFirst: boolean;
}

export function QaTierRow({ tier, result, isFirst }: QaTierRowProps) {
  const findings = result?.findings ?? [];
  const passed = !!result?.passed;
  const dots: Array<{ key: string; sev: Finding['severity'] | null }> =
    findings.length > 0
      ? findings.slice(0, 16).map((f, idx) => ({
          key: `${tier}-f-${idx}-${f.severity}`,
          sev: f.severity,
        }))
      : Array.from({ length: 8 }, (_, idx) => ({
          key: `${tier}-empty-${idx}`,
          sev: null,
        }));

  return (
    <div
      className="grid items-center px-4 py-3"
      style={{
        gridTemplateColumns: '1.5fr 1fr 90px 90px 90px',
        borderTop: isFirst ? 'none' : '1px solid var(--line)',
      }}
    >
      <div className="flex items-center gap-3">
        <span
          className="inline-block rounded-full"
          style={{
            width: 8,
            height: 8,
            background: passed ? 'var(--success)' : 'var(--danger)',
          }}
        />
        <span className="mono text-[12.5px] capitalize">{tier} </span>
         <span
        className="mono tnum text-right text-[12px] text-fg-3 truncate"
        title={result?.command ?? ''}
      >
        {result?.command ?? ''}
      </span>
      </div>
      <div className="flex items-center gap-1">
        {dots.map((d) => (
          <span
            key={d.key}
            style={{
              width: 8,
              height: 14,
              borderRadius: 1.5,
              background: d.sev === null ? 'var(--success)' : severityColor(d.sev),
              opacity: d.sev === null ? 0.7 : 1,
            }}
          />
        ))}
      </div>
      <span className="mono tnum text-right text-[12px] text-fg-2">
        {passed ? 'pass' : `${findings.length} issue${findings.length === 1 ? '' : 's'}`}
      </span>
     
      <span className="grow flex" />
      
      <span className="text-right ">
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full border text-[10.5px] font-medium uppercase tracking-wide"
          style={{
            color: passed ? 'var(--success)' : 'var(--danger)',
            borderColor: passed
              ? 'oklch(from var(--success) l c h / 0.4)'
              : 'oklch(from var(--danger) l c h / 0.4)',
            background: passed
              ? 'oklch(from var(--success) l c h / 0.1)'
              : 'oklch(from var(--danger) l c h / 0.1)',
          }}
        >
          {passed ? 'passing' : 'failing'}
        </span>
      </span>
    </div>
  );
}
