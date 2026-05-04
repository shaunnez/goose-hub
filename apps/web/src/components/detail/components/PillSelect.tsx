import { cn } from '@/lib/cn';
import { useEffect, useRef, useState } from 'react';

interface PillSelectProps {
  value: string;
  label: string;
  options: { value: string; label: string }[];
  onSelect: (value: string) => void;
  saving?: boolean;
  pillStyle?: React.CSSProperties;
  'data-testid'?: string;
}

export function PillSelect({
  value,
  label,
  options,
  onSelect,
  saving,
  pillStyle,
  'data-testid': testId,
}: PillSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[11.5px] border cursor-pointer',
          'hover:brightness-110 hover:opacity-90 transition-opacity',
          saving && 'opacity-50 cursor-wait',
        )}
        style={pillStyle}
        title={`Change ${label}`}
      >
        {value}
        <span className="text-[9px] opacity-60">▾</span>
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 min-w-[120px] rounded-md border border-line bg-bg-elev shadow-md py-1">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onSelect(o.value);
                setOpen(false);
              }}
              className={cn(
                'w-full text-left px-3 py-1.5 text-[12px] hover:bg-bg-hover',
                o.value === value ? 'text-fg font-medium' : 'text-fg-2',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
