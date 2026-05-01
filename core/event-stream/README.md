# core/event-stream

Single-writer chokepoint for operational events. All writes go through `appendEvent()` in `store.ts`; the SQLite write is durable before listeners are notified, so SSE consumers never see an event the DB hasn't recorded.

`sse.ts` builds the `ReadableStream` body for the server's `GET /events` route, with `Last-Event-ID` resumption.

Consumed by:

- `apps/server` for `/events` and post-transition emit
- `apps/web` (M2.09 / M2.10) for the Timeline panel and optimistic UI rollback
