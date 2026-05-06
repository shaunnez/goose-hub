import {
  DISPOSITION_COLOR,
  type ReviewFinding,
  SEVERITY_COLOR,
  formatDisposition,
} from '../../lib/review';

export function FindingsList({ findings }: { findings: ReviewFinding[] }) {
  if (findings.length === 0) return null;
  return (
    <div>
      <h3 className="text-[11px] font-medium text-fg-3 uppercase tracking-[0.14em] mb-3">
        Findings
      </h3>
      <div className="space-y-2">
        {findings.map((f) => (
          <div key={f.description} className="border border-line rounded-lg p-3 text-[12.5px]">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span
                className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${SEVERITY_COLOR[f.severity] ?? 'bg-gray-500/15 text-gray-400'}`}
              >
                {f.severity}
              </span>
              {f.disposition != null && (
                <span
                  className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${DISPOSITION_COLOR[f.disposition]}`}
                  data-testid="review-finding-disposition"
                >
                  {formatDisposition(f.disposition, f.dispositionRef)}
                </span>
              )}
              {f.file && (
                <span className="font-mono text-[10px] text-fg-3 bg-bg-elev-2 px-1 py-0.5 rounded">
                  {f.file}
                  {f.line != null ? `:${f.line}` : ''}
                </span>
              )}
            </div>
            <div className="text-fg-2">{f.description}</div>
            {f.suggestion && <div className="text-[11px] text-fg-3 mt-1">→ {f.suggestion}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
