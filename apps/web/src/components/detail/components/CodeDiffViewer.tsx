import type { ParsedFile } from '../lib/code-diff';

export function CodeDiffViewer({ file }: { file: ParsedFile }) {
  return (
    <div className="min-w-0 flex flex-col overflow-auto">
      <div
        className="flex items-center justify-between px-4 py-2 shrink-0"
        style={{ borderBottom: '1px solid var(--line)' }}
      >
        <span
          className="truncate"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-2)' }}
          title={file.path}
        >
          {file.path}
        </span>
        <span className="shrink-0 ml-4" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          <span style={{ color: 'var(--success)' }}>+{file.adds}</span>{' '}
          <span style={{ color: 'var(--danger)' }}>−{file.dels}</span>
        </span>
      </div>

      <div
        data-testid="code-diff-pre"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          lineHeight: 1.55,
          overflowX: 'auto',
        }}
      >
        {file.hunks.length === 0 && (
          <div className="px-4 py-6 text-center text-[12px]" style={{ color: 'var(--fg-4)' }}>
            No hunks
          </div>
        )}
        {file.hunks.map((hunk) => (
          <div key={hunk.header}>
            <div
              style={{
                padding: '5px 16px',
                color: 'var(--fg-3)',
                background: 'var(--bg-elev)',
                whiteSpace: 'pre',
              }}
            >
              {hunk.header}
            </div>
            {hunk.lines.map((line) => (
              <div
                key={`${line.leftLine ?? 'n'}-${line.rightLine ?? 'n'}-${line.kind}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '42px 42px 16px 1fr',
                  background:
                    line.kind === 'add'
                      ? 'oklch(0.68 0.16 156 / 0.12)'
                      : line.kind === 'del'
                        ? 'oklch(0.65 0.20 28 / 0.12)'
                        : 'transparent',
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    color: 'var(--fg-4)',
                    textAlign: 'right',
                    paddingRight: 8,
                    userSelect: 'none',
                    borderRight: '1px solid var(--line)',
                  }}
                >
                  {line.leftLine ?? ''}
                </span>
                <span
                  style={{
                    color: 'var(--fg-4)',
                    textAlign: 'right',
                    paddingRight: 8,
                    userSelect: 'none',
                    borderRight: '1px solid var(--line)',
                  }}
                >
                  {line.rightLine ?? ''}
                </span>
                <span
                  style={{
                    textAlign: 'center',
                    userSelect: 'none',
                    color:
                      line.kind === 'add'
                        ? 'var(--success)'
                        : line.kind === 'del'
                          ? 'var(--danger)'
                          : 'var(--fg-4)',
                  }}
                >
                  {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
                </span>
                <span
                  style={{
                    whiteSpace: 'pre',
                    paddingLeft: 8,
                    color: line.kind === 'ctx' ? 'var(--fg-2)' : 'var(--fg)',
                    overflowX: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {line.content || ' '}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
