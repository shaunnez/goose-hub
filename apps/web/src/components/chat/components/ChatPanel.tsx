import {
  createConversation,
  deleteConversation,
  fetchConversation,
  fetchToolManifest,
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
  ChatToolManifestDto,
} from '@/lib/types';
import { Bot, List, MessageCircle, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  deriveThinkingFromEvents,
  mergeMessagesFromEvents,
  mergeToolStatusFromEvents,
} from '../lib/liveState';
import { resolveScopeFromPath } from '../lib/scope';
import { useChatEvents } from '../lib/useChatEvents';
import { ChatInput } from './ChatInput';
import { ChatThread } from './ChatThread';
import { ConversationList } from './ConversationList';

const ACTIVE_CONVERSATION_STORAGE_KEY = 'hub-chat-active-conversation-id';

export interface ChatPanelCloseOptions {
  resetToList?: boolean;
  clearActiveConversationId?: boolean;
}

interface ChatPanelProps {
  open: boolean;
  onClose: (options?: ChatPanelCloseOptions) => void;
  closeRequestToken?: number;
  closeRequestOptions?: ChatPanelCloseOptions;
}

type View = 'thread' | 'list';

export function ChatPanel({
  open,
  onClose,
  closeRequestToken = 0,
  closeRequestOptions,
}: ChatPanelProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const resolved = useMemo(() => resolveScopeFromPath(location.pathname), [location.pathname]);

  const [conversation, setConversation] = useState<ChatConversationDto | null>(null);
  const [conversations, setConversations] = useState<ChatConversationDto[]>([]);
  const [view, setView] = useState<View>('list');
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [invocations, setInvocations] = useState<ChatToolInvocationDto[]>([]);
  const [toolManifest, setToolManifest] = useState<ChatToolManifestDto[]>([]);
  const [sendingConversationIds, setSendingConversationIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [busy, setBusy] = useState(false);
  const [pendingDecision, setPendingDecision] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<ChatRuntime>('codex');
  // Monotonic counter the load handlers bump on every new request. Only the
  // response whose token still matches `loadTokenRef.current` is allowed to
  // apply state — protects against:
  //  * rapid A → B clicks where A's response arrives after B's,
  //  * the open-panel roster effect clobbering a thread the user just clicked
  //    "New" to create while the list was still in flight.
  const loadTokenRef = useRef(0);
  const activeConversationIdRef = useRef<string | null>(null);
  const inFlightRunByConversationRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    activeConversationIdRef.current = conversation?.id ?? null;
  }, [conversation?.id]);

  const setConversationSending = useCallback((conversationId: string, sending: boolean) => {
    setSendingConversationIds((prev) => {
      const next = new Set(prev);
      if (sending) next.add(conversationId);
      else next.delete(conversationId);
      return next;
    });
  }, []);

  const pollConversationUntilSettled = useCallback(
    (conversationId: string, runId: string) => {
      let attempts = 0;
      const poll = async () => {
        await new Promise((resolve) => setTimeout(resolve, attempts === 0 ? 1500 : 2500));
        attempts += 1;
        try {
          const full = await fetchConversation(conversationId);
          setConversations((prev) =>
            prev.map((c) => (c.id === full.conversation.id ? full.conversation : c)),
          );
          if (activeConversationIdRef.current === conversationId) {
            setMessages(full.messages);
            setInvocations(full.invocations);
            setConversation(full.conversation);
          }
          const hasAgentReply = full.messages.some((m) => m.role === 'agent' && m.runId === runId);
          if (hasAgentReply && inFlightRunByConversationRef.current.get(conversationId) === runId) {
            inFlightRunByConversationRef.current.delete(conversationId);
            setConversationSending(conversationId, false);
            return;
          }
        } catch {
          // Best-effort fallback; SSE remains the primary live path.
        }

        if (attempts >= 10) {
          if (inFlightRunByConversationRef.current.get(conversationId) === runId) {
            inFlightRunByConversationRef.current.delete(conversationId);
            setConversationSending(conversationId, false);
          }
          return;
        }
        void poll();
      };
      void poll();
    },
    [setConversationSending],
  );

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

  const resetConversationState = useCallback(
    (options?: ChatPanelCloseOptions) => {
      loadTokenRef.current += 1;
      activeConversationIdRef.current = null;
      inFlightRunByConversationRef.current.clear();
      setConversation(null);
      setMessages([]);
      setInvocations([]);
      setSendingConversationIds(new Set());
      if (options?.clearActiveConversationId) {
        writeActiveId(null);
      }
      if (options?.resetToList) {
        setView('list');
      }
    },
    [writeActiveId],
  );

  useEffect(() => {
    if (closeRequestToken === 0 || closeRequestOptions == null) return;
    resetConversationState(closeRequestOptions);
  }, [closeRequestOptions, closeRequestToken, resetConversationState]);

  useEffect(() => {
    if (!open || toolManifest.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const tools = await fetchToolManifest();
        if (!cancelled) setToolManifest(tools);
      } catch {
        // Placeholder help is nice-to-have; the chat input still works without it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, toolManifest.length]);

  /**
   * Load a conversation by id. Returns the loaded conversation on success or
   * `null` on either failure or a stale response (because a newer load
   * request started in the meantime). Callers use the return value to decide
   * whether to flip the view to 'thread' — a failed load should NOT force
   * thread view onto an empty panel.
   */
  const loadConversation = useCallback(
    async (id: string): Promise<ChatConversationDto | null> => {
      const token = ++loadTokenRef.current;
      try {
        const full = await fetchConversation(id);
        if (loadTokenRef.current !== token) return null;
        setConversation(full.conversation);
        setMessages(full.messages);
        setInvocations(full.invocations);
        writeActiveId(full.conversation.id);
        setView('thread');
        return full.conversation;
      } catch (err) {
        if (loadTokenRef.current !== token) return null;
        setError(`Could not load conversation: ${String(err)}`);
        return null;
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
    // Token snapshot for this open. If `loadTokenRef` advances before we
    // settle (e.g. user clicked New / picked a row mid-flight), drop our
    // state writes — the newer interaction is the source of truth now.
    const openToken = ++loadTokenRef.current;
    (async () => {
      try {
        const list = await listConversations({});
        if (cancelled || loadTokenRef.current !== openToken) return;
        setConversations(list);
        const previousId = readActiveId();
        const previous = list.find((c) => c.id === previousId);
        if (previous != null) {
          // loadConversation flips the view + state on its own; we don't
          // force 'thread' here so a failed restore lands cleanly on 'list'.
          const restored = await loadConversation(previous.id);
          if (cancelled) return;
          if (restored == null) {
            setView('list');
          }
        } else {
          if (cancelled) return;
          resetConversationState({ resetToList: true });
        }
      } catch (err) {
        if (!cancelled) setError(`Could not load conversations: ${String(err)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, readActiveId, loadConversation, resetConversationState]);

  const handleNewConversation = useCallback(async () => {
    setBusy(true);
    setError(null);
    // Bumping the token here invalidates any in-flight roster/load response —
    // they'd otherwise reset the panel back to 'list' after the new
    // conversation lands.
    const token = ++loadTokenRef.current;
    try {
      const conv = await createConversation({
        scope: resolved.scope,
        projectSlug: resolved.projectSlug,
        workItemId: resolved.workItemId,
        runtime,
      });
      if (loadTokenRef.current !== token) return;
      setConversation(conv);
      setMessages([]);
      setInvocations([]);
      setConversations((prev) => [conv, ...prev.filter((c) => c.id !== conv.id)]);
      writeActiveId(conv.id);
      setView('thread');
    } catch (err) {
      if (loadTokenRef.current !== token) return;
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
          resetConversationState({ resetToList: true, clearActiveConversationId: true });
        }
      } catch (err) {
        setError(`Delete failed: ${String(err)}`);
      } finally {
        setBusy(false);
      }
    },
    [conversation, resetConversationState],
  );

  // Subscribe to chat.* events for this conversation. The events drive two
  // render-only behaviours that don't need a network round-trip:
  //   - the "thinking…" indicator between user message and agent reply
  //   - live `running` → `completed`/`failed` status badge updates on tool
  //     cards we already know about
  const events = useChatEvents(conversation?.id ?? null);
  const conversationEvents = useMemo(() => {
    if (conversation == null) return [];
    return events.filter((event) => {
      const conversationId = (event.payload as { conversationId?: unknown }).conversationId;
      return conversationId === conversation.id;
    });
  }, [conversation, events]);
  const isThinking = useMemo(
    () => deriveThinkingFromEvents(conversationEvents),
    [conversationEvents],
  );
  useEffect(() => {
    if (conversation == null) return;
    setMessages((prev) => mergeMessagesFromEvents(prev, conversationEvents, conversation.id));
    setInvocations((prev) => mergeToolStatusFromEvents(prev, conversationEvents));

    const latestTerminal = [...conversationEvents]
      .reverse()
      .find((event) => event.kind === 'chat.agent-message' || event.kind === 'chat.run-failed');
    if (latestTerminal != null) {
      const runId = (latestTerminal.payload as { runId?: unknown }).runId;
      if (
        typeof runId === 'string' &&
        inFlightRunByConversationRef.current.get(conversation.id) === runId
      ) {
        inFlightRunByConversationRef.current.delete(conversation.id);
        setConversationSending(conversation.id, false);
      }
      if (latestTerminal.kind === 'chat.run-failed') {
        const error = (latestTerminal.payload as { error?: unknown }).error;
        setError(typeof error === 'string' ? `Chat run failed: ${error}` : 'Chat run failed.');
      }
    }
  }, [conversation, conversationEvents, setConversationSending]);
  const liveInvocations = useMemo(
    () => mergeToolStatusFromEvents(invocations, conversationEvents),
    [invocations, conversationEvents],
  );
  const activeConversationSending =
    conversation != null && sendingConversationIds.has(conversation.id);
  const visibleThinking = isThinking && activeConversationSending;

  const sendMessage = useCallback(
    async (content: string) => {
      if (conversation == null) return;
      const conversationId = conversation.id;
      if (sendingConversationIds.has(conversationId)) return;
      setConversationSending(conversationId, true);
      setError(null);
      // Optimistic user bubble. The POST should return quickly, but this
      // keeps the thread feeling instant while the persisted row comes back.
      const optimisticId = -Date.now();
      const optimistic: ChatMessageDto = {
        id: optimisticId,
        conversationId,
        role: 'user',
        content,
        runId: null,
        meta: null,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
      try {
        const posted = await postMessage(conversationId, content);
        inFlightRunByConversationRef.current.set(conversationId, posted.runId);
        if (activeConversationIdRef.current === conversationId) {
          setMessages((prev) => prev.map((m) => (m.id === optimisticId ? posted.user : m)));
        }
        pollConversationUntilSettled(conversationId, posted.runId);
      } catch (err) {
        if (activeConversationIdRef.current === conversationId) {
          setError(`Send failed: ${String(err)}`);
          setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        }
        inFlightRunByConversationRef.current.delete(conversationId);
        setConversationSending(conversationId, false);
      }
    },
    [conversation, sendingConversationIds, setConversationSending, pollConversationUntilSettled],
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
          onClick={() => onClose()}
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
          tools={toolManifest}
          pendingDecision={pendingDecision}
          thinking={visibleThinking}
          onApprove={handleApprove}
          onReject={handleReject}
          onNavigate={handleNavigate}
        />
      )}

      {view === 'thread' && (
        <ChatInput
          disabled={busy || conversation == null || activeConversationSending}
          onSubmit={sendMessage}
        />
      )}
    </aside>
  );
}
