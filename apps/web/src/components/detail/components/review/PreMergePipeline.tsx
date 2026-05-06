import { Check, XCircle } from 'lucide-react';

export interface PipelineStep {
  label: string;
  passed: boolean | undefined;
}

export function PreMergePipeline({ pipeline }: { pipeline: PipelineStep[] }) {
  return (
    <div>
      <h3 className="text-[11px] font-medium text-fg-3 uppercase tracking-[0.14em] mb-2">
        Pre-merge pipeline
      </h3>
      <div className="rounded-lg border border-line bg-bg-elev overflow-hidden">
        {pipeline.map((p, i) => {
          const passed = p.passed;
          const unknown = passed === undefined;
          return (
            <div
              key={p.label}
              className={`flex items-center gap-3 px-4 py-3 ${i === 0 ? '' : 'border-t border-line'}`}
            >
              <span
                aria-hidden
                className={`grid place-items-center shrink-0 rounded-full ${
                  passed === true
                    ? 'bg-[color:var(--success)]'
                    : unknown
                      ? 'border-[1.5px] border-dashed border-line-2'
                      : 'border-[1.5px] border-dashed border-yellow-500/60'
                }`}
                style={{ width: 22, height: 22 }}
              >
                {passed === true && (
                  <Check size={12} strokeWidth={2.4} className="text-[color:var(--bg)]" />
                )}
                {passed === false && (
                  <XCircle size={12} className="text-red-400/70" strokeWidth={2} />
                )}
              </span>
              <span
                className={`text-[13px] ${passed === true ? 'text-fg' : unknown ? 'text-fg-3' : 'text-fg-2'}`}
              >
                {p.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
