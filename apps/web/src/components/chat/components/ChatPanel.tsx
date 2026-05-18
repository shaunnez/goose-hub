import {
  createConversation,
  fetchConversation,
  postMessage,
  resolveInvocation,
} from '@/lib/api/chat';
import { cn } from '@/lib/cn';
import type {
  ChatConversationDto,
  ChatMessageDto,
  ChatRuntime,
  ChatToolInvocationDto,
} from '@/lib/types';
import { Bot, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { deriveThinkingFromEvents, mergeToolStatusFromEvents } from '../lib/liveState';
import { resolveScopeFromPath } from '../lib/scope';
import { useChatEvents } from '../lib/useChatEvents';
import { ChatInput } from './ChatInput';
import { ChatThread } from './ChatThread';

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
}

export function ChatPanel({ open, onClose }: ChatPanelProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const resolved = useMemo(() => resolveScopeFromPath(location.pathname), [location.pathname]);

  const [conversation, setConversation] = useState<ChatConversationDto | null>(null);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [invocations, setInvocations] = useState<ChatToolInvocationDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [pendingDecision, setPendingDecision] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<ChatRuntime>('claude');

  // Whenever the panel opens or the scope changes, start (or resume) a
  // conversation matching the current scope. v1 starts a fresh conversation
  // each time; conversation listing is a follow-up UI feature.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const conv = await createConversation({
          scope: resolved.scope,
          projectSlug: resolved.projectSlug,
          workItemId: resolved.workItemId,
          runtime,
        });
        if (cancelled) return;
        setConversation(conv);
        setMessages([]);
        setInvocations([]);
      } catch (err) {
        if (!cancelled) setError(`Could not start a conversation: ${String(err)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, resolved.scope, resolved.projectSlug, resolved.workItemId, runtime]);

  // Subscribe to chat.* events for this conversation. The events drive two
  // render-only behaviours that don't need a network round-trip:
  //   - the "thinking…" indicator between user message and agent reply
  //   - live `running` → `completed`/`failed` status badge updates on tool
  //     cards we already know about
  //
  // We deliberately do NOT refetch the conversation on every event tick.
  // Authoritative reconciliation happens via `postMessage` (after a turn)
  // and `resolveInvocation` (after an approve/reject). New invocations the
  // base state hasn't seen yet are still rendered after the next refresh —
  // tool events for unknown ids are ignored by the merge helper.
  const events = useChatEvents(conversation?.id ?? null);
  const isThinking = useMemo(() => deriveThinkingFromEvents(events), [events]);
  const liveInvocations = useMemo(
    () => mergeToolStatusFromEvents(invocations, events),
    [invocations, events],
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (conversation == null) return;
      setBusy(true);
      setError(null);
      try {
        await postMessage(conversation.id, content);
        // Authoritative reconciliation — refetch once after the POST settles.
        // The SSE handler may also refresh during the turn, but both paths
        // converge through fetchConversation, which is the single source of
        // truth. Appending the POST response inline would double messages
        // if the SSE refresh fired first (Codex P2 finding).
        const full = await fetchConversation(conversation.id);
        setMessages(full.messages);
        setInvocations(full.invocations);
      } catch (err) {
        setError(`Send failed: ${String(err)}`);
      } finally {
        setBusy(false);
      }
    },
    [conversation],
  );

  const handleApprove = useCallback(
    async (id: string) => {
      if (conversation == null) return;
      setPendingDecision(id);
      try {
        const res = await resolveInvocation(conversation.id, id, 'approve');
        setInvocations((prev) =>
          prev.map((i) => (i.id === res.invocation.id ? res.invocation : i)),
        );
        // Auto-navigate when the approved tool is open_url. The agent
        // proposed a navigation intent; approving it should actually navigate
        // rather than render a second click target.
        if (
          res.invocation.toolName === 'open_url' &&
          res.invocation.status === 'completed' &&
          res.invocation.result != null
        ) {
          const path = (res.invocation.result as { path?: string }).path;
          if (typeof path === 'string' && path.startsWith('/')) {
            navigate(path);
            onClose();
          }
        }
      } catch (err) {
        setError(`Approve failed: ${String(err)}`);
      } finally {
        setPendingDecision(null);
      }
    },
    [conversation, navigate, onClose],
  );

  const handleReject = useCallback(
    async (id: string) => {
      if (conversation == null) return;
      setPendingDecision(id);
      try {
        const res = await resolveInvocation(conversation.id, id, 'reject');
        setInvocations((prev) =>
          prev.map((i) => (i.id === res.invocation.id ? res.invocation : i)),
        );
      } catch (err) {
        setError(`Reject failed: ${String(err)}`);
      } finally {
        setPendingDecision(null);
      }
    },
    [conversation],
  );

  const handleNavigate = useCallback(
    (path: string) => {
      navigate(path);
      onClose();
    },
    [navigate, onClose],
  );

  return (
    <aside
      data-testid="chat-panel"
      className={cn(
        'fixed top-0 right-0 h-screen z-40 transition-transform duration-200 ease-out',
        'bg-bg border-l border-line shadow-xl flex flex-col',
        'w-full sm:w-[380px] md:w-[420px]',
        open ? 'translate-x-0' : 'translate-x-full pointer-events-none',
      )}
    >
      <header className="flex items-center gap-2 px-3 py-2.5 border-b border-line bg-bg-elev">
        <Bot size={14} className="text-accent" />
        <h2 className="text-[13px] font-semibold tracking-tight">Hub Chat</h2>
        <span
          className="text-[10.5px] uppercase tracking-wider text-fg-2"
          title="Current conversation scope (derived from page)"
        >
          {resolved.label}
        </span>
        <select
          value={runtime}
          onChange={(e) => setRuntime(e.target.value as ChatRuntime)}
          className="ml-auto bg-bg border border-line rounded text-[11px] px-1 py-0.5"
          title="Runtime"
        >
          <option value="claude">claude</option>
          <option value="codex">codex</option>
        </select>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="p-1 text-fg-2 hover:text-fg rounded"
        >
          <X size={14} />
        </button>
      </header>

      {error && (
        <div className="bg-red-900/20 text-red-300 text-[11.5px] px-3 py-1.5 border-b border-red-900/40">
          {error}
        </div>
      )}

      <ChatThread
        messages={messages}
        invocations={liveInvocations}
        pendingDecision={pendingDecision}
        thinking={isThinking}
        onApprove={handleApprove}
        onReject={handleReject}
        onNavigate={handleNavigate}
      />

      <ChatInput disabled={busy || conversation == null} onSubmit={sendMessage} />
    </aside>
  );
}
