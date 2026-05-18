import {
  createConversation,
  deleteConversation,
  fetchConversation,
  listConversations,
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
import { Bot, List, MessageCircle, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { deriveThinkingFromEvents, mergeToolStatusFromEvents } from '../lib/liveState';
import { resolveScopeFromPath } from '../lib/scope';
import { useChatEvents } from '../lib/useChatEvents';
import { ChatInput } from './ChatInput';
import { ChatThread } from './ChatThread';
import { ConversationList } from './ConversationList';

const ACTIVE_CONVERSATION_STORAGE_KEY = 'hub-chat-active-conversation-id';

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
}

type View = 'thread' | 'list';

export function ChatPanel({ open, onClose }: ChatPanelProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const resolved = useMemo(() => resolveScopeFromPath(location.pathname), [location.pathname]);

  const [conversation, setConversation] = useState<ChatConversationDto | null>(null);
  const [conversations, setConversations] = useState<ChatConversationDto[]>([]);
  const [view, setView] = useState<View>('list');
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [invocations, setInvocations] = useState<ChatToolInvocationDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [pendingDecision, setPendingDecision] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<ChatRuntime>('claude');

  const readActiveId = useCallback((): string | null => {
    try {
      return localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY);
    } catch {
      return null;
    }
  }, []);

  const writeActiveId = useCallback((id: string | null) => {
    try {
      if (id == null) localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
      else localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, id);
    } catch {
      // localStorage unavailable — accept the loss; selection is best-effort.
    }
  }, []);

  const loadConversation = useCallback(
    async (id: string) => {
      try {
        const full = await fetchConversation(id);
        setConversation(full.conversation);
        setMessages(full.messages);
        setInvocations(full.invocations);
        writeActiveId(full.conversation.id);
        setView('thread');
      } catch (err) {
        setError(`Could not load conversation: ${String(err)}`);
      }
    },
    [writeActiveId],
  );

  // Refresh the conversation roster whenever the panel opens. Don't auto-
  // create on mount any more; the user picks one or clicks New explicitly
  // (M20.15 AC).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const list = await listConversations({});
        if (cancelled) return;
        setConversations(list);
        const previousId = readActiveId();
        const previous = list.find((c) => c.id === previousId);
        if (previous != null) {
          await loadConversation(previous.id);
          setView('thread');
        } else {
          setConversation(null);
          setMessages([]);
          setInvocations([]);
          setView('list');
        }
      } catch (err) {
        if (!cancelled) setError(`Could not load conversations: ${String(err)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, readActiveId, loadConversation]);

  const handleNewConversation = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const conv = await createConversation({
        scope: resolved.scope,
        projectSlug: resolved.projectSlug,
        workItemId: resolved.workItemId,
        runtime,
      });
      setConversation(conv);
      setMessages([]);
      setInvocations([]);
      setConversations((prev) => [conv, ...prev.filter((c) => c.id !== conv.id)]);
      writeActiveId(conv.id);
      setView('thread');
    } catch (err) {
      setError(`Could not start a conversation: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [resolved.scope, resolved.projectSlug, resolved.workItemId, runtime, writeActiveId]);

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await deleteConversation(id);
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (conversation?.id === id) {
          setConversation(null);
          setMessages([]);
          setInvocations([]);
          writeActiveId(null);
          setView('list');
        }
      } catch (err) {
        setError(`Delete failed: ${String(err)}`);
      } finally {
        setBusy(false);
      }
    },
    [conversation, writeActiveId],
  );

  // Subscribe to chat.* events for this conversation. The events drive two
  // render-only behaviours that don't need a network round-trip:
  //   - the "thinking…" indicator between user message and agent reply
  //   - live `running` → `completed`/`failed` status badge updates on tool
  //     cards we already know about
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
      // Optimistic user bubble. `postUserMessage` on the server runs the
      // whole orchestrator turn before responding, which can be several
      // seconds; without this the user's message would not render until
      // the agent reply lands. The authoritative refetch below replaces
      // the optimistic row with the persisted one.
      const optimisticId = -Date.now();
      const optimistic: ChatMessageDto = {
        id: optimisticId,
        conversationId: conversation.id,
        role: 'user',
        content,
        runId: null,
        meta: null,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
      try {
        await postMessage(conversation.id, content);
        const full = await fetchConversation(conversation.id);
        setMessages(full.messages);
        setInvocations(full.invocations);
        setConversation(full.conversation);
        // Keep the roster fresh (title may have been derived from the first
        // user message).
        setConversations((prev) =>
          prev.map((c) => (c.id === full.conversation.id ? full.conversation : c)),
        );
      } catch (err) {
        setError(`Send failed: ${String(err)}`);
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
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

  const toggleView = useCallback(() => {
    setView((v) => (v === 'thread' ? 'list' : conversation != null ? 'thread' : 'list'));
  }, [conversation]);

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
          data-testid="chat-scope-chip"
          className="text-[10.5px] uppercase tracking-wider text-fg-2"
          title="Current conversation scope (derived from page)"
        >
          {resolved.label}
        </span>
        <button
          type="button"
          onClick={toggleView}
          aria-label={view === 'thread' ? 'Show conversations' : 'Show current thread'}
          data-testid="chat-toggle-view"
          className={cn(
            'ml-auto p-1 rounded text-fg-2 hover:text-fg',
            view === 'list' && 'bg-bg text-fg',
          )}
          title={view === 'thread' ? 'Show conversations' : 'Back to thread'}
        >
          {view === 'thread' ? <List size={14} /> : <MessageCircle size={14} />}
        </button>
        <select
          value={runtime}
          onChange={(e) => setRuntime(e.target.value as ChatRuntime)}
          className="bg-bg border border-line rounded text-[11px] px-1 py-0.5"
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

      {view === 'list' ? (
        <ConversationList
          conversations={conversations}
          activeConversationId={conversation?.id ?? null}
          busy={busy}
          onSelect={(id) => loadConversation(id)}
          onDelete={handleDeleteConversation}
          onNew={handleNewConversation}
        />
      ) : (
        <ChatThread
          messages={messages}
          invocations={liveInvocations}
          pendingDecision={pendingDecision}
          thinking={isThinking}
          onApprove={handleApprove}
          onReject={handleReject}
          onNavigate={handleNavigate}
        />
      )}

      {view === 'thread' && (
        <ChatInput disabled={busy || conversation == null} onSubmit={sendMessage} />
      )}
    </aside>
  );
}
