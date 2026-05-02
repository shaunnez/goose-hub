# core/event-stream

Single-writer chokepoint for operational events. All writes go through `appendEvent()` in `store.ts`; the SQLite write is durable before listeners are notified, so SSE consumers never see an event the DB hasn't recorded.

`sse.ts` builds the `ReadableStream` body for the server's `GET /events` route, with `Last-Event-ID` resumption.

Consumed by:

- `apps/server` for `/events` and post-transition emit
- `apps/web` (M2.09 / M2.10) for the Timeline panel and optimistic UI rollback

## Subscriber contract (#220)

`eventStore.subscribe(listener)` wraps the supplied listener so any thrown error is caught and logged ONCE per error-shape (deduped on `name + message`). **A broken subscriber must not be able to kill the run that's producing the events.**

- A subscriber that throws does not block delivery to other subscribers in the same dispatch.
- A subscriber that throws does not propagate to the producing run — `appendEvent()` always returns the persisted event.
- Errors are logged via `console.error`, deduped per process lifetime per error shape — no log spam from a persistently broken subscriber.

This is the contract `apps/server`'s SSE forwarder relies on: a stalled or buggy browser-side consumer cannot abort an in-flight orchestrator run.
