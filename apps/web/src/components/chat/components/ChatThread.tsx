import type { ChatMessageDto, ChatToolInvocationDto } from '@/lib/types';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import { ToolProposalCard } from './ToolProposalCard';

interface ChatThreadProps {
  messages: ChatMessageDto[];
  invocations: ChatToolInvocationDto[];
  pendingDecision: string | null;
  thinking?: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onNavigate?: (path: string) => void;
}

/**
 * Renders a single conversation. Messages and tool invocations are
 * interleaved in chronological order: a message is followed by every
 * invocation whose `messageId` points at it (or any post-message-time
 * invocation when messageId is null).
 */
export function ChatThread({
  messages,
  invocations,
  pendingDecision,
  thinking = false,
  onApprove,
  onReject,
  onNavigate,
}: ChatThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only scroll on length change
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, invocations.length, thinking]);

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
      {messages.length === 0 && invocations.length === 0 && (
        <div className="text-center text-fg-2 text-[12px] py-8">
          <p className="mb-1">Say hi.</p>
          <p>Try: "what needs human help?" or "list open issues in goose-hub-self".</p>
        </div>
      )}
      {messages.map((msg) => {
        const linkedInvocations = invocations.filter((i) => i.messageId === msg.id);
        return (
          <div key={`m-${msg.id}`}>
            <MessageBubble message={msg} />
            {linkedInvocations.map((inv) => (
              <ToolProposalCard
                key={inv.id}
                invocation={inv}
                busy={pendingDecision === inv.id}
                onApprove={onApprove}
                onReject={onReject}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        );
      })}
      {/* Orphan invocations (no messageId) — render at the bottom */}
      {invocations
        .filter((i) => i.messageId == null)
        .map((inv) => (
          <ToolProposalCard
            key={inv.id}
            invocation={inv}
            busy={pendingDecision === inv.id}
            onApprove={onApprove}
            onReject={onReject}
            onNavigate={onNavigate}
          />
        ))}
      {thinking && (
        <output
          data-testid="chat-thinking-indicator"
          className="my-2 inline-flex items-center gap-1.5 text-[11.5px] text-fg-2"
          aria-live="polite"
        >
          <Loader2 size={12} className="animate-spin" />
          <span>thinking…</span>
        </output>
      )}
    </div>
  );
}
