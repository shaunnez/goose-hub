import type { ParsedFile } from '../lib/code-diff';

interface CodeDiffFileListProps {
  files: ParsedFile[];
  activePath: string | null;
  onSelect: (path: string) => void;
}

export function CodeDiffFileList({ files, activePath, onSelect }: CodeDiffFileListProps) {
  return (
    <div className="overflow-y-auto" style={{ borderRight: '1px solid var(--line)' }}>
      <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--line)' }}>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-2">
          Files · {files.length}
        </span>
      </div>
      {files.map((f) => {
        const isActive = activePath === f.path;
        const filename = f.path.split('/').at(-1) ?? f.path;
        return (
          <button
            key={f.path}
            type="button"
            onClick={() => onSelect(f.path)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              width: '100%',
              padding: '6px 12px',
              border: 'none',
              background: isActive ? 'var(--accent-soft)' : 'transparent',
              borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                fontWeight: 700,
                width: 12,
                flexShrink: 0,
                color:
                  f.status === 'new'
                    ? 'var(--success)'
                    : f.status === 'del'
                      ? 'var(--danger)'
                      : 'var(--warning)',
              }}
            >
              {f.status === 'new' ? 'A' : f.status === 'del' ? 'D' : 'M'}
            </span>
            <span
              className="truncate"
              style={{
                flex: 1,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: isActive ? 'var(--fg)' : 'var(--fg-2)',
              }}
              title={f.path}
            >
              {filename}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--success)',
                fontVariantNumeric: 'tabular-nums',
                flexShrink: 0,
              }}
            >
              +{f.adds}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--danger)',
                flexShrink: 0,
              }}
            >
              −{f.dels}
            </span>
          </button>
        );
      })}
    </div>
  );
}
