import { cn } from '@/lib/cn';
import { Send } from 'lucide-react';
import { type KeyboardEvent, useRef, useState } from 'react';

interface ChatInputProps {
  disabled: boolean;
  onSubmit: (content: string) => void;
}

export function ChatInput({ disabled, onSubmit }: ChatInputProps) {
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  function send() {
    const trimmed = draft.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setDraft('');
    requestAnimationFrame(() => ref.current?.focus());
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="border-t border-line p-3 bg-bg-elev">
      <div className="flex gap-2 items-end">
        <textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            disabled ? 'Waiting for the assistant…' : 'Ask Hub Chat anything. Enter to send.'
          }
          disabled={disabled}
          rows={2}
          data-testid="chat-input"
          className={cn(
            'flex-1 resize-none bg-bg text-fg text-[12.5px] rounded-md border border-line px-3 py-2',
            'focus:outline-none focus:ring-1 focus:ring-accent',
            disabled && 'opacity-60',
          )}
        />
        <button
          type="button"
          onClick={send}
          disabled={disabled || draft.trim().length === 0}
          data-testid="chat-send"
          className={cn('p-2 rounded-md bg-accent text-bg hover:bg-accent/90 disabled:opacity-40')}
          aria-label="Send"
        >
          <Send size={14} />
        </button>
      </div>
      <div className="text-[10.5px] text-fg-2 mt-1">
        Mutating actions require explicit Approve/Reject. Read-only tools run automatically.
      </div>
    </div>
  );
}
