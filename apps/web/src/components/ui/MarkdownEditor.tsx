// apps/web/src/components/ui/MarkdownEditor.tsx
import { renderMarkdownToHtml } from '@/lib/markdown';
import { useRef } from 'react';

const TOOLBAR = [
  { label: 'B', prefix: '**', suffix: '**', placeholder: 'bold', title: 'Bold', cls: 'font-bold' },
  { label: 'I', prefix: '*', suffix: '*', placeholder: 'italic', title: 'Italic', cls: 'italic' },
  { label: '`', prefix: '`', suffix: '`', placeholder: 'code', title: 'Inline code', cls: 'font-mono' },
  { label: '```', prefix: '```\n', suffix: '\n```', placeholder: 'code block', title: 'Code block', cls: 'font-mono' },
  { label: 'link', prefix: '[', suffix: '](url)', placeholder: 'text', title: 'Link', cls: '' },
  { label: '- ', prefix: '\n- ', suffix: '', placeholder: '', title: 'List item', cls: 'font-mono' },
] as const;

function applyFormat(
  ta: HTMLTextAreaElement,
  setValue: (v: string) => void,
  prefix: string,
  suffix: string,
  placeholder: string,
) {
  const { selectionStart: ss, selectionEnd: se, value } = ta;
  const selected = value.slice(ss, se) || placeholder;
  const newValue = value.slice(0, ss) + prefix + selected + suffix + value.slice(se);
  setValue(newValue);
  requestAnimationFrame(() => {
    ta.focus();
    ta.setSelectionRange(ss + prefix.length, ss + prefix.length + selected.length);
  });
}

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  tab: 'write' | 'preview';
  onTabChange: (tab: 'write' | 'preview') => void;
  placeholder?: string;
  rows?: number;
  'data-testid'?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  tab,
  onTabChange,
  placeholder = 'Write something…',
  rows = 5,
  'data-testid': testId,
}: MarkdownEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div data-testid={testId ?? 'markdown-editor'}>
      {/* Tab bar + toolbar */}
      <div className="flex items-center justify-between px-2 py-1.5 bg-bg-elev border-b border-line">
        <div className="flex gap-0.5">
          {(['write', 'preview'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onTabChange(t)}
              className={`px-3 py-1 text-[12px] rounded capitalize transition-none ${
                tab === t
                  ? 'bg-bg text-fg-2 border border-line shadow-sm'
                  : 'text-fg-4 hover:text-fg-2'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === 'write' && (
          <div className="flex items-center gap-px">
            {TOOLBAR.map(({ label, prefix, suffix, placeholder: ph, title, cls }) => (
              <button
                key={title}
                type="button"
                title={title}
                onClick={() => {
                  if (taRef.current) applyFormat(taRef.current, onChange, prefix, suffix, ph);
                }}
                className={`px-2 py-0.5 text-[11.5px] text-fg-3 hover:text-fg-2 hover:bg-bg-hover rounded ${cls}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      {tab === 'write' ? (
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className="w-full min-h-[120px] bg-bg text-[13px] px-4 py-3 resize-y focus:outline-none placeholder:text-fg-4 block"
        />
      ) : (
        <div
          data-testid="markdown-preview"
          className="prose-fix px-4 py-3 text-[13px] min-h-[120px]"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: output of renderMarkdownToHtml which escapes raw input
          dangerouslySetInnerHTML={{
            __html: value.trim()
              ? renderMarkdownToHtml(value)
              : '<p style="color:var(--fg-4);font-size:13px">Nothing to preview</p>',
          }}
        />
      )}
    </div>
  );
}
