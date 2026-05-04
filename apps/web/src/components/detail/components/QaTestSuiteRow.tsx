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
      className="grid items-center px-4 py-3"
      style={{
        gridTemplateColumns: '1.5fr 1fr 100px 90px 90px',
        borderTop: isFirst ? 'none' : '1px solid var(--line)',
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span
          className="inline-block rounded-full shrink-0"
          style={{ width: 8, height: 8, background: pillColor }}
        />
        <span className="mono text-[12.5px] truncate" title={suite.filePath}>
          {suite.name}
        </span>
      </div>
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
      <span className="mono tnum text-right text-[12px] text-fg-2">
        {suite.passed}/{suite.total}
      </span>
      <span className="mono tnum text-right text-[12px] text-fg-3">
        {suite.durationMs > 0 ? `${suite.durationMs}ms` : '—'}
      </span>
      <span className="text-right">
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
