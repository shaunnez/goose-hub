import { cn } from '@/lib/cn';
import { renderMarkdownToHtml } from '@/lib/markdown';
import type { ChatMessageDto } from '@/lib/types';

interface MessageBubbleProps {
  message: ChatMessageDto;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex flex-col gap-1 py-2', isUser ? 'items-end pl-8' : 'items-start pr-8')}>
      <div className="text-[10.5px] uppercase tracking-wider text-fg-2">
        {isUser ? 'You' : 'Hub Chat'}
      </div>
      <div
        className={cn(
          'max-w-full rounded-md px-3 py-2 text-[12.5px] leading-relaxed',
          isUser ? 'bg-accent-soft text-fg' : 'bg-bg-elev border border-line text-fg',
        )}
      >
        <div
          className="prose prose-invert prose-sm break-words"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: rendered through trusted markdown pipeline
          dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(message.content) }}
        />
      </div>
    </div>
  );
}
