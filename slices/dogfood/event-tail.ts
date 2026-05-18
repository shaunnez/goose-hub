import type { AgentEventDto } from './checklist.js';

export interface EventTailOptions {
  serverUrl: string;
  projectId: string;
  workItemId: string | number;
  /** Maximum wall-clock time to listen for events. */
  timeoutMs?: number;
  /** Resume from this event id (passed to the server as `since`). */
  since?: string;
  signal?: AbortSignal;
  /** Custom fetch implementation for tests. */
  fetchImpl?: typeof fetch;
}

export interface TailResult {
  events: AgentEventDto[];
  reason: 'callback-stopped' | 'timeout' | 'aborted' | 'server-closed';
}

export type StopFn = () => void;

/**
 * Tail the SSE event stream for a single work item. Calls `onEvent` for each
 * event as it arrives. The callback can return `true` to stop tailing early
 * (e.g. terminal state reached).
 *
 * Resolves when one of: callback returns true, timeoutMs elapsed, abort
 * signal fired, server closed the stream.
 */
export type OnEventFn = (
  event: AgentEventDto,
) => boolean | undefined | undefined | Promise<boolean | undefined | undefined>;

export async function tailEvents(opts: EventTailOptions, onEvent: OnEventFn): Promise<TailResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = new URL('/events', opts.serverUrl);
  url.searchParams.set('projectId', opts.projectId);
  url.searchParams.set('workItemId', String(opts.workItemId));
  if (opts.since) url.searchParams.set('since', opts.since);

  const controller = new AbortController();
  const externalAbort = opts.signal;
  if (externalAbort) {
    if (externalAbort.aborted) controller.abort();
    else externalAbort.addEventListener('abort', () => controller.abort());
  }
  const timeoutHandle: NodeJS.Timeout | undefined = opts.timeoutMs
    ? setTimeout(() => controller.abort(), opts.timeoutMs)
    : undefined;

  const events: AgentEventDto[] = [];
  let reason: TailResult['reason'] = 'server-closed';

  try {
    const res = await fetchImpl(url.toString(), {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`SSE connection failed: ${res.status} ${res.statusText}`);
    }
    if (!res.body) {
      throw new Error('SSE response had no body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE framing: events separated by blank lines.
      let idx = buf.indexOf('\n\n');
      while (idx !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const parsed = parseSseBlock(block);
        if (parsed) {
          events.push(parsed);
          const stop = await onEvent(parsed);
          if (stop === true) {
            reason = 'callback-stopped';
            controller.abort();
            break;
          }
        }
        idx = buf.indexOf('\n\n');
      }
    }
  } catch (err) {
    if (controller.signal.aborted) {
      // Resolve reason only if the inner loop hasn't already set one
      // (callback-stopped is set before controller.abort()).
      if (reason === 'server-closed') {
        if (externalAbort?.aborted) reason = 'aborted';
        else reason = 'timeout';
      }
    } else {
      throw err;
    }
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  return { events, reason };
}

/** Parse a single SSE block of the form `id: 1\nevent: foo\ndata: {...}`. */
export function parseSseBlock(block: string): AgentEventDto | undefined {
  const lines = block.split('\n');
  let dataLine = '';
  let id: string | undefined;
  let kind: string | undefined;
  for (const line of lines) {
    if (line.startsWith('data:')) dataLine += line.slice(5).trim();
    else if (line.startsWith('id:')) id = line.slice(3).trim();
    else if (line.startsWith('event:')) kind = line.slice(6).trim();
  }
  if (!dataLine) return undefined;
  try {
    const parsed = JSON.parse(dataLine) as Partial<AgentEventDto>;
    return {
      id: id ?? parsed.id,
      kind: parsed.kind ?? kind ?? 'unknown',
      payload: parsed.payload,
      runId: parsed.runId,
      workItemId: parsed.workItemId,
      ts: parsed.ts,
    };
  } catch {
    return undefined;
  }
}
