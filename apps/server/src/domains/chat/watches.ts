import { type AgentEvent, eventStore } from '@goose-hub/core/event-stream/store.js';

export type WatchKind = 'run' | 'issue';

export interface RunWatchParams {
  runId: string;
}
export interface IssueWatchParams {
  projectId: string;
  workItemId: string;
}

export type WatchParams = RunWatchParams | IssueWatchParams;

export interface Watch {
  id: string;
  conversationId: string;
  kind: WatchKind;
  params: WatchParams;
  createdAt: number;
  expiresAt: number;
}

export interface WatchFireInput {
  watch: Watch;
  event: AgentEvent;
}
export type WatchFireCallback = (input: WatchFireInput) => void;

export interface WatchRegistryOptions {
  /** Time-to-live in milliseconds before an unmet watch expires. Default 30 min. */
  ttlMs?: number;
  /** Override the event-store subscribe function. Test-only injection point. */
  subscribe?: typeof eventStore.subscribe;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;

/**
 * Tracks transient watches that fire follow-up chat messages when a matching
 * event lands. Two kinds today: by `runId` (agent.run-completed / -failed) and
 * by work-item (state.transitioned). Watches are one-shot — the first matching
 * event removes them — and self-expire after `ttlMs`.
 */
export class WatchRegistry {
  private watches = new Map<string, Watch>();
  private readonly ttlMs: number;
  private readonly onFire: WatchFireCallback;
  private readonly subscribeFn: typeof eventStore.subscribe;
  private unsubscribeFromEvents: (() => void) | null = null;
  private idCounter = 0;

  constructor(onFire: WatchFireCallback, options: WatchRegistryOptions = {}) {
    this.onFire = onFire;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.subscribeFn = options.subscribe ?? eventStore.subscribe.bind(eventStore);
  }

  start(): void {
    if (this.unsubscribeFromEvents != null) return;
    this.unsubscribeFromEvents = this.subscribeFn((event) => this.handle(event));
  }

  stop(): void {
    this.unsubscribeFromEvents?.();
    this.unsubscribeFromEvents = null;
  }

  addRunWatch(conversationId: string, runId: string): Watch {
    return this.add({ conversationId, kind: 'run', params: { runId } });
  }

  addIssueWatch(conversationId: string, projectId: string, workItemId: string): Watch {
    return this.add({ conversationId, kind: 'issue', params: { projectId, workItemId } });
  }

  removeByConversation(conversationId: string): number {
    let count = 0;
    for (const [id, watch] of this.watches) {
      if (watch.conversationId === conversationId) {
        this.watches.delete(id);
        count++;
      }
    }
    return count;
  }

  pruneExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [id, watch] of this.watches) {
      if (watch.expiresAt <= now) {
        this.watches.delete(id);
        count++;
      }
    }
    return count;
  }

  listForConversation(conversationId: string): Watch[] {
    return [...this.watches.values()].filter((w) => w.conversationId === conversationId);
  }

  /** Visible to tests; production callers route through `start()` + eventStore. */
  handle(event: AgentEvent): void {
    this.pruneExpired();
    if (this.watches.size === 0) return;
    for (const [id, watch] of [...this.watches]) {
      if (!matches(watch, event)) continue;
      this.watches.delete(id);
      this.onFire({ watch, event });
    }
  }

  /** Test-only: total pending watches. */
  size(): number {
    return this.watches.size;
  }

  private add(input: { conversationId: string; kind: WatchKind; params: WatchParams }): Watch {
    const now = Date.now();
    this.idCounter += 1;
    const id = `watch_${this.idCounter.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const watch: Watch = {
      id,
      conversationId: input.conversationId,
      kind: input.kind,
      params: input.params,
      createdAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.watches.set(id, watch);
    return watch;
  }
}

function matches(watch: Watch, event: AgentEvent): boolean {
  if (watch.kind === 'run') {
    const { runId } = watch.params as RunWatchParams;
    if (event.runId !== runId) return false;
    return event.kind === 'agent.run-completed' || event.kind === 'agent.run-failed';
  }
  const { projectId, workItemId } = watch.params as IssueWatchParams;
  return (
    event.kind === 'state.transitioned' &&
    event.projectId === projectId &&
    event.workItemId === workItemId
  );
}
