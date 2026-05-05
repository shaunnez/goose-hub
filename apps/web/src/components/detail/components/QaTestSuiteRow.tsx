import type { SuiteResult } from '../lib/qa';

export function QaTestSuiteRow({ suite, isFirst }: { suite: SuiteResult; isFirst: boolean }) {
  const pillColor =
    suite.status === 'passed'
      ? 'var(--success)'
      : suite.status === 'failed'
        ? 'var(--danger)'
        : 'var(--warning)';
  return (
    <div
      className="grid items-center px-4 py-3 items-start"
      style={{
        gridTemplateColumns: '2.2fr 1fr 100px 60px',
        borderTop: isFirst ? 'none' : '1px solid var(--line)',
      }}
    >
      <div className="flex items-center gap-3 min-w-0 grow mr-4">
        <span
          className="inline-block rounded-full shrink-0"
          style={{ width: 8, height: 8, background: pillColor }}
        />
        <span className="mono text-[12.5px] wrap" title={suite.filePath}>
          {suite.name}
          <br />
          <span className="mono text-[9px]  text-fg-3 ">{suite.filePath}</span>
        </span>
      </div>
      <div className="flex justify-start gap-1 flex-wrap flex-col mr-4">
        <span className="mono text-[10.5px]">
          Pass/Fail {suite.passed}/{suite.total}
        </span>
        <div className="flex items-center gap-1 flex-wrap">
          {Array.from({ length: Math.min(suite.total, 24) }, (_, j) => {
            const isPass = j < suite.passed;
            const isFail = j >= suite.passed && j < suite.passed + suite.failed;
            const bg = isPass ? 'var(--success)' : isFail ? 'var(--danger)' : 'var(--warning)';
            return (
              <span
                key={`${suite.filePath}-${j}`}
                style={{ width: 8, height: 14, borderRadius: 1.5, background: bg }}
              />
            );
          })}
        </div>
      </div>

      <span className="mono tnum text-right text-[12px] flex justify-start gap-1 flex-wrap flex-col mr-8">
        <span className="mono text-[10.5px]">Duration</span>
        <span>
          <span className=" text-fg-3 ">
            {suite.durationMs > 0 ? `${suite.durationMs}ms` : '—'}
          </span>
        </span>
      </span>
      <span className="mono tnum text-[12px] flex justify-start gap-1 flex-wrap flex-col">
        <span className="mono text-[10.5px]">Status</span>
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full border text-[10.5px] font-medium uppercase tracking-wide"
          style={{
            color: pillColor,
            borderColor: `oklch(from ${pillColor} l c h / 0.4)`,
            background: `oklch(from ${pillColor} l c h / 0.1)`,
          }}
        >
          {suite.status === 'passed'
            ? 'passing'
            : suite.status === 'failed'
              ? 'failing'
              : 'skipped'}
        </span>
      </span>
    </div>
  );
}
